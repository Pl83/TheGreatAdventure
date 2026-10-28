// Candidate enumeration for the search policies: the sensible (move, action) pairs a unit could play this turn,
// and the react choices open to a defender. Moves are a handful of tactical cells, not every reachable one;
// actions are every legal use from each of those cells. Reads the fight, never changes it.
import {
  S, activeCombatant, getCombatant, bfsReachable, isOccupied, trappingDomainOwner, abilityAvailable,
  targetInRange, aoeCenterValid, aoeCombatantHits, blastReaches, coneCellTargets, tauntSource, targetPool,
  enemies, livingCombatants, koAllies, hasControlEffect, hasSilence, hasLos, chebyshev, activeAllyDomain,
  MELEE_RANGE, SPELL_RANGE,
} from '../combat-logic.js';
import { isWalkableG } from '../dungeon-loader.js';
import { walkMap } from './paths.js';

const LOW_HP = 0.3;
const MAX_MOVES = 6;

const keyOf  = (x, y) => `${x},${y}`;
const cellOf = k => { const [x, y] = k.split(',').map(Number); return { x, y }; };
const isRooted   = c => c.statusEffects.some(e => e.name.toLowerCase() === 'root');
const isTeleport = ab => !!ab.tags?.includes('teleportation');
const isHurt     = c => c.currentHp < c.maxHp;
const sign       = v => Math.sign(v);

// Abilities fired on the unit's own turn (reacts, blocks, gates and the transformation have their own paths);
// a silenced unit cannot spend spell slots, as on the action panel
const castable = (c, ab, silenced) => abilityAvailable(c, ab) && !ab.reactOnly && !ab.isReact && !ab.isBlock
  && !ab.isGate && !ab.isTransform && !(silenced && ab.cost?.type === 'slots');

// c as if it stood on cell: the engine's range, sight and area helpers only read x and y
const standingAt = (c, cell) => (cell ? Object.assign(Object.create(c), cell) : c);

// The best key of cells by score (lower wins, Infinity never), ties going to the fewest steps
function bestCell(cells, score) {
  let best = null, bestS = Infinity, bestD = Infinity;
  for (const [k, d] of cells) {
    const s = score(k);
    if (s < bestS || (s === bestS && s < Infinity && d < bestD)) { best = k; bestS = s; bestD = d; }
  }
  return best;
}

// Free cells c may walk to this turn with their step counts, under enterMoveMode's domain rule
function walkableCells(c) {
  const out = new Map();
  for (const [k, d] of bfsReachable(c.x, c.y, c.speed)) {
    const { x, y } = cellOf(k);
    if (!isOccupied(x, y, c.id) && !trappingDomainOwner(c, x, y)) out.set(k, d);
  }
  return out;
}

// Ranges of c's usable moves aimed at foes, longest first (the basic attack included)
function attackRanges(c, silenced) {
  const ranges = new Set([MELEE_RANGE]);
  for (const ab of c.abilities) {
    if (castable(c, ab, silenced) && !isTeleport(ab) && (ab.targetKind === 'enemy' || ab.targetKind === 'any')) {
      ranges.add(ab.range ?? SPELL_RANGE);
    }
  }
  return [...ranges].sort((a, b) => b - a);
}

// Up to maxMoves move choices, staying put (null) first: closest to the nearest foe by walking distance,
// at the longest range from it with line of sight, next to the weakest foe, a retreat when badly hurt,
// then at each shorter range
function moveChoices(c, maxMoves, silenced) {
  const moves = [null];
  const threats = enemies(c);
  if (maxMoves <= 1 || !S.currentMap || !threats.length || !(c.speed > 0) || isRooted(c)) return moves;
  if (c === activeCombatant() && S.hasMoved) return moves;
  const cells = walkableCells(c);
  if (!cells.size) return moves;

  const here = keyOf(c.x, c.y);
  const maps = new Map(threats.map(f => [f.id, walkMap(f.x, f.y)]));
  const toThreats = k => Math.min(...threats.map(f => maps.get(f.id).get(k) ?? Infinity));
  const pool = targetPool(c);
  const nearest = pool.reduce((a, f) => ((maps.get(f.id).get(here) ?? Infinity) < (maps.get(a.id).get(here) ?? Infinity) ? f : a));
  const weakest = pool.reduce((a, f) => (f.currentHp < a.currentHp ? f : a));
  const toNearest = maps.get(nearest.id);

  const add = k => {
    if (k && moves.length < maxMoves && !moves.some(m => m && keyOf(m.x, m.y) === k)) moves.push(cellOf(k));
  };
  // Sight from each cell to the nearest foe, computed once
  const sight = new Map();
  const seesNearest = k => {
    if (!sight.has(k)) { const { x, y } = cellOf(k); sight.set(k, hasLos(x, y, nearest.x, nearest.y)); }
    return sight.get(k);
  };
  const atRange = r => bestCell(cells, k => {
    const d = chebyshev(cellOf(k), nearest);
    return d <= r && seesNearest(k) ? -d : Infinity;
  });

  const hereD = toNearest.get(here) ?? Infinity;
  add(bestCell(cells, k => { const d = toNearest.get(k) ?? Infinity; return d < hereD ? d : Infinity; }));
  const [longest, ...shorter] = attackRanges(c, silenced);
  add(atRange(longest));
  add(bestCell(cells, k => {
    const { x, y } = cellOf(k);
    return chebyshev({ x, y }, weakest) === 1 && hasLos(x, y, weakest.x, weakest.y) ? 0 : Infinity;
  }));
  if (c.currentHp / c.maxHp < LOW_HP) {
    const hereT = toThreats(here);
    add(bestCell(cells, k => { const d = toThreats(k); return d > hereT && d < Infinity ? -d : Infinity; }));
  }
  for (const r of shorter) add(atRange(r));
  return moves;
}

// Keeps the target sets no other set contains (hitting fewer of the same foes is dominated)
function maximalSets(sets) {
  const sorted = [...sets].sort((a, b) => b.length - a.length);
  const kept = [];
  for (const s of sorted) if (!kept.some(k => s.every(id => k.includes(id)))) kept.push(s);
  return kept;
}

// Distinct enemy target sets, keeping those that include the taunter when there is one
function enemySets(lists, taunter) {
  const byKey = new Map();
  for (const ids of lists) {
    if (!ids.length || (taunter && !ids.includes(taunter.id))) continue;
    byKey.set(ids.join(','), ids);
  }
  return maximalSets(byKey.values());
}

// Area spells: every centre that hits a foe, per blast radius, computed once per enumeration
function blastSpots(c, ab, cache) {
  const radius = ab.radius > 0 ? ab.radius : 1;
  if (cache.has(radius)) return cache.get(radius);
  const spots = [], seen = new Set();
  for (const f of enemies(c)) {
    for (let x = f.x - radius; x <= f.x + radius; x++) {
      for (let y = f.y - radius; y <= f.y + radius; y++) {
        const k = keyOf(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!isWalkableG(S.currentMap, x, y)) continue;
        const ids = aoeCombatantHits(ab, c, x, y).map(t => t.id);
        if (ids.length) spots.push({ x, y, ids });
      }
    }
  }
  cache.set(radius, spots);
  return spots;
}

// Friendly area spells: centres reaching at least one ally that needs it (any ally for a non-heal)
function allyAreaSets(c, at, ab) {
  const radius = ab.radius > 0 ? ab.radius : 1;
  const friends = livingCombatants(c.teamIndex).map(a => (a.id === c.id ? at : a));
  if (ab.isHeal && !friends.some(isHurt)) return [];
  if (!S.currentMap) return [friends.map(a => a.id)];
  const byKey = new Map(), seen = new Set();
  for (const a of friends) {
    for (let x = a.x - radius; x <= a.x + radius; x++) {
      for (let y = a.y - radius; y <= a.y + radius; y++) {
        const k = keyOf(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!aoeCenterValid(at, ab, x, y)) continue;
        const hits = friends.filter(t => blastReaches(x, y, t.x, t.y, radius));
        if (hits.some(t => !ab.isHeal || isHurt(t))) byKey.set(hits.map(t => t.id).join(','), hits.map(t => t.id));
      }
    }
  }
  return maximalSets(byKey.values());
}

// Every sensible targetIds list for ab cast by c from the cell `at` stands on
function targetSets(c, at, ab, ctx) {
  const reach = t => t.id === c.id || targetInRange(at, t, ab).inRange;
  // The engine revives a unit on the cell it fell on without checking it is free (a known engine bug, left for
  // the owner): a fallen ally whose cell someone now stands on is not offered, so the brain never stacks units
  if (ab.isRevive) {
    const free = t => !(t.x === at.x && t.y === at.y) && !isOccupied(t.x, t.y, c.id);
    return koAllies(c.teamIndex).filter(t => reach(t) && free(t)).map(t => [t.id]);
  }
  if (ab.isAoe && ab.targetKind === 'ally') return allyAreaSets(c, at, ab);
  if (ab.isAoe) {
    if (!S.currentMap) return enemySets([enemies(c).map(t => t.id)], ctx.taunter);
    const lists = blastSpots(c, ab, ctx.blasts).filter(s => aoeCenterValid(at, ab, s.x, s.y)).map(s => s.ids);
    return enemySets(lists, ctx.taunter);
  }
  if (ab.isCone) {
    if (!S.currentMap) return enemySets([enemies(c).map(t => t.id)], ctx.taunter);
    return enemySets(enemies(c).map(f => coneCellTargets(at, ab, f).map(t => t.id)), ctx.taunter);
  }
  if (ab.targetKind === 'self') return !ab.isHeal || isHurt(c) ? [[c.id]] : [];
  if (ab.targetKind === 'ally') {
    return livingCombatants(c.teamIndex).filter(t => (!ab.isHeal || isHurt(t)) && reach(t)).map(t => [t.id]);
  }
  const foes = targetPool(c).filter(reach).map(t => [t.id]);
  if (ab.targetKind !== 'any') return foes;
  // Hybrid bounces also mend: a hurt ally is a fair first target
  const friends = livingCombatants(c.teamIndex).filter(t => t.id !== c.id && isHurt(t) && reach(t));
  return [...foes, ...friends.map(t => [t.id])];
}

// Cells a teleport from actor may land on, under handleTeleportClick's rules (its own cell excluded)
function teleportCells(actor, range) {
  const out = [];
  for (let x = actor.x - range; x <= actor.x + range; x++) {
    for (let y = actor.y - range; y <= actor.y + range; y++) {
      if ((x === actor.x && y === actor.y) || !isWalkableG(S.currentMap, x, y)) continue;
      if (!isOccupied(x, y, actor.id) && !trappingDomainOwner(actor, x, y)) out.push({ x, y });
    }
  }
  return out;
}

// The cell of cells with the lowest score, ties going to the one nearest actor
function bestDest(cells, actor, score) {
  let best = null, bestS = Infinity, bestD = Infinity;
  for (const cell of cells) {
    const s = score(cell), d = chebyshev(cell, actor);
    if (s < bestS || (s === bestS && d < bestD)) { best = cell; bestS = s; bestD = d; }
  }
  return best;
}

// A few landing cells for a teleport: beside the far side of `focus` (a foe), and as far from every foe as possible
function teleportDests(actor, range, focus) {
  const cells = teleportCells(actor, range);
  const threats = enemies(actor);
  const dests = [];
  const add = cell => { if (cell && !dests.some(d => d.x === cell.x && d.y === cell.y)) dests.push(cell); };
  if (focus) {
    const behind = { x: focus.x + sign(focus.x - actor.x), y: focus.y + sign(focus.y - actor.y) };
    add(bestDest(cells, actor, cell => chebyshev(cell, behind)));
  }
  if (threats.length) add(bestDest(cells, actor, cell => -Math.min(...threats.map(f => chebyshev(cell, f)))));
  return dests;
}

// The foe nearest to c as the crow flies, or null
function nearestFoe(c, pool = targetPool(c)) {
  return pool.reduce((a, f) => (!a || chebyshev(c, f) < chebyshev(c, a) ? f : a), null);
}

// Domain expansion is offered only when handleActivateDomain would carry it out (a stronger rival
// closed domain would crush it and burn half the slots, so that is left out too)
function domainLegal(c) {
  const domain = c.sourceChar.domain;
  if (!domain || c.domainActive || c.domainCharges <= 0 || c.spellSlots < domain.spellCost || activeAllyDomain(c)) return false;
  if (domain.type === 'Ouvert') return true;
  const rival = S.activeDomains.find(d => {
    const owner = getCombatant(d.casterId);
    return owner && owner.teamIndex !== c.teamIndex && d.domain.type !== 'Ouvert';
  });
  return !rival || (domain.rafinement ?? 0) >= (rival.domain.rafinement ?? 0);
}

function transformLegal(c) {
  const tf = c.sourceChar.transformation;
  if (!tf || c.isTransformed || c.usedThisFight.includes(tf.base.nom)) return false;
  const tfAb = c.abilities.find(a => a.isTransform);
  return !tfAb || abilityAvailable(c, tfAb);
}

export function enumeratePlans(c, { maxMoves = MAX_MOVES } = {}) {
  const pass = () => ({ move: null, action: { type: 'pass' } });
  if (!c || c.isKO || hasControlEffect(c)) return [pass()];

  const plans = [pass()];
  const seen = new Set([JSON.stringify(plans[0])]);
  const add = (move, action) => {
    const plan = { move, action }, key = JSON.stringify(plan);
    if (!seen.has(key)) { seen.add(key); plans.push(plan); }
  };

  const silenced = hasSilence(c);
  // Once the action is spent (an instant left the turn open) only instants remain
  const acted = c === activeCombatant() && S.hasActed;
  const ctx = { taunter: tauntSource(c), blasts: new Map() };
  const abilities = c.abilities.filter(ab => castable(c, ab, silenced) && (!acted || ab.isInstant));

  for (const move of moveChoices(c, maxMoves, silenced)) {
    const at = standingAt(c, move);
    if (!acted) {
      for (const t of targetPool(c)) if (targetInRange(at, t, null).inRange) add(move, { type: 'attack', targetId: t.id });
    }
    for (const ab of abilities) {
      if (isTeleport(ab)) continue;
      for (const targetIds of targetSets(c, at, ab, ctx)) add(move, { type: 'cast', ability: ab.name, targetIds });
    }
    if (!acted && domainLegal(c)) add(move, { type: 'domain' });
    if (!acted && transformLegal(c)) add(move, { type: 'transform' });
    add(move, { type: 'pass' });
  }

  // Teleports land wherever they are aimed, so walking first adds nothing: they are cast from where c stands
  for (const ab of abilities) {
    if (!isTeleport(ab) || ab.targetKind !== 'self') continue;
    if (!S.currentMap) { add(null, { type: 'cast', ability: ab.name, targetIds: [c.id] }); continue; }
    for (const dest of teleportDests(c, ab.range ?? SPELL_RANGE, nearestFoe(c))) {
      add(null, { type: 'cast', ability: ab.name, targetIds: [c.id], dest });
    }
  }
  return plans;
}

export function enumerateReacts() {
  const choices = [];
  const pending = S.pendingAction;
  const attacker = pending && getCombatant(pending.attackerId ?? pending.casterId);
  for (const { combatantId, ability } of S.reactOptions) {
    const reactor = getCombatant(combatantId);
    if (!reactor) continue;
    if (!isTeleport(ability) || !S.currentMap) { choices.push({ combatantId, abilityName: ability.name }); continue; }
    const focus = attacker && attacker.teamIndex !== reactor.teamIndex ? attacker : nearestFoe(reactor, enemies(reactor));
    const dests = teleportDests(reactor, ability.range ?? SPELL_RANGE, focus);
    // Nowhere else to land: staying on its own cell is the only legal placement
    if (!dests.length) dests.push({ x: reactor.x, y: reactor.y });
    for (const dest of dests) choices.push({ combatantId, abilityName: ability.name, dest });
  }
  choices.push(null);
  return choices;
}
