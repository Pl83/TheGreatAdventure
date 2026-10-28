// Greedy policy: close in along the true walking path, then cast the best damage ability, heal a hurt ally,
// or attack. Baseline opponent and rollout policy; it never teleports and never throws.
import {
  S, activeCombatant, bfsReachable, isOccupied, abilityAvailable, hasValidTarget, targetInRange,
  aoeCenterValid, aoeCombatantHits, blastReaches, coneCells, coneCellTargets, tauntSource, targetPool,
  allies, trappingDomainOwner, SPELL_RANGE,
} from '../combat-logic.js';
import { distanceToFoes } from './paths.js';

const HEAL_BELOW = 0.6;

// Expected value of a dice expression such as "2d6+3" or "1d8*(2d4)"; missingHp terms count as 0
export function avgDice(expr) {
  if (!expr) return 0;
  let s = String(expr).replace(/[+-]?\s*\d+\s*%\s*missingHp/gi, '')
    .replace(/(\d+)d(\d+)/gi, (_, n, m) => String(n * (+m + 1) / 2)).replace(/\s+/g, '');
  const sum = t => (t.match(/[+-]?[^+-]+/g) ?? []).reduce((acc, term) => {
    const sign = term[0] === '-' ? -1 : 1;
    return acc + sign * term.replace(/^[+-]/, '').split('*').reduce((p, f) => p * (parseFloat(f) || 0), 1);
  }, 0);
  while (/\([^()]*\)/.test(s)) s = s.replace(/\(([^()]*)\)/, (_, inner) => String(sum(inner)));
  return sum(s);
}

// Instant abilities are skipped: they leave the turn open, so a loop asking the policy again could chain them
const usable = (c, ab) => abilityAvailable(c, ab) && !ab.reactOnly && !ab.isReact && !ab.isBlock
  && !ab.isGate && !ab.isTransform && !ab.isRevive && !ab.isInstant && !ab.tags?.includes('teleportation');

// The best aimed use of an area or cone ability from c's current cell: { targetIds, hits } or null
function bestArea(c, ab) {
  const taunter = tauntSource(c);
  const friends = allies(c).filter(a => a.id !== c.id);
  let best = null;
  const consider = (hits, hurtFriends) => {
    if (!hits.length || (taunter && !hits.some(t => t.id === taunter.id))) return;
    const score = hits.length - 10 * hurtFriends;
    if (!best || score > best.score) best = { score, targetIds: hits.map(t => t.id), hits: hits.length };
  };
  if (ab.isCone) {
    for (const foe of targetPool(c)) {
      const dir = { x: foe.x, y: foe.y };
      const cells = coneCells(c, ab, dir);
      consider(coneCellTargets(c, ab, dir), friends.filter(a => cells.some(k => k.x === a.x && k.y === a.y)).length);
    }
    return best;
  }
  const range = ab.range ?? SPELL_RANGE;
  const radius = ab.radius > 0 ? ab.radius : 1;
  for (let x = c.x - range; x <= c.x + range; x++) {
    for (let y = c.y - range; y <= c.y + range; y++) {
      if (!aoeCenterValid(c, ab, x, y)) continue;
      consider(aoeCombatantHits(ab, c, x, y), friends.filter(a => blastReaches(x, y, a.x, a.y, radius)).length);
    }
  }
  return best;
}

// The highest expected-damage cast available from c's current cell: { action, value } or null
function bestCast(c) {
  let best = null;
  for (const ab of c.abilities) {
    if (!usable(c, ab) || ab.targetKind === 'self' || (ab.targetKind === 'ally' && !ab.isHeal)) continue;
    if (ab.targetKind === 'ally' || !hasValidTarget(c, ab)) continue;
    const dmg = avgDice(ab.dice);
    if (dmg <= 0) continue;
    let targetIds, value = dmg;
    if (ab.isAoe || ab.isCone) {
      const area = bestArea(c, ab);
      if (!area) continue;
      targetIds = area.targetIds;
      value = dmg * area.hits;
    } else {
      const foe = targetPool(c).filter(t => targetInRange(c, t, ab).inRange).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (!foe) continue;
      targetIds = [foe.id];
    }
    if (!best || value > best.value) best = { value, action: { type: 'cast', ability: ab.name, targetIds } };
  }
  return best;
}

// A heal on the most wounded ally under the threshold that the heal can reach (self is always reachable), or null
function healCast(c) {
  const hurt = allies(c).filter(a => a.currentHp / a.maxHp < HEAL_BELOW)
    .sort((a, b) => a.currentHp / a.maxHp - b.currentHp / b.maxHp);
  for (const ab of c.abilities) {
    if (!usable(c, ab) || !ab.isHeal || !hasValidTarget(c, ab)) continue;
    const patient = ab.targetKind === 'self' ? hurt.find(a => a.id === c.id)
      : hurt.find(a => a.id === c.id || targetInRange(c, a, ab).inRange);
    if (patient) return { type: 'cast', ability: ab.name, targetIds: [patient.id] };
  }
  return null;
}

// The damaging action c can take on a foe from where it stands, or null when no foe is within its reach
function offence(c) {
  const cast = bestCast(c);
  if (cast) return cast.action;
  const foe = targetPool(c).filter(t => targetInRange(c, t, null).inRange).sort((a, b) => a.currentHp - b.currentHp)[0];
  return foe ? { type: 'attack', targetId: foe.id } : null;
}

// What c does with its action from where it stands, or null when nothing is legal
const chooseAction = c => healCast(c) ?? offence(c);

// The free reachable cell that most shortens the walk to a foe, or null when none does
function approachCell(c, foes) {
  const dist = distanceToFoes(foes);
  const here = dist.get(`${c.x},${c.y}`) ?? Infinity;
  let best = null, bestD = here;
  for (const [k] of bfsReachable(c.x, c.y, c.speed)) {
    const [x, y] = k.split(',').map(Number);
    const d = dist.get(k) ?? Infinity;
    if (d >= bestD || isOccupied(x, y, c.id) || trappingDomainOwner(c, x, y)) continue;
    bestD = d; best = { x, y };
  }
  return best;
}

export function greedyTurn(c) {
  try {
    // Already within reach of a foe: hold position and act
    if (offence(c)) return { move: null, action: chooseAction(c) };
    const foes = targetPool(c);
    const rooted = c.statusEffects.some(e => e.name.toLowerCase() === 'root');
    const move = foes.length && !rooted && c.speed > 0 ? approachCell(c, foes) : null;
    // Cannot get closer to any foe (stalled): a heal is still worth casting, else pass
    if (!move) return { move: null, action: healCast(c) ?? { type: 'pass' } };
    // Judge the action from the cell the unit is about to stand on
    const from = { x: c.x, y: c.y };
    c.x = move.x; c.y = move.y;
    let action;
    try { action = chooseAction(c); } finally { c.x = from.x; c.y = from.y; }
    return { move, action: action ?? { type: 'pass' } };
  } catch {
    return { move: null, action: { type: 'pass' } };
  }
}

// The first react that is not a teleport, else decline
export function greedyReact() {
  const option = S.reactOptions.find(o => !o.ability.tags?.includes('teleportation'));
  return option ? { combatantId: option.combatantId, abilityName: option.ability.name } : null;
}

// The greedy policy as a Brain: plans for whoever's turn it is
export const greedyBrain = { chooseTurn: () => greedyTurn(activeCombatant()), chooseReact: greedyReact };
