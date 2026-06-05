/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-logic.js — State, game mechanics, action handlers, turn flow
   ═══════════════════════════════════════════════════════════════════════════ */

// ── §1  Imports ────────────────────────────────────────────────────────────
import { EFFECTS } from './main.js';
import { loadManifest, loadMap, cellPxOf, isWalkableG } from './dungeon-loader.js';

// Render functions registered by combat-render.js to break the circular dep.
export const _R = {
  render:              () => {},
  renderCombatScreen:  () => {},
  renderReactOverlay:  () => {},
  renderVictoryScreen: () => {},
};

// ── §2  State ──────────────────────────────────────────────────────────────
export let allChars = [];

export async function loadChars() {
  const res = await fetch('js/characters.json');
  allChars = await res.json();
  try {
    const stored = localStorage.getItem('combatTeams');
    if (stored) {
      const teams = JSON.parse(stored);
      const t0 = (teams[0] ?? []).filter(n => allChars.some(c => c.nom === n));
      const t1 = (teams[1] ?? []).filter(n => allChars.some(c => c.nom === n));
      if (t0.length || t1.length) S.teamNames = [t0, t1];
    }
  } catch {}
}

export const S = {
  phase: 'selection',   // 'selection' | 'initiative' | 'combat' | 'victory'
  teamNames: [[], []],  // up to 4 character names per team
  combatants: [],
  initiativeOrder: [],
  currentTurnIndex: 0,
  roundNumber: 1,
  pendingAction: null,
  awaitingReact: false,
  reactOptions: [],
  activeDomains: [],  // { casterId, domain } for currently active domains
  log: [],
  winnerTeam: null,
  hasActed:    false,   // active combatant used their action this turn
  // ── Map system ──────────────────────────────────────────────────────────
  currentMap:     null,
  mapViewFilter:  'both',
  hasMoved:       false,
  moveMode:       false,
  reachableCells: new Map(),
  // ── Aim / targeting ───────────────────────────────────────────────────────
  aimMode:     false,
  aimAbility:  null,
  aimSection:  null,   // 'spell' | 'tech' | 'attack'
  aimHover:    null,   // { x, y } grid cell under mouse
  // ── Teleport ──────────────────────────────────────────────────────────────
  teleportMode:         false,
  teleportActorId:      null,
  teleportRange:        0,
  pendingTeleportReact: null,
};

// ── Map constants ──────────────────────────────────────────────────────────
export const MAX_MOVE    = 6;    // fallback cells per turn when speed is missing
export const MELEE_RANGE = 1;
export const SPELL_RANGE = 6;

// ── §3  Data Helpers ───────────────────────────────────────────────────────

export function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollD20() {
  const v = rollDie(20);
  return { value: v, isNat20: v === 20, isNat1: v === 1 };
}

export function parseDice(expr) {
  if (!expr || expr === '—' || expr === '-') return { total: 0, breakdown: '—' };
  let s = String(expr);
  s = s.replace(/(\d+)\s*\*\s*(\d+)d(\d+)/gi, (_, mult, cnt, sides) =>
    `${parseInt(mult) * parseInt(cnt)}d${sides}`
  );
  s = s.replace(/(\d+)d(\d+)\s*\*\s*(\d+)/gi, (_, cnt, sides, mult) =>
    `${parseInt(cnt) * parseInt(mult)}d${sides}`
  );
  const parts = [];
  let total = 0;
  let m;
  // Negative dice: -NdS → subtract the roll (e.g. "-1d6+2" reduces damage)
  const negDiceRe = /-(\d+)d(\d+)/gi;
  while ((m = negDiceRe.exec(s)) !== null) {
    const count = parseInt(m[1]), sides = parseInt(m[2]);
    let sub = 0;
    for (let i = 0; i < count; i++) sub += rollDie(sides);
    total -= sub;
    parts.push(`-${count}d${sides}[${sub}]=-${sub}`);
  }
  s = s.replace(/-\d+d\d+/gi, '');  // strip negatives before positive pass
  const diceRe = /(\d+)d(\d+)/gi;
  while ((m = diceRe.exec(s)) !== null) {
    const count = parseInt(m[1]), sides = parseInt(m[2]);
    const rolls = [];
    let sub = 0;
    for (let i = 0; i < count; i++) { const r = rollDie(sides); rolls.push(r); sub += r; }
    total += sub;
    parts.push(`${count}d${sides}[${rolls.join('+')}]=${sub}`);
  }
  const stripped = s.replace(/\d+d\d+/gi, '');
  const bonusRe = /([+-]\s*\d+)(?!\s*%)/g;
  while ((m = bonusRe.exec(stripped)) !== null) {
    const val = parseInt(m[1].replace(/\s/g, ''));
    if (!isNaN(val) && val !== 0) { total += val; parts.push(val > 0 ? `+${val}` : `${val}`); }
  }
  if (parts.length === 0) {
    const numM = s.match(/^(\d+)/);
    if (numM) { total = parseInt(numM[1]); parts.push(String(total)); }
  }
  return { total, breakdown: parts.join(' ') || '0' };
}

export function findEffect(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  return EFFECTS.find(e => e.name.toLowerCase() === n) ?? null;
}

const TAG_TO_STATUS = { freeze: 'gel', poison: 'toxic' };
const STATUS_EFFECT_TAGS = ['para','gel','freeze','burn','bleed','stun','root','fear','silence','blind','toxic','poison'];

// Determine whether an ability targets allies, self, enemies, or both teams
export function getTargetKind(move) {
  if (move.target === 'self') return 'self';
  const tags = move.base.tags ?? [];
  const hasHeal = tags.includes('heal') || tags.includes('regen') || tags.includes('cleans') || tags.includes('buff');
  const hasDmg  = tags.some(t => ['physical','fire','ice','lightning','magic','earth','water','necro','psy','runik','radiant'].includes(t));
  // Hybrid bounce: heals allies, damages enemies
  if (hasHeal && hasDmg && move.target === 'bounce') return 'any';
  const isAlly = hasHeal && !tags.some(t => ['physical', 'necro'].includes(t));
  return isAlly ? 'ally' : 'enemy';
}

// ── §4  Ability Resolution ─────────────────────────────────────────────────

export function resolveAbilitiesFromList(moveList) {
  const list = [];
  for (const move of moveList ?? []) {
    if (!move?.base?.nom) continue;
    const tags           = move.base.tags ?? [];
    const isOncePerFight = move.cooldown === 99;
    const statusTags     = tags.filter(t => STATUS_EFFECT_TAGS.includes(t));

    let cost = null;
    if      (move.spellCost)  cost = { type: 'slots', amount: move.spellCost };
    else if (move.kiCost)     cost = { type: 'ki',    amount: move.kiCost };
    else if (move.soulCost)   cost = { type: 'souls', amount: move.soulCost };

    list.push({
      name:          move.base.nom,
      source:        move.category,
      dice:          move.base.dices ?? null,
      cooldownTurns: isOncePerFight ? 0 : (move.cooldown ?? 0),
      cost,
      effect:        move.effect ?? (statusTags.length ? statusTags.map(t => TAG_TO_STATUS[t] ?? t).join(', ') : null),
      isOncePerFight,
      desc:          move.description ?? '',
      tags,
      target:        move.target ?? 'mono',
      targetKind:    getTargetKind(move),
      range:         move.range ?? SPELL_RANGE,
      radius:        move.radius ?? 0,
      maxBounce:     move.maxBounce ?? 0,
      bounceRange:   move.range ?? SPELL_RANGE,
      slotRegen:     move.slotRegen ?? 0,
      precastDice:   move.precastDice ?? null,
      maxCharges:    move.charges ?? 0,
      isReact:    tags.includes('react'),
      isBlock:    tags.includes('block'),
      isInstant:  tags.includes('instant'),
      isAoe:      move.target === 'aoe',
      isCone:     move.target === 'cone',
      isSplash:   move.target === 'splash',
      isHeal:     tags.includes('heal') || tags.includes('regen'),
      isRevive:   tags.includes('revive'),
      isTransform: move.category === 'transformation',
    });
  }
  return list;
}

export function resolveAbilities(char) {
  return resolveAbilitiesFromList(char.moveSet);
}

// ── §5  Factory ────────────────────────────────────────────────────────────

export function buildCombatant(char, teamIndex, id) {
  const maxKi = char.ki ?? 0;
  return {
    id,
    teamIndex,
    name: char.nom,
    sourceChar: char,
    maxHp: char.hp,
    currentHp: char.hp,
    spellSlots:    char.spellSlot ?? 0,
    maxSpellSlots: char.spellSlot ?? 0,
    ki: maxKi,
    maxKi,
    kiRegen: char.kiRegen ?? 0,
    souls: char.souls ?? 0,
    speed: char.speed ?? MAX_MOVE,
    abilities: resolveAbilities(char),
    initiativeRoll: 0,
    isKO: false,
    cooldowns:        {},
    remainingCharges: {},
    usedThisFight: [],
    statusEffects: char.passif?.some(p => p.tags?.includes('fly'))
      ? [{ name: 'fly', turnsLeft: 999, dice: null, damType: null, notes: '' }]
      : [],
    hasCounterAttack: false,
    isTransformed:    false,
    transformedBaseAtk: null,
    domainActive:     false,
    domainCharges:    char.domain ? Math.max(1, Math.floor((char.domain.rafinement ?? 0) / 3)) : 0,
    shadowCounterBonus: 0,
    x: 0,
    y: 0,
  };
}

// ── §6  Lookups ────────────────────────────────────────────────────────────

export function getCombatant(id) { return S.combatants.find(c => c.id === id); }
export function livingCombatants(teamIndex) {
  return S.combatants.filter(c => c.teamIndex === teamIndex && !c.isKO);
}
export function koAllies(teamIndex) {
  return S.combatants.filter(c => c.teamIndex === teamIndex && c.isKO);
}
export function activeCombatant() {
  return getCombatant(S.initiativeOrder[S.currentTurnIndex]);
}
export function enemies(c) {
  return livingCombatants(c.teamIndex === 0 ? 1 : 0);
}
export function allies(c) {
  return livingCombatants(c.teamIndex);
}

// Returns domain effects matching the given context for a combatant with an active domain
export function getDomainEffects(combatant, context = {}) {
  if (!combatant.domainActive) return [];
  const domain = combatant.sourceChar.domain;
  if (!domain) return [];
  return (domain.effects ?? []).filter(eff => {
    if (!eff.applyOn?.includes(context.applyOn)) return false;
    if (eff.target === 'foes') return false; // foe effects handled in beginTurn
    const cond = eff.condition ?? null;
    if (cond) {
      const ab = context.ability ?? null;
      if (cond.foeJustMissed != null && !context.foeJustMissed) return false;
      if (cond.moveHasTag  && !ab?.tags?.includes(cond.moveHasTag))  return false;
      if (cond.category    && ab?.source !== cond.category)           return false;
      if (cond.weaponType  && !ab?.tags?.includes(cond.weaponType))   return false;
      if (cond.moveName    && ab?.name   !== cond.moveName)           return false;
    }
    return true;
  });
}

export function abilityAvailable(c, ab) {
  if ((c.cooldowns[ab.name] ?? 0) > 0) {
    // Domain: no cooldown on matching abilities
    const domainNoCD = getDomainEffects(c, { applyOn: 'cooldown', ability: ab });
    if (domainNoCD.length === 0) return false;
  }
  if (ab.isOncePerFight && c.usedThisFight.includes(ab.name)) return false;
  if (ab.maxCharges > 0 && (c.remainingCharges[ab.name] ?? ab.maxCharges) <= 0) return false;
  if (ab.cost) {
    if (ab.cost.type === 'ki'    && c.ki < ab.cost.amount)         return false;
    if (ab.cost.type === 'slots' && c.spellSlots < ab.cost.amount) return false;
    if (ab.cost.type === 'souls' && c.souls < ab.cost.amount)      return false;
  }
  return true;
}

export function hasSilence(c) {
  return c.statusEffects.some(e => e.name.toLowerCase() === 'silence');
}

export function hasControlEffect(c) {
  const controls = ['para', 'gel', 'stun', 'cocoon', 'fear'];  // root removed: only blocks movement, not action
  return c.statusEffects.find(e => controls.includes(e.name.toLowerCase())) ?? null;
}

// ── §7  Map & Movement ─────────────────────────────────────────────────────

export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function hasLos(ax, ay, bx, by) {
  if (!S.currentMap) return true;
  let x0 = ax, y0 = ay;
  const dx = Math.abs(bx - x0), dy = Math.abs(by - y0);
  const sx = x0 < bx ? 1 : -1, sy = y0 < by ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x0 === bx && y0 === by) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
    if ((x0 !== bx || y0 !== by) && !isWalkableG(S.currentMap, x0, y0)) return false;
  }
}

export function bfsReachable(sx, sy, maxDist) {
  const visited = new Map();
  const queue   = [{ x: sx, y: sy, dist: 0 }];
  visited.set(`${sx},${sy}`, 0);
  const dirs = [
    { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 0  },                     { dx: 1, dy: 0  },
    { dx: -1, dy: 1  }, { dx: 0, dy: 1  }, { dx: 1, dy: 1  },
  ];
  while (queue.length) {
    const { x, y, dist } = queue.shift();
    if (dist >= maxDist) continue;
    for (const { dx, dy } of dirs) {
      const nx = x + dx, ny = y + dy;
      const key = `${nx},${ny}`;
      if (!visited.has(key) && isWalkableG(S.currentMap, nx, ny)) {
        visited.set(key, dist + 1);
        queue.push({ x: nx, y: ny, dist: dist + 1 });
      }
    }
  }
  visited.delete(`${sx},${sy}`);
  return visited;
}

export function isOccupied(x, y, excludeId = -1) {
  return S.combatants.find(c => c.x === x && c.y === y && c.id !== excludeId && !c.isKO) ?? null;
}

export function placeCharacters(map) {
  for (const teamIdx of [0, 1]) {
    const spots = map.starts[teamIdx];
    const team  = S.combatants.filter(c => c.teamIndex === teamIdx);
    team.forEach((c, i) => {
      const pos = spots[Math.min(i, spots.length - 1)];
      c.x = pos.x; c.y = pos.y;
    });
  }
}

export function targetInRange(actor, target, ability) {
  const dist = chebyshev(actor, target);
  if (!ability) {
    if (dist > MELEE_RANGE) return { inRange: false, reason: 'Must be adjacent to attack' };
    if (S.currentMap && !hasLos(actor.x, actor.y, target.x, target.y))
      return { inRange: false, reason: 'No line of sight' };
    return { inRange: true, reason: '' };
  }
  if (ability.isAoe) return { inRange: true, reason: '' };
  const maxRange = ability.range ?? SPELL_RANGE;
  if (dist > maxRange) return { inRange: false, reason: `Out of range (max ${maxRange})` };
  if (S.currentMap && !hasLos(actor.x, actor.y, target.x, target.y))
    return { inRange: false, reason: 'No line of sight' };
  return { inRange: true, reason: '' };
}

export function computeAimOverlay(caster, ability) {
  if (!S.currentMap || !ability) return { inRangeCells: new Set(), losCells: new Set(), validTargetIds: new Map() };
  const range = ability.range ?? SPELL_RANGE;
  const { cols, rows } = S.currentMap.grid;
  const inRangeCells = new Set();
  const losCells     = new Set();
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (gx === caster.x && gy === caster.y) continue;
      if (Math.max(Math.abs(gx - caster.x), Math.abs(gy - caster.y)) > range) continue;
      if (!isWalkableG(S.currentMap, gx, gy)) continue;
      const key = `${gx},${gy}`;
      inRangeCells.add(key);
      if (hasLos(caster.x, caster.y, gx, gy)) losCells.add(key);
    }
  }
  const isAlly     = ability.targetKind === 'ally';
  const isAny      = ability.targetKind === 'any';
  const targetTeam = isAlly ? caster.teamIndex : (caster.teamIndex === 0 ? 1 : 0);
  const candidates = isAny
    ? S.combatants.filter(c => !c.isKO && c.id !== caster.id)
    : livingCombatants(targetTeam);
  const validTargetIds = new Map();
  for (const t of candidates) {
    if (losCells.has(`${t.x},${t.y}`)) validTargetIds.set(t.id, t);
  }
  return { inRangeCells, losCells, validTargetIds };
}

export function coneCells(caster, ability, dirCell) {
  if (!dirCell || !S.currentMap) return [];
  const { cols, rows } = S.currentMap.grid;
  const dx = dirCell.x - caster.x, dy = dirCell.y - caster.y;
  if (dx === 0 && dy === 0) return [];
  const dirAngle = Math.atan2(dy, dx);
  const HALF_CONE = Math.PI / 6; // 30° each side = 60° total
  const cells = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (gx === caster.x && gy === caster.y) continue;
      if (Math.max(Math.abs(gx - caster.x), Math.abs(gy - caster.y)) > (ability.range ?? SPELL_RANGE)) continue;
      const angle = Math.atan2(gy - caster.y, gx - caster.x);
      let diff = Math.abs(angle - dirAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= HALF_CONE) cells.push({ x: gx, y: gy });
    }
  }
  return cells;
}

export function coneCellTargets(caster, ability, dirCell) {
  const cells = coneCells(caster, ability, dirCell);
  const teamIdx = caster.teamIndex === 0 ? 1 : 0;
  return livingCombatants(teamIdx)
    .filter(t => cells.some(c => c.x === t.x && c.y === t.y));
}

export function aoeCombatantHits(ability, caster, cx, cy) {
  const radius  = ability.radius > 0 ? ability.radius : 1;
  const isAlly  = ability.targetKind === 'ally';
  const teamIdx = isAlly ? caster.teamIndex : (caster.teamIndex === 0 ? 1 : 0);
  return livingCombatants(teamIdx)
    .filter(t => chebyshev({ x: cx, y: cy }, t) <= radius);
}

export function hasValidTarget(actor, ability) {
  if (!ability) {
    return livingCombatants(actor.teamIndex === 0 ? 1 : 0)
      .some(t => targetInRange(actor, t, null).inRange);
  }
  if (ability.isAoe || ability.isCone || ability.isSplash) return true;
  if (ability.targetKind === 'self')  return true;
  if (ability.targetKind === 'ally')  return livingCombatants(actor.teamIndex).length > 0 || (ability.isRevive && koAllies(actor.teamIndex).length > 0);
  if (ability.targetKind === 'any')
    return S.combatants.some(t => !t.isKO && t.id !== actor.id && targetInRange(actor, t, ability).inRange);
  return livingCombatants(actor.teamIndex === 0 ? 1 : 0)
    .some(t => targetInRange(actor, t, ability).inRange);
}

export function clearAimState() {
  S.aimMode = false; S.aimAbility = null; S.aimSection = null; S.aimHover = null;
  document.getElementById('dungeon-canvas')?.classList.remove('aim-mode');
}

export function enterAimMode(ability, section) {
  if (!S.currentMap) return;
  S.aimMode    = true;
  S.aimAbility = ability;
  S.aimSection = section;
  S.aimHover   = null;
  document.getElementById('dungeon-canvas')?.classList.add('aim-mode');
  drawMap();
}

export function exitAimMode() {
  clearAimState();
  drawMap();
}

export function enterTeleportMode(c, range) {
  S.teleportMode    = true;
  S.teleportActorId = c.id;
  S.teleportRange   = range;
  document.getElementById('dungeon-canvas')?.classList.add('teleport-mode');
  drawMap();
}

export function exitTeleportMode() {
  S.teleportMode    = false;
  S.teleportActorId = null;
  S.teleportRange   = 0;
  document.getElementById('dungeon-canvas')?.classList.remove('teleport-mode');
  drawMap();
}

export function enterMoveMode() {
  const c = activeCombatant();
  if (!c || S.hasMoved || !S.currentMap) return;
  if (c.statusEffects.some(e => e.name.toLowerCase() === 'root')) {
    addLog(`${c.name} is rooted and cannot move!`, 'status');
    return;
  }
  S.moveMode = true;
  S.reachableCells = bfsReachable(c.x, c.y, c.speed);

  // Remove cells that exit a non-open active enemy domain (only if already inside it)
  for (const ad of S.activeDomains) {
    if (ad.domain.type === 'Ouvert') continue;
    const owner = getCombatant(ad.casterId);
    if (!owner || owner.isKO || owner.teamIndex === c.teamIndex) continue;
    const domainRadius = ad.domain.radius ?? 8;
    const center = { x: ad.centerX, y: ad.centerY };
    if (chebyshev(c, center) > domainRadius) continue; // character already outside — no restriction
    const toDelete = [];
    for (const key of S.reachableCells.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (chebyshev({ x: kx, y: ky }, center) > domainRadius) toDelete.push(key);
    }
    for (const key of toDelete) S.reachableCells.delete(key);
  }

  const canvas = document.getElementById('dungeon-canvas');
  if (canvas) canvas.classList.add('move-mode');
  drawMap();
}

export function exitMoveMode() {
  S.moveMode = false;
  S.reachableCells = new Map();
  const canvas = document.getElementById('dungeon-canvas');
  if (canvas) canvas.classList.remove('move-mode');
  drawMap();
}

export function handleMoveClick(gx, gy) {
  if (!S.moveMode) return;
  const c = activeCombatant();
  if (!c) return;
  const key = `${gx},${gy}`;
  if (!S.reachableCells.has(key)) return;
  if (isOccupied(gx, gy, c.id)) { addLog('That cell is occupied.', 'info'); return; }
  for (const ad of S.activeDomains) {
    if (ad.domain.type === 'Ouvert') continue;
    const owner = getCombatant(ad.casterId);
    if (!owner || owner.isKO || owner.teamIndex === c.teamIndex) continue;
    const domainRadius = ad.domain.radius ?? 8;
    const center = { x: ad.centerX, y: ad.centerY };
    if (chebyshev(c, center) > domainRadius) continue; // already outside — no restriction
    if (chebyshev({ x: gx, y: gy }, center) > domainRadius) {
      addLog(`⛔ ${c.name} is trapped within ${owner.name}'s domain!`, 'status');
      return;
    }
  }
  addLog(`${c.name} moves to (${gx}, ${gy}).`, 'info');
  c.x = gx; c.y = gy;
  S.hasMoved = true;
  exitMoveMode();
  _R.renderCombatScreen();
}

export function setupCanvasClickHandler() {
  const canvas = document.getElementById('dungeon-canvas');
  if (!canvas) return;

  if (canvas._clickHandler)  canvas.removeEventListener('click',     canvas._clickHandler);
  if (canvas._moveHandler)   canvas.removeEventListener('mousemove', canvas._moveHandler);
  if (canvas._leaveHandler)  canvas.removeEventListener('mouseleave',canvas._leaveHandler);

  const cellCoords = (e) => {
    const rect  = canvas.getBoundingClientRect();
    const cp    = cellPxOf(S.currentMap);
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;
    return {
      gx: Math.floor((canvas.height - my) / cp),
      gy: Math.floor(mx / cp),
    };
  };

  canvas._clickHandler = (e) => {
    const { gx, gy } = cellCoords(e);
    if (S.teleportMode) {
      const actor = getCombatant(S.teleportActorId);
      const teleportBlockedByDomain = S.activeDomains.some(ad => {
        if (ad.domain.type === 'Ouvert') return false;
        const owner = getCombatant(ad.casterId);
        if (!owner || owner.isKO || owner.teamIndex === actor?.teamIndex) return false;
        const domainRadius = ad.domain.radius ?? 8;
        const center = { x: ad.centerX, y: ad.centerY };
        return chebyshev(actor, center) <= domainRadius
          && chebyshev({ x: gx, y: gy }, center) > domainRadius;
      });
      if (actor && chebyshev(actor, { x: gx, y: gy }) <= S.teleportRange
          && isWalkableG(S.currentMap, gx, gy) && !isOccupied(gx, gy, actor.id)
          && !teleportBlockedByDomain) {
        addLog(`✦ ${actor.name} teleports to (${gx}, ${gy})!`, 'spell');
        actor.x = gx; actor.y = gy;
        const reactAbility = S.pendingTeleportReact;
        S.pendingTeleportReact = null;
        exitTeleportMode();
        if (reactAbility) {
          resumePendingAction(reactAbility);
        } else {
          _R.renderCombatScreen();
        }
      }
      return;
    }
    if (S.aimMode) {
      const active      = activeCombatant();
      const abilityName = S.aimAbility.name;
      const section     = S.aimSection;

      if (S.aimAbility.isAoe) {
        const range = S.aimAbility.range ?? SPELL_RANGE;
        if (chebyshev(active, { x: gx, y: gy }) <= range) {
          const hits = aoeCombatantHits(S.aimAbility, active, gx, gy);
          exitAimMode();
          const hintEl = document.getElementById('aim-hint-ability');
          if (hintEl) hintEl.style.display = 'none';
          handleCastAbility(active.id, abilityName, hits.map(t => t.id));
        }
        return;
      } else if (S.aimAbility.isCone) {
        const targets = coneCellTargets(active, S.aimAbility, { x: gx, y: gy });
        exitAimMode();
        handleCastAbility(active.id, abilityName, targets.map(t => t.id));
      } else {
        const overlay = computeAimOverlay(active, S.aimAbility);
        const hit     = [...overlay.validTargetIds.values()].find(c => c.x === gx && c.y === gy);
        if (hit) {
          exitAimMode();
          const hintEl = document.getElementById('aim-hint-ability');
          if (hintEl) hintEl.style.display = 'none';
          if (section === 'attack') handleAttack(active.id, hit.id);
          else                      handleCastAbility(active.id, abilityName, [hit.id]);
        }
      }
      return;
    }
    if (!S.moveMode) return;
    handleMoveClick(gx, gy);
  };

  canvas._moveHandler = (e) => {
    if (!S.aimMode || !S.currentMap) return;
    const { gx, gy } = cellCoords(e);
    if (S.aimHover?.x !== gx || S.aimHover?.y !== gy) {
      S.aimHover = { x: gx, y: gy };
      drawMap();
    }
  };

  canvas._leaveHandler = () => {
    if (!S.aimMode) return;
    S.aimHover = null;
    drawMap();
  };

  canvas.addEventListener('click',      canvas._clickHandler);
  canvas.addEventListener('mousemove',  canvas._moveHandler);
  canvas.addEventListener('mouseleave', canvas._leaveHandler);
}

export function drawMap() {
  const canvas = document.getElementById('dungeon-canvas');
  if (!canvas || !S.currentMap) return;
  const { image } = S.currentMap;
  canvas.width  = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const ctx    = canvas.getContext('2d');
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  const cp     = cellPxOf(S.currentMap);
  const active = activeCombatant();
  ctx.drawImage(image, 0, 0);

  // Draw active domain zones
  if (S.activeDomains.length > 0) {
    const { cols, rows } = S.currentMap.grid;
    const DOMAIN_FILL   = ['rgba(74,144,217,0.13)', 'rgba(217,74,74,0.13)'];
    const DOMAIN_BORDER = ['rgba(74,144,217,0.65)', 'rgba(217,74,74,0.65)'];
    const OPEN_FILL     = ['rgba(74,217,144,0.10)', 'rgba(217,144,74,0.10)'];
    const OPEN_BORDER   = ['rgba(74,217,144,0.50)', 'rgba(217,144,74,0.50)'];
    for (const ad of S.activeDomains) {
      const owner = getCombatant(ad.casterId);
      if (!owner || owner.isKO) continue;
      const domainRadius = ad.domain.radius ?? 8;
      const isOpen = ad.domain.type === 'Ouvert';
      const ti = owner.teamIndex;
      ctx.fillStyle   = isOpen ? (OPEN_FILL[ti]   ?? OPEN_FILL[0])   : (DOMAIN_FILL[ti]   ?? DOMAIN_FILL[0]);
      ctx.strokeStyle = isOpen ? (OPEN_BORDER[ti]  ?? OPEN_BORDER[0]) : (DOMAIN_BORDER[ti]  ?? DOMAIN_BORDER[0]);
      ctx.lineWidth = 2;
      ctx.setLineDash(isOpen ? [4, 4] : []);
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const dist = chebyshev({ x: gx, y: gy }, { x: ad.centerX, y: ad.centerY });
          if (dist <= domainRadius) ctx.fillRect(gx * cp, gy * cp, cp, cp);
          if (dist === domainRadius) ctx.strokeRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
    }
    ctx.setLineDash([]);
  }

  if (S.moveMode && S.reachableCells.size > 0) {
    ctx.fillStyle = 'rgba(74,144,217,0.35)';
    for (const [key] of S.reachableCells) {
      const [gx, gy] = key.split(',').map(Number);
      if (!isOccupied(gx, gy, active?.id ?? -1))
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
    }
    if (active) {
      ctx.strokeStyle = 'rgba(74,144,217,0.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(active.x * cp + 1, active.y * cp + 1, cp - 2, cp - 2);
    }
  }
  if (S.aimMode && S.aimAbility && active) {
    if (S.aimAbility.isAoe) {
      const range   = S.aimAbility.range ?? SPELL_RANGE;
      const radius  = S.aimAbility.radius > 0 ? S.aimAbility.radius : 1;
      const { cols, rows } = S.currentMap.grid;
      ctx.fillStyle = 'rgba(255,140,0,0.12)';
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (!isWalkableG(S.currentMap, gx, gy)) continue;
          if (chebyshev(active, { x: gx, y: gy }) <= range)
            ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
      if (S.aimHover && chebyshev(active, S.aimHover) <= range) {
        const { x: hx, y: hy } = S.aimHover;
        ctx.fillStyle = 'rgba(255,100,0,0.38)';
        for (let gy = 0; gy < rows; gy++) {
          for (let gx = 0; gx < cols; gx++) {
            if (chebyshev({ x: hx, y: hy }, { x: gx, y: gy }) <= radius)
              ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
          }
        }
        ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
        for (const t of aoeCombatantHits(S.aimAbility, active, hx, hy)) {
          ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
        }
      }
    } else if (S.aimAbility.isCone) {
      const dirCell  = S.aimHover ?? null;
      const cells    = dirCell ? coneCells(active, S.aimAbility, dirCell) : [];
      // Reuse cells instead of calling coneCellTargets (avoids a second full grid sweep)
      const cellSet  = new Set(cells.map(cell => `${cell.x},${cell.y}`));
      const hits     = livingCombatants(active.teamIndex === 0 ? 1 : 0)
        .filter(t => cellSet.has(`${t.x},${t.y}`));
      const { losCells } = computeAimOverlay(active, S.aimAbility);
      ctx.fillStyle = 'rgba(255,140,0,0.10)';
      for (const [key] of (losCells.entries?.() ?? [])) {
        const [gx, gy] = key.split(',').map(Number);
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.fillStyle = 'rgba(255,140,0,0.35)';
      for (const { x: gx, y: gy } of cells) {
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
      for (const t of hits) {
        ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
      }
    } else {
      const { inRangeCells, losCells, validTargetIds } = computeAimOverlay(active, S.aimAbility);
      ctx.fillStyle = 'rgba(80,80,80,0.45)';
      for (const key of inRangeCells) {
        if (!losCells.has(key)) {
          const [gx, gy] = key.split(',').map(Number);
          ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
      ctx.fillStyle = 'rgba(255,140,0,0.22)';
      for (const key of losCells) {
        const [gx, gy] = key.split(',').map(Number);
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
      for (const t of validTargetIds.values()) {
        ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
      }
      if (S.aimHover) {
        const { x: hx, y: hy } = S.aimHover;
        if (losCells.has(`${hx},${hy}`)) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(hx * cp + 1, hy * cp + 1, cp - 2, cp - 2);
        }
      }
    }
  }
  if (S.teleportMode) {
    const actor = getCombatant(S.teleportActorId);
    if (actor) {
      const { cols, rows } = S.currentMap.grid;
      ctx.fillStyle = 'rgba(168,85,247,0.25)';
      for (let gy = 0; gy < rows; gy++)
        for (let gx = 0; gx < cols; gx++)
          if (isWalkableG(S.currentMap, gx, gy) && chebyshev(actor, { x: gx, y: gy }) <= S.teleportRange)
            ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
    }
  }
  const TEAM_COL = ['#4A90D9', '#D94A4A'];
  const filter   = S.mapViewFilter;
  const showTeam = (ti) => filter === 'both' || (filter === 'team0' ? ti === 0 : ti === 1);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3;
  for (const c of S.combatants) {
    if (c.isKO || !showTeam(c.teamIndex)) continue;
    const cx = c.x * cp + cp / 2, cy = c.y * cp + cp / 2;
    const isAct = active?.id === c.id;
    const radius = cp * (isAct ? 0.42 : 0.34);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = c.isTransformed ? '#a855f7' : TEAM_COL[c.teamIndex];
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isAct ? '#E4B14A' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = isAct ? 2.5 : 1;
    ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(cp * 0.4)}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(c.name[0].toUpperCase(), cx, cy);
  }
  ctx.shadowBlur = 0;
}

// ── §8  Log ────────────────────────────────────────────────────────────────

export function addLog(text, flavor = 'info') {
  S.log.push({ text, flavor });
  const panel = document.getElementById('combat-log');
  if (!panel) return;
  const div = document.createElement('div');
  div.className = flavor === 'divider' ? 'log-round-divider' : `log-entry log-${flavor}`;
  div.textContent = text;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

export function addRoundDivider() {
  addLog(`─── Round ${S.roundNumber} ───`, 'divider');
}

// ── §9  Combat Logic ───────────────────────────────────────────────────────

export function updateCombatantCardDOM(c) {
  const card = document.querySelector(`.combat-char-card[data-id="${c.id}"]`);
  if (!card) return;
  const pct  = Math.max(0, (c.currentHp / c.maxHp) * 100);
  const bar  = card.querySelector('.hp-bar');
  const text = card.querySelector('.hp-text');
  if (bar)  { bar.style.width = `${pct.toFixed(1)}%`; bar.className = `hp-bar${pct < 25 ? ' low' : pct < 50 ? ' mid' : ''}`; }
  if (text) text.textContent = `${c.currentHp} / ${c.maxHp} HP`;
  if (c.isKO) card.classList.add('is-ko');
}

export function applyHeal(combatant, diceExpr) {
  if (!diceExpr) return;
  const r      = parseDice(diceExpr);
  const amount = Math.max(0, r.total);
  const healed = Math.min(amount, combatant.maxHp - combatant.currentHp);
  combatant.currentHp = Math.min(combatant.maxHp, combatant.currentHp + amount);
  if (healed > 0)
    addLog(`💚 ${combatant.name} recovers ${healed} HP! (${combatant.currentHp}/${combatant.maxHp}) [${r.breakdown}]`, 'heal');
  updateCombatantCardDOM(combatant);
}

export function applyDamage(combatant, amount, damType = null, atkTags = [], ignoreDR = false) {
  // Living Blade Armor: halve incoming physical before any absorption
  const bladeArmor = combatant.statusEffects.find(e => e.name === 'living_blade_armor');
  if (bladeArmor && atkTags.includes('physical')) {
    amount = Math.floor(amount / 2);
    combatant.statusEffects = combatant.statusEffects.filter(e => e !== bladeArmor);
    addLog(`⚔ ${combatant.name}'s Living Blade Armor halves the physical hit! (→ ${amount})`, 'spell');
  }
  // Damage-absorption shield / chains check (bypassed by unblockabled or antiMagic on spell/art shields)
  const dmgShield = combatant.statusEffects.find(e => e.name === 'damage_shield' || e.name === 'chains_of_apophis');
  const MAGIC_SOURCES = ['spell', 'Art', 'technoSpell'];
  if (dmgShield && atkTags.includes('antiMagic') && MAGIC_SOURCES.includes(dmgShield.source)) {
    addLog(`🔮 ${combatant.name}'s magical shield is dispelled by Anti-Magic!`, 'info');
    combatant.statusEffects = combatant.statusEffects.filter(e => e !== dmgShield);
    updateCombatantCardDOM(combatant);
    // fall through — damage is not absorbed
  } else if (dmgShield && amount > 0 && !atkTags.includes('unblockabled')) {
    const absorbed = Math.min(dmgShield.shieldHp, amount);
    dmgShield.shieldHp -= absorbed;
    amount -= absorbed;
    const isChains = dmgShield.name === 'chains_of_apophis';
    addLog(`${isChains ? '⛓' : '🛡'} ${combatant.name}'s ${isChains ? 'Chains of Apophis absorb' : 'shield absorbs'} ${absorbed}! (${dmgShield.shieldHp} HP left)`, 'spell');
    if (dmgShield.shieldHp <= 0) {
      combatant.statusEffects = combatant.statusEffects.filter(e => e !== dmgShield);
      addLog(isChains ? `⛓ Chains of Apophis shattered!` : `🛡 ${combatant.name}'s shield is destroyed!`, 'spell');
    }
    if (amount <= 0) { updateCombatantCardDOM(combatant); return; }
  }
  // Immunity check — match against primary damType OR any tag in the attack's tag list
  const matchedImmunity = combatant.sourceChar.immunities?.find(
    imm => (damType && imm.toLowerCase() === damType.toLowerCase())
           || atkTags.some(t => t.toLowerCase() === imm.toLowerCase())
  );
  if (matchedImmunity) {
    addLog(`🛡 ${combatant.name} is immune to ${matchedImmunity}!`, 'info');
    return;
  }
  // Conditional incoming damage reduction passives (e.g. Magic Resist -10, Wind Body -20)
  for (const p of combatant.sourceChar.passif ?? []) {
    if (ignoreDR) break;
    if (!p.applyOn?.includes('incomingDam') || !p.dices || !p.condition?.incomingHasTag || amount <= 0) continue;
    const condTag = p.condition.incomingHasTag.toLowerCase();
    const matches = damType?.toLowerCase() === condTag || atkTags.some(t => t.toLowerCase() === condTag);
    if (!matches) continue;
    const r = parseDice(p.dices);
    if (r.total >= 0) continue;
    const before = amount;
    amount = Math.max(0, amount + r.total);
    addLog(`🛡 ${combatant.name}'s "${p.nom}" reduces incoming damage by ${before - amount}! (${before} → ${amount})`, 'info');
  }
  // Unkillable / incoming-damage reduction passives
  for (const p of combatant.sourceChar.passif ?? []) {
    if (p.applyOn?.includes('incomingDam') && p.condition?.incomingIsLethal && p.dices) {
      if (amount >= combatant.currentHp) {
        const reduced = parseDice(p.dices);
        amount = Math.min(amount, reduced.total);
        addLog(`🛡 ${combatant.name}'s "${p.nom}" reduces the lethal hit! [${reduced.breakdown}]`, 'info');
      }
    }
  }
  const dmg = Math.max(0, amount);
  combatant.currentHp = Math.max(0, combatant.currentHp - dmg);
  if (combatant.currentHp <= 0 && !combatant.isKO) {
    const resAb = combatant.abilities.find(a =>
      a.name === 'Resurrection' && a.isOncePerFight && !combatant.usedThisFight.includes('Resurrection')
    );
    if (resAb) {
      combatant.currentHp = 150;
      combatant.usedThisFight.push('Resurrection');
      addLog(`💀✨ ${combatant.name} RESURRECTS with 150 HP — Final Reckoning activates!`, 'crit');
      combatant.statusEffects.push({ name: 'final_reckoning', turnsLeft: 999, dice: '2d12', damType: null, notes: '+2d12 atk bonus' });
    } else {
      combatant.isKO = true;
      addLog(`💀 ${combatant.name} is KO!`, 'death');
      if (combatant.domainActive) suppressDomain(combatant);
    }
  }
  updateCombatantCardDOM(combatant);
}

export function applyStatus(combatant, effectStr, defaultTurns = 2) {
  if (!effectStr) return;
  if (combatant.sourceChar.immunities?.some(imm => imm.toLowerCase() === 'status')) {
    addLog(`🛡 ${combatant.name} is immune to all status effects!`, 'info');
    return;
  }
  for (const part of String(effectStr).split(',')) {
    const p = part.trim();
    if (!p) continue;
    // "1dN effect" = 1/N probability check; succeed only on max roll (N)
    const probMatch = p.match(/^1d(\d+)\s+(.+)$/i);
    const effName   = probMatch ? probMatch[2].trim() : p;
    if (probMatch) {
      const sides = parseInt(probMatch[1]);
      const roll  = Math.floor(Math.random() * sides) + 1;
      if (roll < sides) {
        addLog(`${combatant.name} resists ${effName}. (${roll}/${sides})`, 'info');
        continue;
      }
    }
    const turns = defaultTurns;

    if (combatant.sourceChar.immunities?.some(
      imm => imm.toLowerCase() === effName.toLowerCase()
    )) {
      addLog(`🛡 ${combatant.name} is immune to ${effName}!`, 'info');
      continue;
    }

    const eff      = findEffect(effName);
    const existing = combatant.statusEffects.find(e => e.name.toLowerCase() === effName.toLowerCase());
    if (existing) {
      existing.turnsLeft = Math.max(existing.turnsLeft, turns);
    } else {
      combatant.statusEffects.push({
        name:      eff ? eff.name : effName,
        turnsLeft: turns,
        dice:      eff?.dice ?? null,
        damType:   eff?.type ?? '—',
        notes:     eff?.notes ?? '',
      });
      addLog(`${combatant.name} is now affected by ${eff ? eff.name : effName} (${turns}t)!`, 'status');
    }
  }
}

export function tickTurn(c) {
  const dotNames  = ['burn', 'toxic', 'toxic shock', 'bleed', 'hemoragie'];
  const regenNames = ['regen', 'domain regen', 'regeneration'];
  const expired   = [];

  for (const eff of c.statusEffects) {
    const n = eff.name.toLowerCase();
    if (dotNames.includes(n) && eff.dice && eff.dice !== '—') {
      const r = parseDice(eff.dice);
      applyDamage(c, r.total, eff.damType);
      addLog(`${c.name} takes ${r.total} ${eff.damType} from ${eff.name}. (${r.breakdown})`, 'status');
      if (c.isKO) return false;
    }
    if (regenNames.some(rn => n.includes(rn)) && eff.dice && eff.dice !== '—') {
      applyHeal(c, eff.dice);
    }
    eff.turnsLeft--;
    if (eff.turnsLeft <= 0) expired.push(eff.name);
  }
  c.statusEffects = c.statusEffects.filter(e => !expired.includes(e.name));
  for (const n of expired) addLog(`${c.name}'s ${n} wears off.`, 'info');

  if (c.kiRegen > 0 && c.ki < c.maxKi) c.ki = Math.min(c.maxKi, c.ki + c.kiRegen);

  for (const key of Object.keys(c.cooldowns)) c.cooldowns[key] = Math.max(0, c.cooldowns[key] - 1);
  return true;
}

export function applyHpPerHitPassives(combatant) {
  for (const p of combatant.sourceChar.passif ?? []) {
    if (!p.applyOn?.includes('hpPerHit') || !p.dices) continue;
    const r = parseDice(p.dices);
    applyHeal(combatant, p.dices);
    addLog(`  💚 ${combatant.name} [${p.nom}] heals ${r.total} HP! (${combatant.currentHp}/${combatant.maxHp})`, 'heal');
  }
}

export function removeFlying(target) {
  const idx = target.statusEffects.findIndex(e => e.name.toLowerCase() === 'fly');
  if (idx !== -1) {
    target.statusEffects.splice(idx, 1);
    addLog(`⬇ ${target.name} is grounded — fly removed!`, 'status');
    updateCombatantCardDOM(target);
  }
}

export function applyCleanse(target) {
  const NEGATIVE = ['para','gel','freeze','burn','bleed','stun','root','fear','silence','blind','toxic','poison'];
  const removed = target.statusEffects.filter(e => NEGATIVE.some(n => e.name.toLowerCase().includes(n)));
  target.statusEffects = target.statusEffects.filter(e => !NEGATIVE.some(n => e.name.toLowerCase().includes(n)));
  if (removed.length > 0)
    addLog(`✨ ${target.name}'s ${removed.map(e => e.name).join(', ')} cleansed!`, 'heal');
  else
    addLog(`✨ ${target.name} has no debuffs to cleanse.`, 'info');
  updateCombatantCardDOM(target);
}

export function damTypeFromTags(tags) {
  const dmgTags = ['fire','ice','lightning','physical','magic','earth','water','necro','psy','runik','radiant'];
  return tags.find(t => dmgTags.includes(t)) ?? null;
}

export function resolveAttack(attacker, defender, diceExpr, ability = null) {
  const domainAtkEffs = getDomainEffects(attacker, { applyOn: 'atkRoll', ability });
  const domainAdv     = domainAtkEffs.some(e => e.tags?.includes('adv'));
  const domainSureHit = domainAtkEffs.some(e => e.tags?.includes('undodgeable'));

  const roll1    = rollD20();
  const roll2    = domainAdv ? rollD20() : null;
  const atkRoll  = domainAdv
    ? (roll1.value >= (roll2?.value ?? 0) ? roll1 : roll2)
    : roll1;
  if (domainAdv && roll2) addLog(`  🌐 Domain Advantage: rolled ${roll1.value} & ${roll2.value}, kept ${atkRoll.value}`, 'spell');

  const defRoll = rollD20();

  let defBonus = 0;
  for (const p of defender.sourceChar.passif ?? []) {
    if (!p.applyOn?.includes('defRoll') || !p.dices) continue;
    let applies = !p.condition;
    if (p.condition?.allyKO)          applies = S.combatants.some(c => c.teamIndex === defender.teamIndex && c.isKO);
    else if (p.condition?.selfBelow50pct) applies = defender.currentHp <= defender.maxHp * 0.5;
    if (applies) defBonus += parseDice(p.dices).total;
  }
  const effectiveDefRoll = defRoll.value + defBonus;

  const domainForcesHit = domainSureHit && !atkRoll.isNat1;
  if (domainForcesHit) addLog(`  🌐 Domain Sure-Hit — attack cannot be dodged!`, 'spell');

  const hit    = atkRoll.isNat20 || domainForcesHit || (!atkRoll.isNat1 && atkRoll.value >= effectiveDefRoll);
  const crit   = atkRoll.isNat20;
  const fumble = atkRoll.isNat1;

  let damage = 0, breakdown = '—';

  if (hit && !fumble) {
    const raw = diceExpr || (attacker.transformedBaseAtk?.dices ?? attacker.sourceChar.baseAtk?.dices) || '1d4';
    const rolled = parseDice(raw);

    let passiveBonus = 0;
    const passiveParts = [];
    for (const p of attacker.sourceChar.passif ?? []) {
      if (!p.applyOn?.includes('atkRoll') || !p.dices) continue;
      let applies = !p.condition;
      if (p.condition?.targetMoreHp)      applies = defender.currentHp > attacker.currentHp;
      else if (p.condition?.allyKO)       applies = S.combatants.some(c => c.teamIndex === attacker.teamIndex && c.isKO);
      else if (p.condition?.selfBelow50pct) applies = attacker.currentHp <= attacker.maxHp * 0.5;
      if (applies) {
        const pr = parseDice(p.dices);
        passiveBonus += pr.total;
        passiveParts.push(`${p.nom}[${pr.breakdown}]`);
      }
    }

    const frStatus = attacker.statusEffects.find(e => e.name === 'final_reckoning');
    if (frStatus?.dice) {
      const fr = parseDice(frStatus.dice);
      passiveBonus += fr.total;
      passiveParts.push(`FinalReckoning[${fr.breakdown}]`);
    }

    const precastSt = attacker.statusEffects.find(e => e.name === 'runik_precast');
    if (precastSt?.dice) {
      const pr = parseDice(precastSt.dice);
      passiveBonus += pr.total;
      passiveParts.push(`RuniquePrecast[${pr.breakdown}]`);
      attacker.statusEffects = attacker.statusEffects.filter(e => e !== precastSt);
    }

    if (attacker.shadowCounterBonus > 0) {
      passiveBonus += attacker.shadowCounterBonus;
      passiveParts.push(`ShadowCounter[+${attacker.shadowCounterBonus}]`);
      attacker.shadowCounterBonus = 0;
    }

    const baseTotal = rolled.total + passiveBonus;
    damage    = crit ? baseTotal * 2 : baseTotal;
    const passiveStr = passiveParts.length ? ` + ${passiveParts.join(' ')}` : '';
    breakdown = crit
      ? `CRIT ×2: ${rolled.breakdown}${passiveStr} = ${damage}`
      : `${rolled.breakdown}${passiveStr} = ${damage}`;
  }

  return { hit, crit, fumble, damage, atkRoll: atkRoll.value, defRoll: defRoll.value, effectiveDefRoll, breakdown, domainSureHit: domainForcesHit };
}

export function logAttackResult(atk, def, r) {
  const defStr = r.effectiveDefRoll !== r.defRoll
    ? `${r.defRoll}+${r.effectiveDefRoll - r.defRoll}=${r.effectiveDefRoll}`
    : String(r.defRoll);
  if (r.crit) {
    addLog(`⚔ CRITICAL! ${atk.name} rolls 20 vs ${def.name}'s ${defStr}. ${r.breakdown}`, 'crit');
  } else if (r.fumble) {
    addLog(`💥 FUMBLE! ${atk.name} rolls 1 — ${def.name} gets a free counter-attack!`, 'miss');
  } else if (r.hit) {
    addLog(`${atk.name} hits ${def.name}! (${r.atkRoll} ≥ ${defStr}) ${r.breakdown}`, 'hit');
  } else {
    addLog(`${atk.name} misses ${def.name}. (${r.atkRoll} < ${defStr})`, 'miss');
  }
}

export function checkVictory() {
  if (livingCombatants(0).length === 0) return 0;
  if (livingCombatants(1).length === 0) return 1;
  return null;
}

export function getReacts(target) {
  const insideClosedDomain = S.activeDomains.some(d => {
    const owner = getCombatant(d.casterId);
    if (!owner || owner.isKO || owner.teamIndex === target.teamIndex) return false;
    if (d.domain.type === 'Ouvert') return false;
    const domainRadius = d.domain.radius ?? 8;
    return chebyshev(target, { x: d.centerX, y: d.centerY }) <= domainRadius;
  });
  return target.abilities.filter(ab => {
    if (!ab.isReact && !ab.isInstant && !ab.isBlock) return false;
    if (ab.isTransform) return false;
    if (insideClosedDomain && ab.tags?.includes('teleportation')) return false;
    return abilityAvailable(target, ab);
  });
}

export function spendResource(c, ab) {
  if (!ab.cost) return;
  if (ab.cost.type === 'ki')    c.ki         = Math.max(0, c.ki    - ab.cost.amount);
  if (ab.cost.type === 'slots') c.spellSlots = Math.max(0, c.spellSlots - ab.cost.amount);
  if (ab.cost.type === 'souls') c.souls      = Math.max(0, c.souls - ab.cost.amount);
}

// ── §10  Action Handlers ───────────────────────────────────────────────────

export function handlePass() {
  addLog(`${activeCombatant().name} passes.`, 'info');
  advanceTurn();
}

export function handleAttack(attackerId, defenderId) {
  const atk = getCombatant(attackerId);
  const def = getCombatant(defenderId);
  if (!atk || !def || def.isKO) return;
  if (S.hasActed) { addLog('You have already acted this turn!', 'info'); return; }

  if (S.currentMap) {
    const range = targetInRange(atk, def, null);
    if (!range.inRange) {
      addLog(`⚠ ${atk.name} can't reach ${def.name}! (${range.reason})`, 'info');
      return;
    }
  }

  const preShield = def.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
  if (preShield) {
    S.hasActed = true;
    addLog(`🛡 ${def.name}'s pre-armed shield blocks ${atk.name}'s attack!`, 'spell');
    def.statusEffects = def.statusEffects.filter(e => e !== preShield);
    updateCombatantCardDOM(def);
    _R.renderCombatScreen();
    return;
  }

  S.hasActed = true;
  const result = resolveAttack(atk, def, null);
  S.pendingAction = { type: 'attack', attackerId, defenderId, result };

  const reacts = getReacts(def);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: def.id, ability: ab }));
    _R.renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

export function handleCastAbility(casterId, abilityName, targetIds) {
  const caster  = getCombatant(casterId);
  const ability = caster?.abilities.find(a => a.name === abilityName);
  if (!ability || !abilityAvailable(caster, ability)) return;
  if (S.hasActed && !ability.isInstant) { addLog('You have already acted this turn!', 'info'); return; }

  const targets = targetIds.map(id => getCombatant(id)).filter(t => t && (ability.isRevive || !t.isKO));

  const needsRangeCheck = !ability.isAoe && !ability.isCone && ability.targetKind === 'enemy';
  if (S.currentMap && needsRangeCheck && targets.length > 0) {
    const range = targetInRange(caster, targets[0], ability);
    if (!range.inRange) {
      addLog(`⚠ ${ability.name} can't reach ${targets[0].name}! (${range.reason})`, 'info');
      return;
    }
  }
  if (!ability.isAoe && !ability.isCone && ability.targetKind !== 'self' && ability.targetKind !== 'ally' && !ability.isSplash && targets.length === 0) {
    addLog(`No valid target selected.`, 'info');
    return;
  }

  spendResource(caster, ability);
  if (ability.cooldownTurns > 0) caster.cooldowns[ability.name] = ability.cooldownTurns;
  if (ability.isOncePerFight) caster.usedThisFight.push(ability.name);
  if (ability.maxCharges > 0) {
    if (caster.remainingCharges[ability.name] == null) caster.remainingCharges[ability.name] = ability.maxCharges;
    caster.remainingCharges[ability.name]--;
  }

  if (!ability.isInstant) S.hasActed = true;

  addLog(`${caster.name} uses ${ability.name}!`, ability.source === 'spell' ? 'spell' : 'tech');

  if (ability.isAoe) {
    S.pendingAction = { type: 'aoe', casterId, abilityName, targetIds, ability, reactorId: null, reactedIds: [], blockedIds: [] };
    const firstReactor = ability.tags?.includes('unblockabled') ? null : targets.find(t => getReacts(t).length > 0);
    if (firstReactor) {
      S.pendingAction.reactorId = firstReactor.id;
      S.pendingAction.reactedIds.push(firstReactor.id);
      S.awaitingReact = true;
      S.reactOptions  = getReacts(firstReactor).map(ab => ({ combatantId: firstReactor.id, ability: ab }));
      _R.renderReactOverlay();
      return;
    }
    resumePendingAction(null);
    return;
  }

  if (ability.isCone) {
    S.pendingAction = { type: 'cone', casterId, abilityName, targetIds, ability, reactorId: null, reactedIds: [], blockedIds: [] };
    const firstReactor = ability.tags?.includes('unblockabled') ? null : targets.find(t => getReacts(t).length > 0);
    if (firstReactor) {
      S.pendingAction.reactorId = firstReactor.id;
      S.pendingAction.reactedIds.push(firstReactor.id);
      S.awaitingReact = true;
      S.reactOptions  = getReacts(firstReactor).map(ab => ({ combatantId: firstReactor.id, ability: ab }));
      _R.renderReactOverlay();
      return;
    }
    resumePendingAction(null);
    return;
  }

  if (ability.isSplash) {
    const target = targets[0];
    if (!target) { addLog(`No valid target selected.`, 'info'); return; }
    const result = ability.dice
      ? resolveAttack(caster, target, ability.dice, ability)
      : { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', effectiveDefRoll: '—', breakdown: '—' };
    S.pendingAction = { type: 'splash', casterId, abilityName, targetIds: [target.id], result, ability };
    const reacts = getReacts(target);
    if (reacts.length > 0) {
      S.awaitingReact = true;
      S.reactOptions  = reacts.map(ab => ({ combatantId: target.id, ability: ab }));
      _R.renderReactOverlay();
      return;
    }
    resumePendingAction(null);
    return;
  }

  if (ability.maxBounce > 0) {
    S.pendingAction = { type: 'bounce', casterId, abilityName, targetIds, ability };
    resumePendingAction(null);
    return;
  }

  if (ability.targetKind === 'self') {
    if (ability.tags?.includes('teleportation') && S.currentMap) {
      enterTeleportMode(caster, ability.range ?? SPELL_RANGE);
      return;
    }
    S.pendingAction = { type: 'ability', casterId, abilityName, targetIds: [casterId], result: { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', effectiveDefRoll: '—', breakdown: '—' }, ability };
    resumePendingAction(null);
    return;
  }

  const isPureHeal = ability.targetKind === 'ally';
  if (isPureHeal) {
    const target = targets[0];
    if (!target) { addLog(`No valid target selected.`, 'info'); return; }
    S.pendingAction = { type: 'ability', casterId, abilityName, targetIds: [target.id], result: { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', effectiveDefRoll: '—', breakdown: '—' }, ability };
    resumePendingAction(null);
    return;
  }

  const target = targets[0];
  if (!target) { addLog(`No valid target selected.`, 'info'); return; }

  const preShieldSpell = target.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
  if (preShieldSpell) {
    addLog(`🛡 ${target.name}'s pre-armed shield blocks ${caster.name}'s ${ability.name}!`, 'spell');
    target.statusEffects = target.statusEffects.filter(e => e !== preShieldSpell);
    updateCombatantCardDOM(target);
    _R.renderCombatScreen();
    return;
  }

  const result = ability.dice
    ? resolveAttack(caster, target, ability.dice, ability)
    : { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', effectiveDefRoll: '—', breakdown: '—' };

  S.pendingAction = { type: 'ability', casterId, abilityName, targetIds: [target.id], result, ability };

  const reacts = getReacts(target);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: target.id, ability: ab }));
    _R.renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

export function handleTransform(casterId) {
  const c  = getCombatant(casterId);
  const tf = c?.sourceChar.transformation;
  if (!c || !tf || c.isTransformed) return;
  if (S.hasActed) { addLog('You have already acted this turn!', 'info'); return; }

  if (c.usedThisFight.includes(tf.base.nom)) {
    addLog(`${c.name} has already transformed this fight!`, 'info'); return;
  }

  c.isTransformed = true;
  c.usedThisFight.push(tf.base.nom);
  S.hasActed = true;

  if (tf.hp > 0) {
    c.maxHp     += tf.hp;
    c.currentHp  = Math.min(c.maxHp, c.currentHp + tf.hp);
  }
  if (tf.spellSlot > 0) {
    c.spellSlots    += tf.spellSlot;
    c.maxSpellSlots += tf.spellSlot;
  }
  if (tf.speed) c.speed = tf.speed;
  if (tf.baseAtk) c.transformedBaseAtk = tf.baseAtk;

  const tfAbilities = resolveAbilitiesFromList(tf.moveSet);
  const tfNames     = new Set(tfAbilities.map(a => a.name));
  const baseAbilities = c.abilities.filter(a => !a.isTransform && !tfNames.has(a.name));
  c.abilities = [...baseAbilities, ...tfAbilities];

  addLog(`✨ ${c.name} transforms into ${tf.base.nom}!`, 'crit');
  if (tf.hp > 0) addLog(`  +${tf.hp} max HP. Now ${c.currentHp}/${c.maxHp}.`, 'crit');
  updateCombatantCardDOM(c);
  _R.renderCombatScreen();
}

export function suppressDomain(ownerCombatant) {
  ownerCombatant.domainActive = false;
  S.activeDomains = S.activeDomains.filter(d => d.casterId !== ownerCombatant.id);
  for (const c2 of S.combatants.filter(c3 => c3.teamIndex === ownerCombatant.teamIndex)) {
    c2.statusEffects = c2.statusEffects.filter(e => !e.fromDomain);
  }
  updateCombatantCardDOM(ownerCombatant);
}

export function handleActivateDomain(casterId) {
  const c      = getCombatant(casterId);
  const domain = c?.sourceChar.domain;
  if (!c || !domain) return;
  if (S.hasActed) { addLog('You have already acted this turn!', 'info'); return; }
  if (c.domainActive)   { addLog(`${c.name}'s domain is already active!`, 'info'); return; }
  if (c.domainCharges <= 0) { addLog(`⚠ ${c.name} has no more domain charges!`, 'info'); return; }
  if (c.spellSlots < domain.spellCost) {
    addLog(`⚠ ${c.name} needs ${domain.spellCost} spell slots for ${domain.name}!`, 'info'); return;
  }

  if (domain.type !== 'Ouvert') {
    const enemyEntry = S.activeDomains.find(d => {
      const owner = getCombatant(d.casterId);
      return owner && owner.teamIndex !== c.teamIndex && d.domain.type !== 'Ouvert';
    });
    if (enemyEntry) {
      const enemyOwner = getCombatant(enemyEntry.casterId);
      const selfRef    = domain.rafinement ?? 0;
      const enemyRef   = enemyEntry.domain.rafinement ?? 0;
      if (selfRef > enemyRef) {
        suppressDomain(enemyOwner);
        addLog(`🌐 Domain Clash! ${c.name}'s ${domain.name} overpowers ${enemyOwner.name}'s domain — suppressed!`, 'crit');
      } else if (selfRef === enemyRef) {
        suppressDomain(enemyOwner);
        addLog(`🌐 Domain Clash! Equal refinement — both domains cancel out!`, 'crit');
        // Attacker still pays the cost and loses their action — their domain also cancels
        c.spellSlots -= domain.spellCost;
        c.domainCharges--;
        S.hasActed = true;
        updateCombatantCardDOM(c);
        _R.renderCombatScreen();
        return;
      } else {
        addLog(`🌐 ${c.name}'s ${domain.name} is suppressed by ${enemyOwner.name}'s stronger domain!`, 'crit');
        return;
      }
    }
  }

  c.spellSlots  -= domain.spellCost;
  c.domainCharges--;
  c.domainActive = true;
  S.activeDomains.push({ casterId: c.id, domain, centerX: c.x, centerY: c.y });
  S.hasActed = true;

  addLog(`🌐 ${c.name} activates Domain Expansion: ${domain.name}! [${domain.type} · Ref. ${domain.rafinement ?? 'N/A'}]`, 'crit');
  addLog(`  "${domain.description}"`, 'spell');

  for (const eff of domain.effects ?? []) {
    addLog(`  • ${eff.nom}${eff.dices ? ` (${eff.dices})` : ''}`, 'spell');

    if (eff.applyOn?.includes('hpPerTurn') && eff.target !== 'foes' && eff.dices) {
      const pool = eff.target === 'allies' ? livingCombatants(c.teamIndex) : [c];
      for (const t of pool) {
        applyStatus(t, 'regen', 999);
        const re = t.statusEffects.find(e => e.name.toLowerCase() === 'regen');
        if (re) { re.dice = eff.dices; re.fromDomain = true; }
      }
    }

    if (eff.applyOn?.includes('autority') && eff.target === 'foes' && eff.dices) {
      const delta = parseDice(eff.dices).total;
      for (const foe of livingCombatants(c.teamIndex === 0 ? 1 : 0)) {
        foe.authorityDebuff = (foe.authorityDebuff ?? 0) - delta;
        addLog(`  ⬇ ${foe.name} Authority debuffed by ${Math.abs(delta)}.`, 'status');
      }
    }
  }

  addLog(`  Charges remaining: ${c.domainCharges}`, 'info');
  updateCombatantCardDOM(c);
  _R.renderCombatScreen();
}

export function handleReactYes() {
  const selectedName = document.querySelector('.react-ability-option.is-selected')?.dataset.abilityName
    ?? S.reactOptions[0]?.ability.name;
  const option       = S.reactOptions.find(o => o.ability.name === selectedName) ?? S.reactOptions[0];
  const reactAbility = option?.ability ?? null;
  document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];

  if (reactAbility?.tags?.includes('teleportation') && S.currentMap) {
    const reactor = getCombatant(option.combatantId);
    if (reactor) {
      spendResource(reactor, reactAbility);
      S.pendingTeleportReact = reactAbility;
      enterTeleportMode(reactor, reactAbility.range ?? SPELL_RANGE);
      return;
    }
  }
  resumePendingAction(reactAbility);
}

export function handleReactNo() {
  document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];
  resumePendingAction(null);
}

export function resumePendingAction(reactAbility) {
  const action = S.pendingAction;
  S.pendingAction = null;
  if (!action) { advanceTurn(); return; }

  let blocked = false;

  // ── React resolution ──────────────────────────────────────────────────
  if (reactAbility) {
    const reactorId = action.defenderId ?? action.reactorId ?? action.targetIds?.[0];
    const reactor   = getCombatant(reactorId);
    if (reactor) {
      spendResource(reactor, reactAbility);
      if (reactAbility.cooldownTurns > 0) reactor.cooldowns[reactAbility.name] = reactAbility.cooldownTurns;
      if (reactAbility.isOncePerFight) reactor.usedThisFight.push(reactAbility.name);
      if (reactAbility.maxCharges > 0) {
        if (reactor.remainingCharges[reactAbility.name] == null) reactor.remainingCharges[reactAbility.name] = reactAbility.maxCharges;
        reactor.remainingCharges[reactAbility.name]--;
      }

      if (reactAbility.tags?.includes('reflect')) {
        const attackerId = action.attackerId ?? action.casterId;
        const attacker   = getCombatant(attackerId);
        if (attacker && action.result?.damage > 0) {
          const reflectDmg = action.result.damage * 2;
          addLog(`🪞 ${reactor.name} reflects the attack! ${attacker.name} takes ${reflectDmg}!`, 'crit');
          applyDamage(attacker, reflectDmg, damTypeFromTags(reactAbility.tags), reactAbility.tags);
        } else {
          addLog(`🪞 ${reactor.name} reflects the attack!`, 'crit');
        }
        blocked = true;
      } else if (reactAbility.tags?.includes('half_phys')) {
        reactor.statusEffects.push({ name: 'living_blade_armor', turnsLeft: 1, dice: null, damType: null, notes: '' });
        addLog(`⚔ ${reactor.name} raises Living Blade Armor — halves next physical hit!`, 'spell');
        updateCombatantCardDOM(reactor);
      } else if (reactAbility.tags?.includes('teleportation')) {
        addLog(`✦ ${reactor.name} blinks away — attack misses!`, 'spell');
        blocked = true;
      } else if (reactAbility.isBlock) {
        if (reactAbility.tags?.includes('chains')) {
          let chainsEff = reactor.statusEffects.find(e => e.name === 'chains_of_apophis');
          if (!chainsEff) {
            chainsEff = { name: 'chains_of_apophis', turnsLeft: 999, shieldHp: 8, dice: null, damType: null, notes: '' };
            reactor.statusEffects.push(chainsEff);
          } else {
            chainsEff.shieldHp = 8;
          }
          addLog(`⛓ ${reactor.name}'s Chains of Apophis intercept the attack! (${chainsEff.shieldHp} HP)`, 'spell');
          updateCombatantCardDOM(reactor);
        } else if (reactAbility.dice && !reactAbility.tags?.includes('regen') && !reactAbility.tags?.includes('heal')) {
          const shieldHp = Math.max(0, parseDice(reactAbility.dice).total);
          reactor.statusEffects.push({ name: 'damage_shield', turnsLeft: 999, shieldHp, dice: null, damType: null, notes: '', source: reactAbility.source });
          addLog(`🛡 ${reactor.name} raises ${reactAbility.name} — ${shieldHp} HP absorb shield!`, 'spell');
          updateCombatantCardDOM(reactor);
        } else {
          addLog(`🛡 ${reactor.name} blocks with ${reactAbility.name}!`, 'spell');
          if (reactAbility.tags?.includes('cleans')) applyCleanse(reactor);
          if (reactAbility.dice) {
            if (reactAbility.tags?.includes('regen')) {
              applyStatus(reactor, 'regen');
              const re = reactor.statusEffects.find(e => e.name.toLowerCase() === 'regen');
              if (re) re.dice = reactAbility.dice;
              addLog(`  💚 ${reactor.name} regenerates ${reactAbility.dice}/turn!`, 'heal');
            } else if (reactAbility.tags?.includes('heal')) {
              applyHeal(reactor, reactAbility.dice);
            }
          }
          blocked = true;
          if (action.type === 'aoe' || action.type === 'cone') {
            if (reactAbility.isAoe) {
              livingCombatants(reactor.teamIndex).forEach(a => {
                if (!action.blockedIds.includes(a.id)) action.blockedIds.push(a.id);
              });
              addLog(`  ✦ Eternal Bloom shields the whole team!`, 'spell');
            } else {
              if (!action.blockedIds.includes(reactor.id)) action.blockedIds.push(reactor.id);
              addLog(`  (${reactor.name} only — others still take damage)`, 'info');
            }
          }
        }
      } else {
        addLog(`⚡ ${reactor.name} reacts: ${reactAbility.name}! ${reactAbility.desc}`, 'spell');
        if (reactAbility.dice) {
          const attackerId = action.attackerId ?? action.casterId;
          const attacker   = getCombatant(attackerId);
          if (attacker) {
            const r = parseDice(reactAbility.dice);
            addLog(`${reactor.name}'s react deals ${r.total} to ${attacker.name}! (${r.breakdown})`, 'hit');
            applyDamage(attacker, r.total, damTypeFromTags(reactAbility.tags), reactAbility.tags);
          }
        }
        blocked = true;
      }
    }
  }

  // ── AoE/cone: find next un-reacted target, or proceed to damage ──────
  if ((action.type === 'aoe' || action.type === 'cone') && reactAbility) {
    const allT = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
    const next  = allT.find(t => !action.reactedIds.includes(t.id) && getReacts(t).length > 0);
    if (next) {
      action.reactorId = next.id;
      action.reactedIds.push(next.id);
      S.pendingAction = action;
      S.awaitingReact = true;
      S.reactOptions  = getReacts(next).map(ab => ({ combatantId: next.id, ability: ab }));
      _R.renderReactOverlay();
      return;
    }
    blocked = false;
  }

  // ── Apply original action ─────────────────────────────────────────────
  if (!blocked) {
    if (action.type === 'attack') {
      const atk = getCombatant(action.attackerId);
      const def = getCombatant(action.defenderId);
      if (atk && def) {
        logAttackResult(atk, def, action.result);
        if (action.result.hit && !action.result.fumble) {
          const atkTags = atk.transformedBaseAtk?.tags ?? atk.sourceChar.baseAtk?.tags ?? [];
          const damType = damTypeFromTags(atkTags);
          const ignoreDR = getDomainEffects(atk, { applyOn: 'atkRoll' }).some(e => e.tags?.includes('unblockabled'));
          addLog(`${def.name}: ${def.currentHp + action.result.damage} → ${Math.max(0, def.currentHp)}`, 'hit');
          applyDamage(def, action.result.damage, damType, atkTags, ignoreDR);
          applyHpPerHitPassives(atk);
          if (atkTags.includes('grounded')) removeFlying(def);
        } else if (!action.result.hit && !action.result.fumble) {
          const shadowEffs = getDomainEffects(def, { applyOn: 'atkRoll', foeJustMissed: true });
          if (shadowEffs.length > 0 && shadowEffs[0].dices) {
            const bonus = parseDice(shadowEffs[0].dices).total;
            def.shadowCounterBonus += bonus;
            addLog(`🌑 ${def.name}'s shadows stir — +${bonus} on next attack! (Shadow Counter)`, 'spell');
          }
        }
        if (action.result.fumble) def.hasCounterAttack = true;
      }

    } else if (action.type === 'aoe') {
      const caster    = getCombatant(action.casterId);
      const ability   = action.ability;
      const allTargets = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
      const isPureHeal = ability.targetKind === 'ally';
      let precastBonus = 0;
      const aoePrecast = caster?.statusEffects.find(e => e.name === 'runik_precast');
      if (aoePrecast?.dice) {
        const pr = parseDice(aoePrecast.dice);
        precastBonus = pr.total;
        caster.statusEffects = caster.statusEffects.filter(e => e !== aoePrecast);
        addLog(`✦ ${caster.name}'s Runik Precast activates! (+${precastBonus})`, 'spell');
      }
      const aoeIgnoreDR = getDomainEffects(caster, { applyOn: 'atkRoll', ability }).some(e => e.tags?.includes('unblockabled'));
      addLog(`${caster.name}'s ${ability.name} strikes all ${isPureHeal ? 'allies' : 'enemies'}!`, 'spell');
      for (const target of allTargets) {
        if ((action.blockedIds ?? []).includes(target.id)) continue;
        const fullBlock = target.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
        if (fullBlock) {
          addLog(`🛡 ${target.name}'s shield blocks the AoE!`, 'spell');
          target.statusEffects = target.statusEffects.filter(e => e !== fullBlock);
          updateCombatantCardDOM(target);
          continue;
        }
        if (ability.tags?.includes('cleans')) applyCleanse(target);
        if (ability.dice) {
          if (isPureHeal) {
            if (ability.tags?.includes('regen')) {
              applyStatus(target, 'regen');
              const re = target.statusEffects.find(e => e.name.toLowerCase() === 'regen');
              if (re) re.dice = ability.dice;
              addLog(`  ${target.name} regenerates ${ability.dice}/turn!`, 'heal');
            } else {
              applyHeal(target, ability.dice);
            }
          } else {
            const rd = parseDice(ability.dice);
            const damType = damTypeFromTags(ability.tags);
            const totalDmg = rd.total + precastBonus;
            addLog(`  ${target.name}: ${target.currentHp} → ${Math.max(0, target.currentHp - totalDmg)} (${totalDmg} dmg, ${rd.breakdown}${precastBonus ? ` +precast${precastBonus}` : ''})`, 'hit');
            applyDamage(target, totalDmg, damType, ability.tags, aoeIgnoreDR);
            if (ability.isHeal) applyHeal(caster, String(totalDmg));
            if (ability.tags?.includes('grounded')) removeFlying(target);
          }
        }
        if (ability.effect) applyStatus(target, ability.effect);
        if (isPureHeal && ability.slotRegen > 0) {
          const gained = Math.min(ability.slotRegen, target.maxSpellSlots - target.spellSlots);
          if (gained > 0) {
            target.spellSlots += gained;
            addLog(`  ✦ ${target.name} recovers ${gained} slot(s)! (${target.spellSlots}/${target.maxSpellSlots})`, 'heal');
            updateCombatantCardDOM(target);
          }
        }
      }

    } else if (action.type === 'bounce') {
      const caster   = getCombatant(action.casterId);
      const ability  = action.ability;
      if (!caster) return;
      const damType  = damTypeFromTags(ability.tags);
      const isAny    = ability.targetKind === 'any';
      const hitTeam  = ability.targetKind === 'ally' ? caster.teamIndex : (caster.teamIndex === 0 ? 1 : 0);
      const pool     = isAny
        ? S.combatants.filter(c => c.id !== caster.id && !c.isKO)
        : S.combatants.filter(c => c.teamIndex === hitTeam && !c.isKO);
      const firstTarget = getCombatant(action.targetIds[0]) ?? pool[0];
      if (!firstTarget) { advanceTurn(); return; }

      addLog(`${caster.name} uses ${ability.name} — bouncing up to ${ability.maxBounce} targets!`, 'tech');
      const visited = new Set([firstTarget.id]);
      let current   = firstTarget;

      for (let i = 0; i < ability.maxBounce; i++) {
        if (!current || current.isKO) break;
        const isAllyTarget = current.teamIndex === caster.teamIndex;
        if (isAny && isAllyTarget) {
          const healed = parseDice(ability.dice);
          addLog(`  💚 ${current.name} healed ${healed.total} HP (${healed.breakdown})!`, 'heal');
          applyHeal(current, ability.dice);
        } else {
          const result = resolveAttack(caster, current, ability.dice, ability);
          logAttackResult(caster, current, result);
          if (result.hit && !result.fumble && ability.dice) {
            const ignoreDR = getDomainEffects(caster, { applyOn: 'atkRoll', ability }).some(e => e.tags?.includes('unblockabled'));
            applyDamage(current, result.damage, damType, ability.tags, ignoreDR);
            if (ability.effect) applyStatus(current, ability.effect);
            if (ability.tags?.includes('grounded')) removeFlying(current);
          }
          if (result.fumble) current.hasCounterAttack = true;
        }

        const next = pool
          .filter(t => !visited.has(t.id) && !t.isKO)
          .sort((a, b) => chebyshev(current, a) - chebyshev(current, b))
          .find(t => !S.currentMap || chebyshev(current, t) <= ability.bounceRange);
        if (!next) break;
        visited.add(next.id);
        addLog(`  ↩ Bounces to ${next.name}!`, 'tech');
        current = next;
      }

    } else if (action.type === 'cone') {
      const caster     = getCombatant(action.casterId);
      const ability    = action.ability;
      const allTargets = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
      addLog(`${caster.name}'s ${ability.name} sweeps in a cone!`, 'spell');
      const damType = damTypeFromTags(ability.tags);
      const coneIgnoreDR = getDomainEffects(caster, { applyOn: 'atkRoll', ability }).some(e => e.tags?.includes('unblockabled'));
      for (const target of allTargets) {
        if ((action.blockedIds ?? []).includes(target.id)) continue;
        if (ability.dice) {
          const rd = parseDice(ability.dice);
          addLog(`  ${target.name}: ${target.currentHp} → ${Math.max(0, target.currentHp - rd.total)} (${rd.total} dmg)`, 'hit');
          applyDamage(target, rd.total, damType, ability.tags, coneIgnoreDR);
          if (ability.tags?.includes('grounded')) removeFlying(target);
        }
        if (ability.effect) applyStatus(target, ability.effect);
      }

    } else if (action.type === 'splash') {
      const caster  = getCombatant(action.casterId);
      const primary = getCombatant(action.targetIds[0]);
      const ability = action.ability;
      if (caster && primary) {
        const damType = damTypeFromTags(ability.tags);
        logAttackResult(caster, primary, action.result);
        if (action.result.fumble) primary.hasCounterAttack = true;
        if (action.result.hit && !action.result.fumble && ability.dice) {
          addLog(`${primary.name}: ${primary.currentHp + action.result.damage} → ${Math.max(0, primary.currentHp)} (${action.result.breakdown})`, 'hit');
          applyDamage(primary, action.result.damage, damType, ability.tags);
          if (ability.radius > 0) {
            const splashTeam  = caster.teamIndex === 0 ? 1 : 0;
            const splashTargets = livingCombatants(splashTeam)
              .filter(t => t.id !== primary.id && chebyshev(primary, t) <= ability.radius);
            if (splashTargets.length > 0) {
              addLog(`  Splash radius ${ability.radius} hits ${splashTargets.map(t => t.name).join(', ')}!`, 'spell');
              for (const t of splashTargets) {
                const rd = parseDice(ability.dice);
                const splashDmg = Math.floor(rd.total / 2);
                addLog(`  ${t.name}: ${t.currentHp} → ${Math.max(0, t.currentHp - splashDmg)} (${splashDmg} splash)`, 'hit');
                applyDamage(t, splashDmg, damType, ability.tags);
                if (ability.effect) applyStatus(t, ability.effect);
              }
            }
          }
        }
        if (ability.effect) applyStatus(primary, ability.effect);
      }

    } else if (action.type === 'ability') {
      const caster  = getCombatant(action.casterId);
      const target  = getCombatant(action.targetIds[0]);
      const ability = action.ability;
      if (caster && target) {
        const isPureHeal = ability.targetKind === 'ally';
        const isSelf     = ability.targetKind === 'self';

        if (isSelf || isPureHeal) {
          if (ability.isBlock) {
            if (ability.dice) {
              const shieldHp = Math.max(0, parseDice(ability.dice).total);
              target.statusEffects.push({ name: 'damage_shield', turnsLeft: 999, shieldHp, dice: null, damType: null, notes: '', source: ability.source });
              addLog(`🛡 ${target.name} gains a ${shieldHp} HP damage shield!`, 'spell');
            } else {
              applyStatus(target, 'water_shield', 1);
              addLog(`🛡 ${target.name} ${isSelf ? 'prepares a shield' : 'is shielded'} — next attack blocked!`, 'spell');
            }
          }
          if (ability.tags?.includes('cleans')) applyCleanse(target);
          if (ability.isRevive && target.isKO) {
            target.isKO = false;
            target.currentHp = Math.floor(target.maxHp * 0.5);
            addLog(`${caster.name} revives ${target.name} with ${target.currentHp}/${target.maxHp} HP!`, 'heal');
            updateCombatantCardDOM(target);
          } else if (ability.dice && !ability.isBlock) {
            if (ability.tags?.includes('regen')) {
              applyStatus(target, 'regen');
              const re = target.statusEffects.find(e => e.name.toLowerCase() === 'regen');
              if (re) re.dice = ability.dice;
              addLog(`${target.name} regenerates ${ability.dice}/turn!`, 'heal');
            } else {
              applyHeal(target, ability.dice);
            }
          }
          if (ability.effect) applyStatus(target, ability.effect);
          if (ability.tags?.includes('fly') && !target.statusEffects.some(e => e.name.toLowerCase() === 'fly')) {
            target.statusEffects.push({ name: 'fly', turnsLeft: 999, dice: null, damType: null, notes: '' });
            addLog(`🦅 ${target.name} is now flying!`, 'spell');
          }
          if (ability.precastDice) {
            target.statusEffects.push({ name: 'runik_precast', turnsLeft: 2, dice: ability.precastDice, damType: null, notes: '' });
            addLog(`✦ ${target.name} prepares a Runik Precast! (+${ability.precastDice} to next cast)`, 'spell');
          }
          updateCombatantCardDOM(target);
        } else {
          logAttackResult(caster, target, action.result);
          if (action.result.hit && !action.result.fumble) {
            const damType = damTypeFromTags(ability.tags);
            if (ability.dice && action.result.damage > 0) {
              const ignoreDR = getDomainEffects(caster, { applyOn: 'atkRoll', ability }).some(e => e.tags?.includes('unblockabled'));
              addLog(`${target.name}: ${target.currentHp + action.result.damage} → ${Math.max(0, target.currentHp)} (${action.result.breakdown})`, 'hit');
              applyDamage(target, action.result.damage, damType, ability.tags, ignoreDR);
              if (ability.isHeal) applyHeal(caster, String(action.result.damage));
              applyHpPerHitPassives(caster);
              if (ability.tags?.includes('grounded')) removeFlying(target);
            }
            if (ability.effect) applyStatus(target, ability.effect);
          } else if (!action.result.hit && !action.result.fumble) {
            const shadowEffs = getDomainEffects(target, { applyOn: 'atkRoll', foeJustMissed: true });
            if (shadowEffs.length > 0 && shadowEffs[0].dices) {
              const bonus = parseDice(shadowEffs[0].dices).total;
              target.shadowCounterBonus += bonus;
              addLog(`🌑 ${target.name}'s shadows stir — +${bonus} on next attack! (Shadow Counter)`, 'spell');
            }
          }
          if (action.result.fumble) target.hasCounterAttack = true;
        }
      }
    }
  }

  // ── Victory check ─────────────────────────────────────────────────────
  const winner = checkVictory();
  if (winner !== null) { endCombat(winner); return; }

  // ── Counter-attack from fumble ─────────────────────────────────────────
  const prevActive = activeCombatant();
  const counter    = S.combatants.find(c => c.hasCounterAttack && !c.isKO);
  if (counter) {
    counter.hasCounterAttack = false;
    addLog(`⚡ ${counter.name} gets a free counter-attack!`, 'crit');
    const counterTarget = prevActive;
    if (counterTarget && !counterTarget.isKO) {
      const cr = resolveAttack(counter, counterTarget, null);
      logAttackResult(counter, counterTarget, cr);
      if (cr.hit && !cr.fumble) {
        const counterAtkTags = counter.transformedBaseAtk?.tags ?? counter.sourceChar.baseAtk?.tags ?? [];
        const damType = damTypeFromTags(counterAtkTags);
        addLog(`${counterTarget.name}: ${counterTarget.currentHp + cr.damage} → ${Math.max(0, counterTarget.currentHp)} (${cr.breakdown})`, 'hit');
        applyDamage(counterTarget, cr.damage, damType, counterAtkTags);
      }
    }
    const winner2 = checkVictory();
    if (winner2 !== null) { endCombat(winner2); return; }
  }

  advanceTurn();
}

// ── §11  Turn Flow ─────────────────────────────────────────────────────────

export function endCombat(winner) {
  S.winnerTeam = winner;
  S.phase = 'victory';
  _R.renderCombatScreen();
  setTimeout(() => _R.renderVictoryScreen(), 1200);
}

export async function startInitiative() {
  S.combatants = [];
  let id = 0;
  for (const teamIdx of [0, 1]) {
    for (const name of S.teamNames[teamIdx]) {
      const char = allChars.find(c => c.nom === name);
      if (char) S.combatants.push(buildCombatant(char, teamIdx, id++));
    }
  }
  for (const c of S.combatants) {
    const speedMod = Math.floor(((c.sourceChar.speed ?? 6) - 6) / 2);
    let initBonus = 0;
    for (const p of c.sourceChar.passif ?? []) {
      if (p.applyOn?.includes('initRoll') && p.dices) initBonus += parseDice(p.dices).total;
    }
    c.initiativeRoll = Math.max(1, rollDie(20) + speedMod + initBonus);
  }
  S.initiativeOrder = [...S.combatants]
    .sort((a, b) => b.initiativeRoll - a.initiativeRoll)
    .map(c => c.id);

  const manifest   = await loadManifest();
  const slug       = manifest[Math.floor(Math.random() * manifest.length)];
  S.currentMap     = await loadMap(slug);
  S.mapViewFilter  = 'both';
  S.hasMoved       = false;
  S.hasActed       = false;
  S.moveMode       = false;
  S.reachableCells = new Map();

  S.activeDomains  = [];
  S.phase = 'initiative';
  _R.render();
}

export function startCombat() {
  S.phase = 'combat';
  S.currentTurnIndex = 0;
  S.roundNumber = 1;
  S.log = [];
  S.hasActed = false;
  if (S.currentMap) placeCharacters(S.currentMap);
  S.hasMoved = false;
  addRoundDivider();
  _R.render();
  beginTurn(activeCombatant());
}

export function advanceTurn() {
  const total = S.initiativeOrder.length;
  let curr = S.currentTurnIndex;
  let loops = 0;
  let passedZero = false;
  do {
    curr = (curr + 1) % total;
    if (curr === 0) passedZero = true;
    loops++;
    if (loops > total) return;
  } while (getCombatant(S.initiativeOrder[curr])?.isKO);

  S.currentTurnIndex = curr;
  S.hasMoved         = false;
  S.hasActed         = false;
  S.moveMode         = false;
  S.reachableCells   = new Map();
  clearAimState();
  exitTeleportMode();
  S.pendingTeleportReact = null;
  if (passedZero) { S.roundNumber++; addRoundDivider(); }

  beginTurn(activeCombatant());
}

export function beginTurn(c) {
  if (!c) return;

  const survived = tickTurn(c);
  if (!survived) {
    const w = checkVictory();
    if (w !== null) { endCombat(w); return; }
  }

  for (const p of c.sourceChar.passif ?? []) {
    if (!p.applyOn?.includes('hpPerTurn') || !p.dices) continue;
    if (p.condition?.selfBelow50pct && c.currentHp > c.maxHp * 0.5) continue;
    if (p.target === 'allies') {
      for (const ally of livingCombatants(c.teamIndex)) applyHeal(ally, p.dices);
    } else {
      applyHeal(c, p.dices);
    }
  }

  for (const entry of S.activeDomains) {
    const domainOwner = getCombatant(entry.casterId);
    if (!domainOwner || domainOwner.isKO) continue;
    if (domainOwner.teamIndex === c.teamIndex) continue;
    for (const eff of entry.domain.effects ?? []) {
      if (!eff.applyOn?.includes('hpPerTurn') || eff.target !== 'foes' || !eff.dices) continue;
      const dmg = parseDice(eff.dices).total;
      const damType = damTypeFromTags(eff.tags ?? []);
      addLog(`🔥 ${c.name} takes ${dmg} ${damType ?? ''} from ${entry.domain.name}! (${eff.nom})`, 'status');
      applyDamage(c, dmg, damType, eff.tags ?? []);
      if (c.isKO) {
        const w = checkVictory();
        if (w !== null) { endCombat(w); return; }
        advanceTurn(); return;
      }
    }
  }

  addLog(`— ${c.name}'s turn —`, 'info');

  const ctrl = hasControlEffect(c);
  if (ctrl) {
    addLog(`${c.name} is ${ctrl.name} and cannot act!`, 'status');
    _R.renderCombatScreen();
    setTimeout(() => advanceTurn(), 1000);
    return;
  }

  _R.renderCombatScreen();
}
