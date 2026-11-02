/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-logic.js — State, game mechanics, action handlers, turn flow
   ═══════════════════════════════════════════════════════════════════════════ */

// ── §1  Imports ────────────────────────────────────────────────────────────
import { EFFECTS } from './main.js';
import { loadManifest, loadMap, cellPxOf, isWalkableG, seesThroughG, indexDoors } from './dungeon-loader.js';
import { loadRandomMapOrManor } from './random-map.js';
import { random } from './rng.js';

// Render functions registered by combat-render.js to break the circular dep.
export const _R = {
  render:              () => {},
  renderCombatScreen:  () => {},
  renderReactOverlay:  () => {},
  renderFreeActionOverlay: () => {},
  renderVictoryScreen: () => {},
  appendLog:           () => {},
};

// Headless mode (simulations): no timers, no DOM, no render hooks
let headless = false;
export function setHeadless(on) { headless = !!on; }
export function isHeadless() { return headless; }
const later = (fn, ms) => { if (headless) fn(); else setTimeout(fn, ms); };
const noop = () => {};
const R = new Proxy(_R, { get: (hooks, name) => (headless ? noop : hooks[name]) });

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
  phase: 'selection',   // 'selection' | 'mapchoice' | 'initiative' | 'combat' | 'victory'
  teamNames: [[], []],  // up to 5 character names per team
  combatants: [],
  initiativeOrder: [],
  currentTurnIndex: 0,
  roundNumber: 1,
  pendingAction: null,
  awaitingReact: false,
  reactOptions: [],
  awaitingFree: null,     // { actorId, targetId, instant } while a person chooses a free action
  promptFreeAction: false, // headless only: ask for the choice instead of letting the policy decide
  activeDomains: [],  // { casterId, domain } for currently active domains
  log: [],
  winnerTeam: null,
  aiTeam: null,         // team the bot plays (0 | 1), or null for two human players
  turnSerial: 0,        // bumped on every turn change; stale timers compare against it
  hasActed:    false,   // active combatant has no action left this turn
  actionsDone: [],      // labels of the actions spent this turn ('attack', an ability's name, 'transform', 'domain', 'door')
  bonusActions: 0,      // extra actions earned this turn (Borrowed Time)
  // ── Map system ──────────────────────────────────────────────────────────
  currentMap:     null,
  mapChoice:      null,   // manifest slug or 'random', picked on the map-choice screen
  mapLoading:     false,  // true while confirmMap resolves the map
  mapViewFilter:  'both',
  hasMoved:       false,
  moveMode:       false,
  reachableCells: new Map(),
  iceCells:       new Set(),   // water cells frozen by Convert (Freeze): plain floor, "x,y" keys
  driedCells:     new Set(),   // water cells evaporated by Convert (Evaporate)
  fields:         [],          // lingering areas (Field of Corruption, Field of Flower): { name, kind ('foes'|'allies'), ability, casterId, teamIndex, x, y, radius, roundsLeft, effect, exposed }
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
  teleportGroup:        null,   // the ability when a teleport also carries the caster's allies
  lastTeleportedIds:    null,   // allies that just followed the caster, read by the react that triggered it
};

// ── Map constants ──────────────────────────────────────────────────────────
export const MAX_MOVE    = 6;    // fallback cells per turn when speed is missing
export const MELEE_RANGE = 1;
export const SPELL_RANGE = 6;

// ── §3  Data Helpers ───────────────────────────────────────────────────────

export function rollDie(sides) {
  return Math.floor(random() * sides) + 1;
}

export function rollD20() {
  const v = rollDie(20);
  return { value: v, isNat20: v === 20, isNat1: v === 1 };
}

export function parseDice(expr, ctx = {}) {
  if (!expr || expr === '—' || expr === '-') return { total: 0, breakdown: '—' };
  let s = String(expr);
  // "NdM*(expr)": multiply a roll by a parenthesised sub-expression
  const mulM = s.match(/^\s*(.+?)\s*\*\s*\(([^)]+)\)\s*$/);
  if (mulM) {
    const left = parseDice(mulM[1], ctx), right = parseDice(mulM[2], ctx);
    return { total: left.total * right.total, breakdown: `(${left.breakdown}) × (${right.breakdown})` };
  }
  // "+N%missingHp": percentage of the target's missing HP (ctx.missingHp)
  let pctTotal = 0;
  const pctParts = [];
  s = s.replace(/([+-]?)\s*(\d+)\s*%\s*missingHp/gi, (_, sign, pct) => {
    const v = Math.floor(parseInt(pct) / 100 * (ctx.missingHp ?? 0)) * (sign === '-' ? -1 : 1);
    pctTotal += v;
    pctParts.push(`${pct}% missing HP[${v}]`);
    return '';
  });
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
  const diceMult = ctx.diceMult ?? 1;   // a bonus hit rolls more dice, the flat part stays
  while ((m = diceRe.exec(s)) !== null) {
    const count = parseInt(m[1]) * diceMult, sides = parseInt(m[2]);
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
  total += pctTotal;
  parts.push(...pctParts);
  return { total, breakdown: parts.join(' ') || '0' };
}

export function findEffect(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  return EFFECTS.find(e => e.name.toLowerCase() === n) ?? null;
}

const TAG_TO_STATUS = { freeze: 'gel' };
const STATUS_EFFECT_TAGS = ['para','gel','freeze','burn','calcinated','bleed','hemoragie','stun','root','fear','silence','blind','poison','toxic','decay','wet'];

// Damage over time. Each has a basic and an upgraded form, an immunity to the basic covers the upgrade, and every
// application is a copy of its own, with its own damage and its own timer.
//   life: how many of the owner's turns it lasts; `moving` ones hurt when the owner walks, the rest at each turn start
export const DOTS = {
  burn:       { base: 'burn',   life: 3 },
  calcinated: { base: 'burn',   life: 5 },
  poison:     { base: 'poison', life: 3 },
  toxic:      { base: 'poison', life: 5 },
  bleed:      { base: 'bleed',  life: 3, moving: 'once' },
  hemoragie:  { base: 'bleed',  life: 5, moving: 'cell' },
  decay:      { base: 'decay',  life: 5, grows: true },   // one more die each turn it lasts: Chronos' slow death
};
const TICKING_DOTS = Object.keys(DOTS).filter(n => !DOTS[n].moving);
// Statuses that last longer than the default (turnsLeft counts the owner's turns plus one)
const STATUS_TURNS = { wet: 3, para: 4 };   // para: three of its owner's turns
// A status and the tag it is applied from are interchangeable for immunity checks
const STATUS_ALIASES = { gel: 'freeze', freeze: 'gel' };
// Self/ally buffs are never blocked by a "status" immunity
const BENEFICIAL_STATUSES = ['regen', 'regeneration', 'domain regen', 'water_shield', 'fly', 'invisible'];
// What Dispel Magic strips from its target
const DISPELLABLE = [...BENEFICIAL_STATUSES, 'ward', 'damage_shield', 'advantage', 'sure_hit', 'orders', 'living_blade_armor', 'runik_precast'];
// Physical/elemental damage types. Delivery tags such as "magic" and "runik" are not types.
const DAMAGE_TYPES = ['physical','fire','ice','lightning','earth','water','necro','psy','radiant','wind','holy','dark','poison'];

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
      allSlots:      move.allSlots ?? false,       // spends every spell slot left: n slots roll nd20+10 (Final Brasero)
      primaryBonus:  move.primaryBonus ?? null,    // a cone's extra dice for the main target only (Raging Chopper)
      ifPoisoned:    move.ifPoisoned ?? null,   // dice dealt instead of the status when the target is already poisoned (Spheras' breath, Astrid Nightmare's daggers)
      oncePerTurn:   move.oncePerTurn ?? false,   // usable once each of its owner's turns, whatever else is done (Battle Medic's bonus action)
      steamMode:     move.steamMode ?? false,   // Sienna's Range Mode and Rodent Mode: the techniques her SteamGun reads
      drainSlots:    move.drainSlots ?? null,   // spell slots taken from the target and given to the caster (Vampire Sienna's Bite)
      drainKi:       move.drainKi ?? null,
      groundChance:  move.groundChance ?? 1,   // the odds that a 'grounded' move brings a flier down
      followUp:      move.followUp ?? null,   // dice of a second blow that lands on each target the move hit, at the start of the caster's next turn (GunRang)
      excludeSelf:   move.excludeSelf ?? false,   // an area boon the caster does not share (Arcane Canal)
      splashDice:    move.splashDice ?? null,   // a splash move's damage to the bystanders (otherwise half the main dice)
      bonusVs:       move.bonusVs ?? null,   // { vs: 'wet' | a unit tag, dice }: extra damage against such a target
      precastDice:   move.precastDice ?? null,
      field:         move.field ?? null,     // { turns, affects: 'foes'|'allies', effect, cleanse, heal }: leaves a lingering area that works on the units inside each round
      inflicts:      move.inflicts ?? null,  // { status, turns, chance? }: a timed hindrance on each target the move reaches
      statusTurns:   move.statusTurns ?? null,   // how many of the target's turns the move's own status lasts (stun: turns skipped)
      grants:        move.grants ?? null,   // { status, amount, turns, label }: a timed buff the move puts on its user
      maxCharges:    move.charges ?? 0,
      isReact:    tags.includes('react'),
      isBlock:    tags.includes('block'),
      isInstant:  tags.includes('instant'),
      isVoid:     tags.includes('void'),
      isGate:     tags.includes('gate'),
      // Reactions that do nothing when cast proactively
      reactOnly:  tags.includes('void') || tags.includes('reflect') || tags.includes('onDeath') || (tags.includes('dodge') && tags.includes('react')),
      // Attack-versus-defense roll with no damage dice (the effect applies when the defense fails)
      isContest:  tags.some(t => ['disv_next', 'execute', 'puppet', 'chain_grab'].includes(t)),
      bypassAuthority: move.bypassAuthority ?? 0,
      authority:  move.authority ?? 0,   // a relic's own Authority, when higher than its wielder's
      isAoe:      move.target === 'aoe',
      isCone:     move.target === 'cone',
      isSplash:   move.target === 'splash',
      isHeal:     tags.includes('heal') || tags.includes('regen'),
      isRevive:   tags.includes('revive'),
      isTransform: move.category === 'transformation',
      duration:   move.duration ?? null,
      summon:     move.summon ?? null,   // { unit, count }: calls `count` (dice or number) units of that sheet beside the caster
      isTaboo:    tags.includes('taboo'),   // Annastasia: pays half her current HP to spring the Sacrifice Mark now
      isDetonate: tags.includes('detonate'),   // bursts every living unit the caster owns, on its own spot
    });
  }
  return list;
}

export function resolveAbilities(char) {
  return resolveAbilitiesFromList(char.moveSet);
}

// ── §5  Factory ────────────────────────────────────────────────────────────

/** Times a domain can be expanded in one fight: 1, or the `charges` its sheet gives (Hela and Chronos: 2). No spell slot is paid. */
export const domainChargesOf = domain => Math.max(1, domain?.charges ?? 1);

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
    shadowVoid: [],   // moves swallowed by Black Hole, waiting for Shadow Gate
    statusEffects: char.passif?.some(p => p.tags?.includes('fly'))
      ? [{ name: 'fly', turnsLeft: 999, dice: null, damType: null, notes: '' }]
      : [],
    luckSpent: false,         // Djinn's Luck: the reroll of this turn is gone
    freeActionTarget: null,   // id of the foe this unit may now answer with a free action
    isTransformed:    false,
    transformedBaseAtk: null,
    domainActive:     false,
    domainCharges:    char.domain ? domainChargesOf(char.domain) : 0,
    shadowCounterBonus: 0,
    deathSaves: {},   // lives spent by passives like Nine Lives: passive name -> times used
    attacked: false,   // has made its first attack roll of the fight (Death Presence)
    stacks: {},   // stacking passives (Relentless Warrior): passive name -> stacks gained this fight
    chains: chainsFor(char),   // Vorrakan's Left and Right Chain: [{ name, hp, maxHp, holdingId, freed }] (they are not units)
    lastKind: null,   // what its last action was: 'attack', 'technique', 'spell'... (Sienna's SteamGun reads the one before)
    prevKind: null,
    sacMarkId: null,    // Annastasia's Sacrifice Mark: id of the enemy marked at the start of the battle (its death calls demons)
    huntMarkId: null,   // Sienna's Huntress / Apex Predator: id of the enemy marked at the start of the battle (x2 damage against it, advantage on defense against it)
    ownerId: null,   // a summon or companion: id of the unit that called it (it acts right after, and falls with, that unit)
    x: 0,
    y: 0,
  };
}

// ── Vorrakan's chains ──
// Two chains of 150 HP that are not units and take no turn. Free, they soak damage meant for Vorrakan (split evenly).
// A chain that grabs a foe holds it stunned and rooted, drains it every turn, and no longer guards. The foe's allies
// free it by dealing `free` damage to the chain through the prisoner; a chain at 0 HP lets go for good.

function chainsFor(char) {
  const spec = char.chains;
  if (!spec) return null;
  const names = ['Left Chain', 'Right Chain'];
  return Array.from({ length: spec.count ?? 2 }, (_, i) => ({ name: names[i] ?? `Chain ${i + 1}`, hp: spec.hp, maxHp: spec.hp, holdingId: null, freed: 0 }));
}
const freeChains = v => (v.chains ?? []).filter(ch => ch.hp > 0 && ch.holdingId == null);
function chainHolding(unit) {
  for (const v of S.combatants) {
    const ch = v.chains?.find(x => x.hp > 0 && x.holdingId === unit.id);
    if (ch) return { owner: v, chain: ch };
  }
  return null;
}

function releasePrisoner(owner, ch, why) {
  const prisoner = getCombatant(ch.holdingId);
  ch.holdingId = null;
  ch.freed = 0;
  if (!prisoner) return;
  prisoner.statusEffects = prisoner.statusEffects.filter(e => !(e.chainOf === owner.id && e.chainName === ch.name));
  addLog(`⛓ ${prisoner.name} is free of ${ch.name}${why ? ` (${why})` : ''}.`, 'info');
  updateCombatantCardDOM(prisoner);
}

function breakChain(owner, ch) {
  ch.hp = 0;
  addLog(`⛓💥 ${owner.name}'s ${ch.name} shatters!`, 'crit');
  if (ch.holdingId != null) releasePrisoner(owner, ch, 'the chain is broken');
  updateCombatantCardDOM(owner);
}

function releaseAllChains(owner) {
  for (const ch of owner.chains ?? []) if (ch.holdingId != null) releasePrisoner(owner, ch, `${owner.name} has fallen`);
}

// A hit meant for Vorrakan: the free chains take it, evenly; what a chain cannot hold still reaches him
function chainGuard(v, amount) {
  const guards = freeChains(v);
  if (!guards.length || amount <= 0) return amount;
  let left = amount;
  const per = Math.floor(amount / guards.length), extra = amount - per * guards.length;
  guards.forEach((ch, i) => {
    const take = Math.min(ch.hp, per + (i === 0 ? extra : 0));
    ch.hp -= take;
    left -= take;
    addLog(`⛓ ${v.name}'s ${ch.name} takes ${take}. (${ch.hp}/${ch.maxHp})`, 'spell');
    if (ch.hp <= 0) breakChain(v, ch);
  });
  updateCombatantCardDOM(v);
  return left;
}

// The prisoner's allies hit the chain through it: the blow lands on the chain, and enough of them let go
function chainTakesHit(prisoner, hold, amount) {
  const { owner, chain } = hold;
  const need = owner.sourceChar.chains.free ?? 50;
  chain.hp -= amount;
  chain.freed += amount;
  addLog(`⛓ The blow lands on ${owner.name}'s ${chain.name} instead: ${amount}. (${Math.max(0, chain.hp)}/${chain.maxHp}; ${Math.min(chain.freed, need)}/${need} to free ${prisoner.name})`, 'hit');
  if (chain.hp <= 0) breakChain(owner, chain);
  else if (chain.freed >= need) releasePrisoner(owner, chain, `${need} damage dealt to the chain`);
  updateCombatantCardDOM(owner);
}

// HP and spell slots drained from the prisoner, and given to Vorrakan
function chainDrain(owner, prisoner) {
  const spec = owner.sourceChar.chains;
  const hp = parseDice(spec.drainHp ?? '10+1d10').total;
  const dealt = applyDamage(prisoner, hp, null, ['drain'], true);
  if (dealt > 0) applyHeal(owner, String(dealt), 'Chains of Apophis');
  if (prisoner.isKO) return;
  const slots = Math.min(prisoner.spellSlots, parseDice(spec.drainSlots ?? '1d4').total);
  if (slots > 0) {
    prisoner.spellSlots -= slots;
    addLog(`⛓ ${prisoner.name} loses ${slots} spell slot${slots > 1 ? 's' : ''}. (${prisoner.spellSlots}/${prisoner.maxSpellSlots})`, 'status');
    restoreSlots(owner, slots, 'Chains of Apophis');
  }
  updateCombatantCardDOM(prisoner);
}

// Chains of Apophis landed: a free chain wraps the target (stun and root until freed) and drains it at once
function chainBind(owner, target) {
  const ch = freeChains(owner)[0];
  if (!ch) return;
  // Authority, not the target's immunities, decides: only an Authority gate above the relic's holds (strikeAuthority)
  const gate = authorityGate(target);
  if (gate > 0 && !piercesGate(target) && (target.sourceChar.immunities ?? []).includes('status')) {
    addLog(`🛡 ${target.name}'s Authority-${gate} immunity turns the chain aside!`, 'info');
    return;
  }
  const mark = { chainOf: owner.id, chainName: ch.name };
  for (const name of ['stun', 'root']) {
    target.statusEffects = target.statusEffects.filter(e => e.name !== name);
    target.statusEffects.push({ name, turnsLeft: 999, dice: null, damType: null, notes: '', ...mark });
  }
  ch.holdingId = target.id;
  ch.freed = 0;
  addLog(`⛓ ${owner.name}'s ${ch.name} wraps around ${target.name} — stunned and rooted until ${owner.sourceChar.chains.free ?? 50} damage is dealt to the chain!`, 'crit');
  chainDrain(owner, target);
}

// Start of the prisoner's turn: the chain drains again (a dead master or a broken chain has already let go)
function chainTick(prisoner) {
  const hold = chainHolding(prisoner);
  if (!hold) return;
  if (hold.owner.isKO) { releasePrisoner(hold.owner, hold.chain, `${hold.owner.name} has fallen`); return; }
  chainDrain(hold.owner, prisoner);
}

// ── Summons and companions ──

/** A unit called by another one (Fire Spirit, Golem, Floating Head): it never counts toward victory. */
export const isSummonUnit = c => c.ownerId != null;
const ownedBy = owner => S.combatants.filter(c => c.ownerId === owner.id);

const isPoisoned = c => c.statusEffects.some(e => ['poison', 'toxic'].includes(e.name.toLowerCase()));

// A move that poisons, and hurts instead when the target is already poisoned. Returns true when it hurt (so no status follows).
function poisonCombo(move, target, mult = 1) {
  if (!move?.ifPoisoned || target.isKO || !isPoisoned(target)) return false;
  const r = parseDice(move.ifPoisoned);
  const dmg = Math.floor(r.total * mult);
  addLog(`  ☠ ${target.name} is already poisoned — ${dmg} poison damage instead (${r.breakdown}).`, 'hit');
  applyDamage(target, dmg, 'poison', ['poison']);
  return true;
}

// Dream Hunter: every landed attack adds corruption to the target; at 100 it changes sides and becomes the hunter's summon
const CORRUPTION_LIMIT = 100;
function corruptTarget(hunter, target) {
  const p = (hunter.sourceChar.passif ?? []).find(q => q.tags?.includes('corrupting') && !passiveLost(hunter, q));
  if (!p || target.isKO || target.teamIndex === hunter.teamIndex) return;
  const add = parseDice(p.dices).total;
  let st = target.statusEffects.find(e => e.name === 'corruption');
  if (!st) { st = { name: 'corruption', turnsLeft: 9999, dice: null, damType: null, notes: '', value: 0 }; target.statusEffects.push(st); }
  st.value += add;
  st.notes = `${st.value}/${CORRUPTION_LIMIT}`;
  addLog(`  🕳 ${target.name} is corrupted by ${add}. (${st.value}/${CORRUPTION_LIMIT})`, 'status');
  updateCombatantCardDOM(target);
  if (st.value >= CORRUPTION_LIMIT) turnCorrupted(hunter, target);
}

// The corrupted unit is dead for its own side (its allies feel the loss) and fights on as a summon of the hunter
function turnCorrupted(hunter, target) {
  noteFallen(target);
  if (target.domainActive) suppressDomain(target);
  addLog(`🕳 ${target.name} is consumed by the corruption and joins ${hunter.name}!`, 'crit');
  target.teamIndex = hunter.teamIndex;
  target.ownerId   = hunter.id;
  target.freeActionTarget = null;   // a free action it was owed against the hunter dies with its old allegiance
  target.statusEffects = target.statusEffects.filter(e => e.name === 'corruption');
  const order = S.initiativeOrder;
  const from = order.indexOf(target.id);
  if (from >= 0) order.splice(from, 1);
  let at = order.indexOf(hunter.id) + 1;
  while (at < order.length && getCombatant(order[at])?.ownerId === hunter.id) at++;
  order.splice(at, 0, target.id);
  updateCombatantCardDOM(target);
}

/**
 * Bring a unit of sheet `unitName` into the fight for `owner`. It joins the owner's team, takes a free cell beside
 * the owner (the first ring with room; none left on the map means it is lost) and slots into the initiative order
 * right after the owner and the units the owner already called. Returns the new unit, or null.
 */
export function spawnSummon(owner, unitName, { place = true } = {}) {
  const sheet = allChars.find(c => c.nom === unitName);
  if (!sheet) return null;
  const id = S.combatants.reduce((m, c) => Math.max(m, c.id), -1) + 1;
  const unit = buildCombatant(sheet, owner.teamIndex, id);
  unit.ownerId = owner.id;
  unit.initiativeRoll = owner.initiativeRoll;
  if (place && S.currentMap) {
    const cell = freeCellNear(owner, owner, 4, id);
    if (!cell) { addLog(`  No room beside ${owner.name} for ${unit.name}.`, 'info'); return null; }
    unit.x = cell.x; unit.y = cell.y;
  }
  S.combatants.push(unit);
  const order = S.initiativeOrder;
  let at = order.indexOf(owner.id) + 1;
  while (at < order.length && getCombatant(order[at])?.ownerId === owner.id) at++;
  order.splice(at, 0, id);
  return unit;
}

// The owner has fallen: what it called goes with it
function dismissOwned(owner) {
  for (const u of ownedBy(owner)) {
    if (u.isKO) continue;
    u.currentHp = 0;
    u.isKO = true;
    u.statusEffects = [];
    addLog(`💨 ${u.name} fades with ${owner.name}.`, 'death');
    updateCombatantCardDOM(u);
  }
}

// Irina's Flaming Bird / Leonidas' Golem Creation
function castSummon(caster, ability) {
  const { unit, count } = ability.summon;
  const n = Math.max(1, parseDice(String(count)).total);
  let made = 0;
  for (let i = 0; i < n; i++) if (spawnSummon(caster, unit)) made++;
  addLog(`  ✦ ${made} ${unit}${made === 1 ? '' : 's'} join${made === 1 ? 's' : ''} ${caster.name}'s side — they act right after ${caster.name}.`, 'spell');
}

// Irina's Living Bomb: every Fire Spirit she owns bursts where it stands, and is spent
function castDetonate(caster, ability) {
  const bombs = ownedBy(caster).filter(u => !u.isKO && u.name === 'Fire Spirit');
  const tags = ability.tags ?? [];
  for (const b of bombs) {
    addLog(`💥 ${b.name} bursts at (${b.x}, ${b.y})!`, 'crit');
    for (const foe of enemies(caster)) {
      if (foe.isKO || (S.currentMap && chebyshev(b, foe) > (ability.radius || 1))) continue;
      const r = resolveAttack(caster, foe, ability.dice, ability);
      logAttackResult(caster, foe, r);
      if (r.hit) applyDamage(foe, r.damage, damTypeFromTags(tags), tags);
    }
    b.currentHp = 0;
    b.isKO = true;
    b.statusEffects = [];
    updateCombatantCardDOM(b);
  }
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
// A puppeteered unit is steered by its controller, who may point it at anyone but itself
const isPuppet = c => c.statusEffects.some(e => e.name === 'puppeteered');

export function enemies(c) {
  if (isPuppet(c)) return S.combatants.filter(x => !x.isKO && x.id !== c.id);
  return livingCombatants(c.teamIndex === 0 ? 1 : 0);
}

// The living combatant a taunted unit is forced to target, if any (puppets obey their controller instead)
export function tauntSource(c) {
  if (isPuppet(c)) return null;
  const eff = c.statusEffects.find(e => e.name === 'taunted');
  const src = eff && getCombatant(eff.sourceId);
  return src && !src.isKO ? src : null;
}

// Valid single targets for an enemy-kind move
export function targetPool(c) {
  const pool = enemies(c);
  const src  = tauntSource(c);
  return src && pool.some(x => x.id === src.id) ? [src] : pool;
}

function tauntViolation(actor, targets) {
  const src = tauntSource(actor);
  if (!src || targets.some(t => t.id === src.id)) return false;
  addLog(`⚠ ${actor.name} is taunted and must target ${src.name}!`, 'info');
  return true;
}
export function allies(c) {
  return livingCombatants(c.teamIndex);
}

// Returns domain effects matching the given context for a combatant with an active domain
export function getDomainEffects(combatant, context = {}) {
  if (!combatant.domainActive) return [];
  const domain = combatant.sourceChar.domain;
  if (!domain) return [];
  // The domain only empowers its owner while the owner stands inside its area
  const entry = S.activeDomains.find(d => d.casterId === combatant.id);
  if (entry && chebyshev(combatant, { x: entry.centerX, y: entry.centerY }) > (domain.radius ?? 8)) return [];
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
  if ((ab.tags?.includes('chain_grab') || ab.tags?.includes('chain_guard')) && !freeChains(c).length) return false;   // no free chain, no grab and no guard
  if (ab.isTaboo && !markedByYou(c)) return false;   // no mark to spring
  if (ab.isDetonate && !ownedBy(c).some(u => !u.isKO && u.name === 'Fire Spirit')) return false;   // nothing to burst
  if (ab.tags?.includes('sleeping') && c.statusEffects.some(e => e.name === 'relic_awake')) return false;
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

// Divinity (sheet tag, or the tag of the form that is active): two actions a turn, and they must differ
export const hasDivinity = c => !!c && unitHasTag(c, 'divinity');
// Final Reckoning (Hela) adds a third action to a divinity's two
export // The Great Staff (Kadgar): a second action, as long as every action of the turn is a spell
const isSpellLabel = (c, label) => c.abilities.some(a => a.name === label && (a.source === 'spell' || a.source === 'technoSpell'));
const twoSpells = c => !!c.sourceChar.passif?.some(p => p.tags?.includes('twoSpells') && !passiveLost(c, p));
const spellOnlyNow = c => c === activeCombatant() && twoSpells(c) && !hasDivinity(c) && S.actionsDone.length > 0;
export const actionBudget = c => {
  let n = hasDivinity(c) ? 2 : 1;
  if (twoSpells(c) && S.actionsDone.every(l => isSpellLabel(c, l))) n = Math.max(n, 2);
  return n + (c.statusEffects.some(e => e.name === 'final_reckoning') ? 1 : 0) + S.bonusActions;
};
// True when `label` is closed to `c` right now: a divinity may not repeat an action, and a Great Staff's
// second action must be a spell
export const repeatsAction = (c, label) =>
  (hasDivinity(c) && c === activeCombatant() && S.actionsDone.includes(label)) || (spellOnlyNow(c) && !isSpellLabel(c, label));
function refuseRepeat(c, label, name = label) {
  if (!repeatsAction(c, label)) return false;
  addLog(spellOnlyNow(c)
    ? `⚠ ${c.name}'s Great Staff allows a second spell only — not ${name}.`
    : `⚠ ${c.name} has already used ${name} this turn — a divinity's two actions must differ.`, 'info');
  return true;
}
// An action is spent; the turn has no action left once the budget is used
function spendAction(c, label, category = null) {
  c.prevKind = c.lastKind;
  c.lastKind = category ?? label;
  S.actionsDone.push(label);
  S.hasActed = S.actionsDone.length >= actionBudget(c);
}
// After an action: the turn moves on, unless an action remains (an instant never ends it)
function endAction(instant) {
  if (instant || !S.hasActed) R.renderCombatScreen(); else advanceTurn();
}

export function hasControlEffect(c) {
  const controls = ['gel', 'stun', 'cocoon', 'fear'];  // root removed: only blocks movement, not action. Para only rolls for a stun each turn
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
    if ((x0 !== bx || y0 !== by) && !seesThroughG(S.currentMap, x0, y0)) return false;
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

// Name of the enemy closed domain that would trap `c` if it tried to reach (x, y), or null
export function trappingDomainOwner(c, x, y) {
  for (const ad of S.activeDomains) {
    if (ad.domain.type === 'Ouvert') continue;
    const owner = getCombatant(ad.casterId);
    if (!owner || owner.isKO || owner.teamIndex === c.teamIndex) continue;
    const radius = ad.domain.radius ?? 8;
    const center = { x: ad.centerX, y: ad.centerY };
    if (chebyshev(c, center) <= radius && chebyshev({ x, y }, center) > radius) return owner;
  }
  return null;
}

// Free walkable cell next to `target`, nearest to `from` (used by dash and pull)
export function freeCellAdjacentTo(target, from, excludeId = -1) {
  if (!S.currentMap) return null;
  let best = null, bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const x = target.x + dx, y = target.y + dy;
    if (!isWalkableG(S.currentMap, x, y) || isOccupied(x, y, excludeId)) continue;
    if (!hasLos(x, y, target.x, target.y)) continue;
    const d = chebyshev({ x, y }, from);
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

// Free walkable cell with line of sight to `target`, searched ring by ring up to `maxRing` cells away.
// Within a ring, the cell nearest to `from` wins; `accept` can veto cells (e.g. domain traps).
function freeCellNear(target, from, maxRing, excludeId = -1, accept = () => true) {
  if (!S.currentMap) return null;
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = null, bestD = Infinity;
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = target.x + dx, y = target.y + dy;
      if (!isWalkableG(S.currentMap, x, y) || isOccupied(x, y, excludeId)) continue;
      if (!hasLos(x, y, target.x, target.y) || !accept(x, y)) continue;
      const d = chebyshev({ x, y }, from);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (best) return best;
  }
  return null;
}

// Nearest free walkable cell to `caster`, ring by ring (ties go to the one nearest to `from`), or null
function nearestFreeCell(caster, from, maxRing = 12) {
  if (!S.currentMap) return null;
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = null, bestD = Infinity;
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = caster.x + dx, y = caster.y + dy;
      if (!isWalkableG(S.currentMap, x, y) || isOccupied(x, y)) continue;
      const d = chebyshev({ x, y }, from);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (best) return best;
  }
  return null;
}

// A revived unit stands on the free cell nearest to its reviver and acts right after them
function reviveBeside(caster, target) {
  const cell = nearestFreeCell(caster, target);
  if (cell) { target.x = cell.x; target.y = cell.y; }
  else if (S.currentMap && isOccupied(target.x, target.y)) addLog(`  No free cell near ${caster.name} for ${target.name}.`, 'info');
  const order = S.initiativeOrder, current = order[S.currentTurnIndex];
  order.splice(order.indexOf(target.id), 1);
  order.splice(order.indexOf(caster.id) + 1, 0, target.id);
  S.currentTurnIndex = order.indexOf(current);
}

// A basic attack made outside the attacker's own turn (counter-attack, opportunity attack)
function freeAttack(attacker, target) {
  const r = resolveAttack(attacker, target, null);
  logAttackResult(attacker, target, r);
  if (r.hit) {
    const tags = attacker.transformedBaseAtk?.tags ?? attacker.sourceChar.baseAtk?.tags ?? [];
    applyDamage(target, r.damage, damTypeFromTags(tags), tags);
    strikeBack(attacker, r, damTypeFromTags(tags), tags);
  }
  return r;
}

// A dash that ends beside its target is followed by one free basic attack on it
function opportunityAttack(attacker, target) {
  if (attacker.isKO || target.isKO) return;
  if (S.currentMap && !targetInRange(attacker, target, null).inRange) {
    addLog(`  ${attacker.name} cannot reach ${target.name} for an opportunity attack.`, 'info');
    return;
  }
  addLog(`⚔ ${attacker.name} seizes an opportunity attack on ${target.name}!`, 'crit');
  freeAttack(attacker, target);
}

// Black Turtle's Northern Bastion: it cannot be pulled, knocked back or grounded
const isImmovable = c => !!c.sourceChar.passif?.some(p => p.tags?.includes('immovable'));

const KNOCKBACK_CELLS = 2;
// Pushes `target` straight away from `source`, up to `cells`, stopping before a wall, a unit or a domain wall
function knockBack(source, target, cells = KNOCKBACK_CELLS) {
  if (!S.currentMap || target.isKO) return;
  if (isImmovable(target)) { addLog(`  ⚓ ${target.name} cannot be knocked back.`, 'info'); return; }
  const dx = target.x - source.x, dy = target.y - source.y;
  const step = Math.max(Math.abs(dx), Math.abs(dy));
  if (!step) return;
  const from = { x: target.x, y: target.y };
  let moved = 0;
  for (let i = 1; i <= cells; i++) {
    const x = Math.round(from.x + dx / step * i), y = Math.round(from.y + dy / step * i);
    if (!isWalkableG(S.currentMap, x, y) || isOccupied(x, y, target.id) || trappingDomainOwner(target, x, y)) break;
    target.x = x; target.y = y; moved = i;
  }
  addLog(moved
    ? `  💨 ${target.name} is knocked back ${moved} cell${moved > 1 ? 's' : ''} to (${target.x}, ${target.y}).`
    : `  💨 ${target.name} is thrown against an obstacle and stays put.`, 'info');
}

// Dash: the caster crosses the gap and lands next to the target
function dashToward(c, target) {
  if (!S.currentMap || chebyshev(c, target) <= MELEE_RANGE) return;
  const cell = freeCellAdjacentTo(target, c, c.id);
  if (!cell) { addLog(`  ${c.name} finds no room to close in on ${target.name}.`, 'info'); return; }
  const trap = trappingDomainOwner(c, cell.x, cell.y);
  if (trap) { addLog(`⛔ ${c.name} cannot dash out of ${trap.name}'s domain.`, 'status'); return; }
  addLog(`  ${c.name} dashes to (${cell.x}, ${cell.y}).`, 'info');
  c.x = cell.x; c.y = cell.y;
}

// Pull: drag the target next to the caster
function pullTarget(caster, target) {
  if (!S.currentMap || chebyshev(caster, target) <= MELEE_RANGE) return;
  if (isImmovable(target)) { addLog(`  ⚓ ${target.name} cannot be pulled.`, 'info'); return; }
  const cell = freeCellAdjacentTo(caster, target, target.id);
  if (!cell) return;
  const trap = trappingDomainOwner(target, cell.x, cell.y);
  if (trap) { addLog(`⛔ ${target.name} is held in place by ${trap.name}'s domain.`, 'status'); return; }
  addLog(`  ${target.name} is pulled to (${cell.x}, ${cell.y}).`, 'spell');
  target.x = cell.x; target.y = cell.y;
}

export function placeCharacters(map) {
  for (const teamIdx of [0, 1]) {
    const spots = map.starts[teamIdx];
    const team  = S.combatants.filter(c => c.teamIndex === teamIdx && !isSummonUnit(c));
    const taken = new Set();
    team.forEach((c, i) => {
      let pos = spots[i];
      if (!pos) {
        // More fighters than start cells: use the nearest free walkable cell to the last start
        const anchor = spots[spots.length - 1];
        const near = [...bfsReachable(anchor.x, anchor.y, 4).entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([k]) => { const [x, y] = k.split(',').map(Number); return { x, y }; })
          .find(p => !taken.has(`${p.x},${p.y}`));
        pos = near ?? anchor;
      }
      taken.add(`${pos.x},${pos.y}`);
      c.x = pos.x; c.y = pos.y;
    });
  }
  // Companions start beside the unit they are bound to
  for (const u of S.combatants.filter(isSummonUnit)) {
    const owner = getCombatant(u.ownerId);
    const cell = owner && freeCellNear(owner, owner, 4, u.id);
    if (cell) { u.x = cell.x; u.y = cell.y; }
  }
}

export function targetInRange(actor, target, ability) {
  const dist = chebyshev(actor, target);
  const space = attacksFromAnywhere(actor);
  const seen = () => !S.currentMap || (space && dist <= SPACE_SIGHT) || hasLos(actor.x, actor.y, target.x, target.y);
  if (!ability) {
    if (dist > MELEE_RANGE && !space) return { inRange: false, reason: 'Must be adjacent to attack' };
    if (!seen()) return { inRange: false, reason: 'No line of sight' };
    return { inRange: true, reason: '' };
  }
  if (ability.isAoe) return { inRange: true, reason: '' };
  const maxRange = ability.range ?? SPELL_RANGE;
  if (dist > maxRange && !space) return { inRange: false, reason: `Out of range (max ${maxRange})` };
  if (!seen())
    return { inRange: false, reason: 'No line of sight' };
  return { inRange: true, reason: '' };
}

export function computeAimOverlay(caster, ability) {
  if (!S.currentMap || !ability) return { inRangeCells: new Set(), losCells: new Set(), validTargetIds: new Map() };
  const range = ability.range ?? SPELL_RANGE;
  const space = attacksFromAnywhere(caster) && ability.targetKind !== 'ally';
  const { cols, rows } = S.currentMap.grid;
  const inRangeCells = new Set();
  const losCells     = new Set();
  const isAlly     = ability.targetKind === 'ally';
  const isAny      = ability.targetKind === 'any';
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      // Ally spells may target the caster, so their own cell stays selectable
      if (gx === caster.x && gy === caster.y && !isAlly) continue;
      const cellDist = Math.max(Math.abs(gx - caster.x), Math.abs(gy - caster.y));
      if (cellDist > range && !space) continue;
      if (!isWalkableG(S.currentMap, gx, gy)) continue;
      const key = `${gx},${gy}`;
      inRangeCells.add(key);
      if ((space && cellDist <= SPACE_SIGHT) || hasLos(caster.x, caster.y, gx, gy)) losCells.add(key);
    }
  }
  // Revive targets KO'd allies; every other ally spell targets the living
  const candidates = isAny
    ? S.combatants.filter(c => !c.isKO && c.id !== caster.id)
    : isAlly
      ? (ability.isRevive ? koAllies(caster.teamIndex) : livingCombatants(caster.teamIndex))
      : (ability.isAoe || ability.isCone ? enemies(caster) : targetPool(caster));
  const validTargetIds = new Map();
  for (const t of candidates) {
    if (losCells.has(`${t.x},${t.y}`)) validTargetIds.set(t.id, t);
  }
  return { inRangeCells, losCells, validTargetIds };
}

// Is (gx, gy) inside the 60° cone the caster aims at dirCell? Range and sight count, floor does not
const HALF_CONE = Math.PI / 6; // 30° each side
function inCone(caster, ability, dirCell, gx, gy) {
  if (gx === caster.x && gy === caster.y) return false;
  if (Math.max(Math.abs(gx - caster.x), Math.abs(gy - caster.y)) > (ability.range ?? SPELL_RANGE)) return false;
  if (!hasLos(caster.x, caster.y, gx, gy)) return false;
  const angle = Math.atan2(gy - caster.y, gx - caster.x);
  let diff = Math.abs(angle - Math.atan2(dirCell.y - caster.y, dirCell.x - caster.x));
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff <= HALF_CONE;
}

export function coneCells(caster, ability, dirCell) {
  if (!dirCell || !S.currentMap) return [];
  if (dirCell.x === caster.x && dirCell.y === caster.y) return [];
  const { cols, rows } = S.currentMap.grid;
  const cells = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (isWalkableG(S.currentMap, gx, gy) && inCone(caster, ability, dirCell, gx, gy)) cells.push({ x: gx, y: gy });
    }
  }
  return cells;
}

// ── Closed doors ───────────────────────────────────────────────────────────
// Locked, secret and portcullis doors start shut. A unit beside one can spend its action to open it, or wear it
// down: a basic attack hits it, and so does any damaging area or cone move whose blast reaches it.

export const closedDoors = () => (S.currentMap?.doors ?? []).filter(d => !d.open);
export const doorsInReach = c => closedDoors().filter(d => chebyshev(c, d) <= MELEE_RANGE);
export const doorLabel = d => d.kind === 'portcullis' ? 'portcullis' : `${d.kind} door`;

function swingDoorOpen(door, text) {
  door.open = true;
  door.hp = 0;
  indexDoors(S.currentMap);
  addLog(text, 'spell');
}

// A blow on a closed door: it always lands, and the door gives way when its hit points run out
function wearDoor(door, amount, who) {
  if (door.open || !(amount > 0)) return;
  door.hp = Math.max(0, door.hp - amount);
  if (door.hp > 0) {
    addLog(`  🚪 ${who} batters the ${doorLabel(door)} for ${amount} (${door.hp}/${door.maxHp} left).`, 'hit');
  } else {
    swingDoorOpen(door, `  🚪 ${who} breaks the ${doorLabel(door)} open with ${amount}!`);
  }
}

// The closed doors a damaging area or cone move aimed at `center` reaches
export function doorsInBlast(caster, ability, center) {
  if (!center || !S.currentMap || !ability.dice || ability.isHeal || ability.targetKind === 'ally') return [];
  const radius = ability.radius > 0 ? ability.radius : 1;
  return closedDoors().filter(d => ability.isCone
    ? inCone(caster, ability, center, d.x, d.y)
    : blastReaches(center.x, center.y, d.x, d.y, radius));
}

// Each door in the blast is worn down by one roll of the move's dice
function blastDoors(caster, ability, center) {
  for (const door of doorsInBlast(caster, ability, center)) wearDoor(door, parseDice(ability.dice).total, ability.name);
}

export function handleOpenDoor(actorId, x, y) {
  const actor = getCombatant(actorId);
  const door  = closedDoors().find(d => d.x === x && d.y === y);
  if (!actor || !door || S.hasActed) return;
  if (chebyshev(actor, door) > MELEE_RANGE) { addLog(`⚠ ${actor.name} must stand next to the ${doorLabel(door)}.`, 'info'); return; }
  if (refuseRepeat(actor, 'door', 'a door')) return;
  spendAction(actor, 'door');
  swingDoorOpen(door, `🚪 ${actor.name} opens the ${doorLabel(door)}.`);
  endAction(false);
}

export function handleAttackDoor(attackerId, x, y) {
  const atk  = getCombatant(attackerId);
  const door = closedDoors().find(d => d.x === x && d.y === y);
  if (!atk || !door || S.hasActed) return;
  if (chebyshev(atk, door) > MELEE_RANGE) { addLog(`⚠ ${atk.name} must stand next to the ${doorLabel(door)}.`, 'info'); return; }
  if (refuseRepeat(atk, 'door', 'a door')) return;
  spendAction(atk, 'door');
  const dice = atk.transformedBaseAtk?.dices ?? atk.sourceChar.baseAtk?.dices ?? '1d4';
  wearDoor(door, parseDice(dice).total, atk.name);
  endAction(false);
}

export function coneCellTargets(caster, ability, dirCell) {
  const cells = coneCells(caster, ability, dirCell);
  return enemies(caster)
    .filter(t => cells.some(c => c.x === t.x && c.y === t.y));
}

// A blast centred on (cx, cy) reaches (x, y) when it is within the radius and no wall stands between them
export function blastReaches(cx, cy, x, y, radius) {
  return chebyshev({ x: cx, y: cy }, { x, y }) <= radius && hasLos(cx, cy, x, y);
}

export function aoeCombatantHits(ability, caster, cx, cy) {
  const radius  = ability.radius > 0 ? ability.radius : 1;
  const isAlly  = ability.targetKind === 'ally';
  const pool    = isAlly ? livingCombatants(caster.teamIndex) : enemies(caster);
  return pool.filter(t => blastReaches(cx, cy, t.x, t.y, radius));
}

// The caster must see the cell an area spell is centred on
export function aoeCenterValid(caster, ability, gx, gy) {
  return chebyshev(caster, { x: gx, y: gy }) <= (ability.range ?? SPELL_RANGE)
    && isWalkableG(S.currentMap, gx, gy) && hasLos(caster.x, caster.y, gx, gy);
}

export function hasValidTarget(actor, ability) {
  if (!ability) {
    return targetPool(actor).some(t => targetInRange(actor, t, null).inRange);
  }
  if (ability.isAoe || ability.isCone || ability.isSplash) return true;
  if (ability.targetKind === 'self')  return true;
  if (ability.isRevive)               return koAllies(actor.teamIndex).length > 0;
  if (ability.tags?.includes('repair')) return livingCombatants(actor.teamIndex).some(isMecha);   // Remake needs a machine to mend
  if (ability.targetKind === 'ally')  return livingCombatants(actor.teamIndex).length > 0;
  if (ability.targetKind === 'any')
    return S.combatants.some(t => !t.isKO && t.id !== actor.id && targetInRange(actor, t, ability).inRange);
  return targetPool(actor).some(t => targetInRange(actor, t, ability).inRange);
}

export function clearAimState() {
  S.aimMode = false; S.aimAbility = null; S.aimSection = null; S.aimHover = null;
  if (headless) return;
  document.getElementById('dungeon-canvas')?.classList.remove('aim-mode');
}

export function enterAimMode(ability, section) {
  if (!S.currentMap) return;
  S.aimMode    = true;
  S.aimAbility = ability;
  S.aimSection = section;
  S.aimHover   = null;
  if (!headless) document.getElementById('dungeon-canvas')?.classList.add('aim-mode');
  drawMap();
}

export function exitAimMode() {
  clearAimState();
  drawMap();
}

// Player backs out of targeting (Esc / right-click): nothing is spent
export function cancelAim() {
  if (!S.aimMode) return;
  exitAimMode();
  if (headless) return;
  const hint = document.getElementById('aim-hint-ability');
  if (hint) hint.style.display = 'none';
}

export function enterTeleportMode(c, range, group = null) {
  S.teleportMode    = true;
  S.teleportActorId = c.id;
  S.teleportRange   = range;
  S.teleportGroup   = group;
  if (!headless) document.getElementById('dungeon-canvas')?.classList.add('teleport-mode');
  drawMap();
}

export function exitTeleportMode() {
  S.teleportMode    = false;
  S.teleportActorId = null;
  S.teleportRange   = 0;
  S.teleportGroup   = null;
  if (!headless) document.getElementById('dungeon-canvas')?.classList.remove('teleport-mode');
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
  S.reachableCells = bfsReachable(c.x, c.y, moveSpeed(c));

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

  const canvas = headless ? null : document.getElementById('dungeon-canvas');
  if (canvas) canvas.classList.add('move-mode');
  drawMap();
}

export function exitMoveMode() {
  S.moveMode = false;
  S.reachableCells = new Map();
  const canvas = headless ? null : document.getElementById('dungeon-canvas');
  if (canvas) canvas.classList.remove('move-mode');
  drawMap();
}

// Walking opens wounds: every Bleed costs its dice once for the move, every Hemoragie for each cell walked
function bleedFromMoving(c, cells) {
  for (const e of [...c.statusEffects]) {
    const dot = DOTS[e.name.toLowerCase()];
    if (!dot?.moving || c.isKO) continue;
    const dealt = applyDamage(c, parseDice(e.dice, { diceMult: dot.moving === 'cell' ? cells : 1 }).total, e.damType);
    if (dealt > 0) addLog(`🩸 ${c.name} bleeds ${dealt} ${e.damType} from ${e.name}${dot.moving === 'cell' ? ` (${cells} cells)` : ''}.`, 'status');
  }
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
  const cells = S.reachableCells.get(key) ?? chebyshev(c, { x: gx, y: gy });
  c.x = gx; c.y = gy;
  S.hasMoved = true;
  exitMoveMode();
  bleedFromMoving(c, cells);
  R.renderCombatScreen();
}

// Places a pending teleport on (gx, gy); returns false (and stays in teleport mode) when the cell is illegal
export function handleTeleportClick(gx, gy) {
  if (!S.teleportMode) return false;
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
  if (!actor || chebyshev(actor, { x: gx, y: gy }) > S.teleportRange
      || !isWalkableG(S.currentMap, gx, gy) || isOccupied(gx, gy, actor.id)
      || teleportBlockedByDomain) return false;
  addLog(`✦ ${actor.name} teleports to (${gx}, ${gy})!`, 'spell');
  const origin = { x: actor.x, y: actor.y };
  const group  = S.teleportGroup;
  actor.x = gx; actor.y = gy;
  S.lastTeleportedIds = group ? relocateAllies(actor, origin, group.radius || 1) : null;
  const reactAbility = S.pendingTeleportReact;
  S.pendingTeleportReact = null;
  exitTeleportMode();
  if (reactAbility) {
    resumePendingAction(reactAbility);
  } else {
    R.renderCombatScreen();
  }
  return true;
}

export function setupCanvasClickHandler() {
  if (headless) return;
  const canvas = document.getElementById('dungeon-canvas');
  if (!canvas) return;

  if (canvas._clickHandler)  canvas.removeEventListener('click',     canvas._clickHandler);
  if (canvas._moveHandler)   canvas.removeEventListener('mousemove', canvas._moveHandler);
  if (canvas._leaveHandler)  canvas.removeEventListener('mouseleave',canvas._leaveHandler);
  if (canvas._menuHandler)   canvas.removeEventListener('contextmenu',canvas._menuHandler);

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
      handleTeleportClick(gx, gy);
      return;
    }
    if (S.aimMode) {
      const active      = activeCombatant();
      const abilityName = S.aimAbility.name;
      const section     = S.aimSection;

      if (S.aimAbility.isAoe) {
        if (aoeCenterValid(active, S.aimAbility, gx, gy)) {
          const hits = aoeCombatantHits(S.aimAbility, active, gx, gy);
          const converting = isConvert(S.aimAbility);
          if (hits.length === 0 && !converting && doorsInBlast(active, S.aimAbility, { x: gx, y: gy }).length === 0) { addLog('No valid target in that area — pick another cell.', 'info'); return; }
          exitAimMode();
          const hintEl = document.getElementById('aim-hint-ability');
          if (hintEl) hintEl.style.display = 'none';
          handleCastAbility(active.id, abilityName, hits.map(t => t.id), { x: gx, y: gy });
        }
        return;
      } else if (S.aimAbility.isCone) {
        const targets = coneCellTargets(active, S.aimAbility, { x: gx, y: gy });
        if (targets.length === 0 && doorsInBlast(active, S.aimAbility, { x: gx, y: gy }).length === 0) { addLog('No valid target in that direction — pick another cell.', 'info'); return; }
        exitAimMode();
        handleCastAbility(active.id, abilityName, targets.map(t => t.id), { x: gx, y: gy });
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

  canvas._menuHandler = (e) => {
    if (!S.aimMode) return;
    e.preventDefault();
    cancelAim();
  };

  canvas.addEventListener('contextmenu', canvas._menuHandler);
  canvas.addEventListener('click',      canvas._clickHandler);
  canvas.addEventListener('mousemove',  canvas._moveHandler);
  canvas.addEventListener('mouseleave', canvas._leaveHandler);
}

export function drawMap() {
  if (headless) return;
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
  // Water that Convert has frozen or boiled away
  for (const [cells, fill] of [[S.iceCells, 'rgba(200,235,250,0.85)'], [S.driedCells, 'rgba(214,196,160,0.9)']]) {
    ctx.fillStyle = fill;
    for (const k of cells ?? []) {
      const [gx, gy] = k.split(',').map(Number);
      ctx.fillRect(gx * cp, gy * cp, cp, cp);
    }
  }

  // Doors still shut: gold for a locked one, grey for a secret one (the image shows plain wall), iron for a portcullis
  const DOOR_FILL = { locked: 'rgba(212,160,40,0.75)', secret: 'rgba(110,100,95,0.8)', portcullis: 'rgba(70,80,95,0.8)' };
  for (const d of S.currentMap.doors ?? []) {
    if (d.open) continue;
    ctx.fillStyle = DOOR_FILL[d.kind];
    ctx.fillRect(d.x * cp + cp * 0.1, d.y * cp + cp * 0.1, cp * 0.8, cp * 0.8);
    ctx.strokeStyle = 'rgba(20,15,10,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(d.x * cp + cp * 0.1, d.y * cp + cp * 0.1, cp * 0.8, cp * 0.8);
  }

  // Lingering fields
  for (const f of S.fields) {
    ctx.fillStyle = f.kind === 'allies' ? 'rgba(90, 180, 110, 0.22)' : 'rgba(140, 90, 170, 0.22)';
    for (let gx = f.x - f.radius; gx <= f.x + f.radius; gx++) for (let gy = f.y - f.radius; gy <= f.y + f.radius; gy++) {
      if (isWalkableG(S.currentMap, gx, gy)) ctx.fillRect(gx * cp, gy * cp, cp, cp);
    }
  }

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
      const radius  = S.aimAbility.radius > 0 ? S.aimAbility.radius : 1;
      const { cols, rows } = S.currentMap.grid;
      ctx.fillStyle = 'rgba(255,140,0,0.12)';
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (aoeCenterValid(active, S.aimAbility, gx, gy))
            ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
      if (S.aimHover && aoeCenterValid(active, S.aimAbility, S.aimHover.x, S.aimHover.y)) {
        const { x: hx, y: hy } = S.aimHover;
        ctx.fillStyle = 'rgba(255,100,0,0.38)';
        for (let gy = 0; gy < rows; gy++) {
          for (let gx = 0; gx < cols; gx++) {
            if (isWalkableG(S.currentMap, gx, gy) && blastReaches(hx, hy, gx, gy, radius))
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
      const hits     = enemies(active)
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
    // The map is drawn rotated; counter-rotate so the initial reads upright
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(c.name[0].toUpperCase(), 0, 0);
    ctx.restore();
  }
  ctx.shadowBlur = 0;
}

// ── §8  Log ────────────────────────────────────────────────────────────────

// flavor: 'turn' opens a combatant's turn (extra.team), 'divider' a round; the rest style one line
export function addLog(text, flavor = 'info', extra = {}) {
  const entry = { text, flavor, ...extra };
  S.log.push(entry);
  R.appendLog(entry);
}

export function addRoundDivider() {
  addLog(`Round ${S.roundNumber}`, 'divider');
}

// ── §9  Combat Logic ───────────────────────────────────────────────────────

export function updateCombatantCardDOM(c) {
  if (headless) return;
  const card = document.querySelector(`.combat-char-card[data-id="${c.id}"]`);
  if (!card) return;
  const pct  = Math.max(0, (c.currentHp / c.maxHp) * 100);
  const bar  = card.querySelector('.hp-bar');
  const text = card.querySelector('.hp-text');
  if (bar)  { bar.style.width = `${pct.toFixed(1)}%`; bar.className = `hp-bar${pct < 25 ? ' low' : pct < 50 ? ' mid' : ''}`; }
  if (text) text.textContent = `${c.currentHp} / ${c.maxHp} HP`;
  if (c.isKO && !card.classList.contains('is-ko')) {
    card.classList.add('is-ko');
    card.querySelector('.card-flag')?.remove();
    card.querySelector('.combat-char-head')?.insertAdjacentHTML('beforeend', '<span class="card-flag card-flag--ko">Fallen</span>');
  }
}

// A machine (tag mecha) is mended only by a repair (Sora's Remake); a classic heal does nothing to it
export const isMecha = c => !!c && unitHasTag(c, 'mecha');
// Can heal `ability` mend `target`? Remake mends only machines, every other heal only the living
export const healsTarget = (ability, target) => ability?.tags?.includes('repair') ? isMecha(target) : !(ability?.isHeal && isMecha(target));

export function applyHeal(combatant, diceExpr, label = null, repair = false, shieldOverheal = true) {
  if (!diceExpr) return;
  if (isMecha(combatant) && !repair) {
    if (combatant.currentHp < combatant.maxHp) addLog(`⚙ ${combatant.name} is a machine${label ? ` — ${label} cannot mend it` : ' — a classic heal cannot mend it'}. Only a repair can.`, 'info');
    return;
  }
  const r      = parseDice(diceExpr);
  const amount = Math.max(0, r.total);
  const healed = Math.min(amount, combatant.maxHp - combatant.currentHp);
  combatant.currentHp = Math.min(combatant.maxHp, combatant.currentHp + amount);
  if (shieldOverheal) overhealToShield(combatant, amount - healed);
  if (healed > 0)
    addLog(`💚 ${combatant.name}${label ? ` [${label}]` : ''} recovers ${healed} HP! (${combatant.currentHp}/${combatant.maxHp}) [${r.breakdown}]`, 'heal');
  updateCombatantCardDOM(combatant);
}

// Applies one hit to `combatant` and returns the HP it actually lost (0 when fully
// absorbed or immune). The "HP before → after" line is logged here, after every
// mitigation step, so callers never need to predict the result themselves.
// Every blow of a Dream Hunter that lands (attack, spell, technique...) corrupts its target: `strikeSource` is the unit whose action is being settled
export function applyDamage(combatant, amount, damType = null, atkTags = [], ignoreDR = false) {
  const before = combatant.currentHp;
  const dealt = applyDamageCore(combatant, amount, damType, atkTags, ignoreDR);
  if (dealt > 0 && !combatant.isKO) {
    for (const p of combatant.sourceChar.passif ?? []) {
      if (p.applyOn?.includes('hpPerDamageTaken') && p.dices && !passiveLost(combatant, p)) applyHeal(combatant, p.dices, p.nom);   // Kaelgrym's Cauterise
    }
  }
  if (strikeSource && strikeSource !== combatant && (dealt > 0 || combatant.currentHp < before)) corruptTarget(strikeSource, combatant);
  return dealt;
}

function applyDamageCore(combatant, amount, damType = null, atkTags = [], ignoreDR = false) {
  const done = () => { updateCombatantCardDOM(combatant); return 0; };

  // A prisoner of a chain: its allies' blows land on the chain, which is how they free it
  const hold = amount > 0 ? chainHolding(combatant) : null;
  if (hold) {
    const actor = activeCombatant();
    if (actor && actor.teamIndex === combatant.teamIndex && actor.id !== combatant.id) {
      chainTakesHit(combatant, hold, amount);
      return done();
    }
  }

  // Immunity — only the damage *types* of the hit count (status tags are handled in applyStatus).
  // Fully immune → nothing lands. Immune to only some of the types → the hit is split
  // evenly between its types and the immune share is lost (e.g. physical+fire vs fire-immune).
  const types = [...new Set([damType, ...atkTags]
    .filter(t => t && DAMAGE_TYPES.includes(String(t).toLowerCase()))
    .map(t => String(t).toLowerCase()))];
  const immune = (combatant.sourceChar.immunities ?? []).map(i => i.toLowerCase());
  const absorbsFire = combatant.sourceChar.passif?.some(p => p.tags?.includes('absorbFire') && !passiveLost(combatant, p))
    && !combatant.statusEffects.some(e => e.name === 'relic_awake');
  if (absorbsFire) immune.push('fire');
  // "magic" is no damage type, but a spell's share is turned away by a magic immunity (Hela's Anti-Magic) unless Authority pierces it
  const magical = atkTags.includes('magic') && immune.includes('magic');
  if (magical && piercesGate(combatant)) addLog(`🪞 Authority ${strikeAuthority} pierces ${combatant.name}'s Anti-Magic!`, 'crit');
  const hitTypes = magical && !piercesGate(combatant) ? [...types, 'magic'] : types;
  const immuneTypes = hitTypes.filter(t => immune.includes(t));
  if (absorbsFire && types.includes('fire')) restoreSlots(combatant, 1, "Ifrit's Bane");
  if (immuneTypes.length === hitTypes.length && hitTypes.length > 0) {
    addLog(`🛡 ${combatant.name} is immune to ${immuneTypes.join('/')}!`, 'info');
    return done();
  }
  if (immuneTypes.length > 0) {
    const before = amount;
    amount = Math.floor(amount * (hitTypes.length - immuneTypes.length) / hitTypes.length);
    addLog(`🛡 ${combatant.name} is immune to ${immuneTypes.join('/')} — only the rest of the hit lands (${before} → ${amount}).`, 'info');
  }

  // Lightning conducts through water (a mixed hit is raised in proportion to its lightning share)
  if (types.includes('lightning') && isWet(combatant)) {
    const before = amount;
    amount = Math.floor(amount * (1 + (WET_LIGHTNING - 1) / types.length));
    addLog(`💧 ${combatant.name} is wet — the lightning bites harder (${before} → ${amount}).`, 'hit');
    if (hasWetStatus(combatant)) dropWetStatus(combatant);   // the soaking is spent; water underfoot is not
  }
  if (types.includes('fire') && hasWetStatus(combatant)) {
    dropWetStatus(combatant);
    addLog(`♨ The fire dries ${combatant.name}.`, 'info');
  }
  // Thermal shock: a fire attack that reaches a frozen target thaws it and hurts it for 2d12 more
  const frozen = types.includes('fire') && amount > 0 ? combatant.statusEffects.find(e => ['gel', 'freeze'].includes(e.name.toLowerCase())) : null;
  if (frozen) {
    combatant.statusEffects = combatant.statusEffects.filter(e => e !== frozen);
    const shock = parseDice('2d12');
    amount += shock.total;
    addLog(`🔥❄ Thermal shock! The fire thaws ${combatant.name}: +${shock.total} (${shock.breakdown}).`, 'crit');
  }

  // Living Blade Armor: halve incoming physical before any absorption
  const bladeArmor = combatant.statusEffects.find(e => e.name === 'living_blade_armor');
  if (bladeArmor && atkTags.includes('physical')) {
    amount = Math.floor(amount / 2);
    combatant.statusEffects = combatant.statusEffects.filter(e => e !== bladeArmor);
    addLog(`⚔ ${combatant.name}'s Living Blade Armor halves the physical hit! (→ ${amount})`, 'spell');
  }
  // Defensive stance: flat reduction before any absorption
  const stance = combatant.statusEffects.find(e => e.name === 'damage_reduction');
  if (stance && amount > 0 && !ignoreDR) {
    const before = amount;
    amount = Math.max(0, amount - stance.amount);
    addLog(`🐗 ${combatant.name}'s ${stance.label ?? 'stance'} shaves ${before - amount} off the hit! (${before} → ${amount})`, 'spell');
  }
  // Damage-absorption shield / chains check (bypassed by unblockabled or antiMagic on spell/art shields)
  const dmgShield = combatant.statusEffects.find(e => e.name === 'damage_shield');
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
    addLog(`🛡 ${combatant.name}'s shield absorbs ${absorbed}! (${dmgShield.shieldHp} HP left)`, 'spell');
    if (dmgShield.shieldHp <= 0) {
      combatant.statusEffects = combatant.statusEffects.filter(e => e !== dmgShield);
      addLog(`🛡 ${combatant.name}'s shield is destroyed!`, 'spell');
    }
    if (amount <= 0) return done();
  }
  // Conditional incoming damage reduction passives (e.g. Magic Resist -10, Iron Pelt -1d6+2).
  // A leading minus marks the whole expression as a reduction: "-1d8+10" reduces by 1d8+10.
  for (const p of combatant.sourceChar.passif ?? []) {
    if (ignoreDR) break;
    if (passiveLost(combatant, p)) continue;
    if (!p.applyOn?.includes('incomingDam') || !p.dices || !p.condition?.incomingHasTag || amount <= 0) continue;
    const expr = String(p.dices).trim();
    if (!expr.startsWith('-')) continue;
    const condTag = p.condition.incomingHasTag.toLowerCase();
    const matches = damType?.toLowerCase() === condTag || atkTags.some(t => t.toLowerCase() === condTag);
    if (!matches) continue;
    const r = parseDice(expr.slice(1).trim());
    const before = amount;
    amount = Math.max(0, amount - r.total);
    addLog(`🛡 ${combatant.name}'s "${p.nom}" reduces incoming damage by ${before - amount}! (${before} → ${amount})`, 'info');
  }
  // Relentless Warrior: every fallen ally takes the passive's dice (1d10+2) off each hit the owner takes
  for (const p of combatant.sourceChar.passif ?? []) {
    if (ignoreDR || amount <= 0) break;
    if (!p.tags?.includes('relentless') || passiveLost(combatant, p)) continue;
    const before = amount;
    for (let i = combatant.stacks[p.nom] ?? 0; i > 0 && amount > 0; i--) amount = Math.max(0, amount - parseDice(String(p.dices).replace(/^[+-]/, '')).total);
    if (amount < before) addLog(`🛡 ${combatant.name}'s ${p.nom} reduces the hit by ${before - amount}! (${before} → ${amount})`, 'info');
  }
  // Divine Beast synergy (Northern Depths): "-1d8" off every hit taken by the allies of a synced Beast
  for (const e of divineEffects(combatant, 'incomingDam')) {
    if (ignoreDR || amount <= 0 || !e.dices || !String(e.dices).trim().startsWith('-')) continue;
    const r = parseDice(String(e.dices).trim().slice(1).trim());
    const before = amount;
    amount = Math.max(0, amount - r.total);
    addLog(`🛡 ${e.nom} reduces ${combatant.name}'s damage by ${before - amount}! (${before} → ${amount})`, 'info');
  }
  // Vorrakan's free chains take the hit in his stead once he has answered it with Chain Guard (a hit that cannot be blocked goes through)
  if (combatant.chains && !atkTags.includes('unblockabled') && combatant.statusEffects.some(e => e.name === 'chain_guard')) {
    amount = chainGuard(combatant, amount);
  }
  // Lethal-hit passives (Unkillable): a coin flip to survive, at the cost of dropping to 1 HP
  for (const p of combatant.sourceChar.passif ?? []) {
    if (passiveLost(combatant, p)) continue;
    if (!p.applyOn?.includes('incomingDam') || !p.condition?.incomingIsLethal || p.chance == null) continue;
    if (amount < combatant.currentHp) continue;
    if (random() < p.chance) {
      amount = combatant.currentHp - 1;
      addLog(`🛡 ${combatant.name}'s "${p.nom}" holds — survives the lethal hit on 1 HP!`, 'crit');
    } else {
      addLog(`🛡 ${combatant.name}'s "${p.nom}" fails to hold!`, 'info');
    }
    break;
  }
  const dmg = Math.max(0, amount);
  const hpBefore = combatant.currentHp;
  combatant.currentHp = Math.max(0, hpBefore - dmg);
  if (dmg > 0) addLog(`  ${combatant.name}: ${hpBefore} → ${combatant.currentHp}`, 'hit');
  if (combatant.currentHp <= 0 && !combatant.isKO) {
    const lives = combatant.sourceChar.passif?.find(p => p.applyOn?.includes('deathRoll') && p.maxStacks
      && (combatant.deathSaves[p.nom] ?? 0) < p.maxStacks);
    if (lives) {
      const used = combatant.deathSaves[lives.nom] = (combatant.deathSaves[lives.nom] ?? 0) + 1;
      combatant.currentHp = 1;
      addLog(`✨ ${combatant.name}'s ${lives.nom} brings them back with 1 HP! (${used}/${lives.maxStacks})`, 'crit');
    }
    // A death save (Alicia's Loki's Blessing): once per fight, two d20s, 10 or more on either keeps them up
    const saveP = lives ? null : combatant.sourceChar.passif?.find(p =>
      p.applyOn?.includes('deathRoll') && !p.maxStacks && !combatant.deathSaves[p.nom]);
    let saved = false;
    if (saveP) {
      combatant.deathSaves[saveP.nom] = 1;
      const rolls = [rollD20().value, rollD20().value];
      saved = rolls.some(v => v >= 10);
      addLog(`🎲 ${combatant.name} makes a death save (${rolls.join(' & ')})${saved ? ` — ${saveP.nom} keeps them up with 1 HP!` : ' — and fails.'}`, saved ? 'crit' : 'death');
      if (saved) combatant.currentHp = 1;
    }
    const survived = !!lives || saved;
    const resAb = survived ? null : combatant.abilities.find(a =>
      a.name === 'Resurrection' && a.isOncePerFight && !combatant.usedThisFight.includes('Resurrection')
    );
    const rewindAb = survived || resAb ? null : combatant.abilities.find(a =>
      a.tags?.includes('onDeath') && a.isOncePerFight && !combatant.usedThisFight.includes(a.name)
    );
    if (rewindAb) rewindTime(combatant, rewindAb);
    else if (resAb) {
      combatant.currentHp = 150;
      combatant.usedThisFight.push('Resurrection');
      addLog(`💀✨ ${combatant.name} RESURRECTS with 150 HP — Final Reckoning activates!`, 'crit');
      combatant.statusEffects.push({ name: 'final_reckoning', turnsLeft: 999, dice: '2d12', damType: null, notes: '+2d12 atk bonus, one more action a turn' });
    } else if (!survived && rollReborn(combatant)) {
      rebornAs(combatant);
    } else if (!survived) {
      combatant.isKO = true;
      noteFallen(combatant);
      combatant.statusEffects = [];   // the dead keep no buffs or damage-over-time
      addLog(`💀 ${combatant.name} is KO!`, 'death');
      if (combatant.domainActive) suppressDomain(combatant);
    }
  }
  updateCombatantCardDOM(combatant);
  return dmg;
}

// Easter egg: a sheet with `reborn: { into, chance }` may rise again as another sheet when it dies (Sienna, 1 in 100, as Vampire Sienna)
const rollReborn = c => !!c.sourceChar.reborn && random() < c.sourceChar.reborn.chance;

// The fallen is the same unit (id, cell, team, owner, place in the order) but wears the new sheet, whole again
function rebornAs(c) {
  const sheet = allChars.find(x => x.nom === c.sourceChar.reborn.into);
  if (!sheet) return;
  const from = c.name;
  const fresh = buildCombatant(sheet, c.teamIndex, c.id);
  Object.assign(fresh, { x: c.x, y: c.y, ownerId: c.ownerId, initiativeRoll: c.initiativeRoll });
  Object.assign(c, fresh);
  addLog(`🦇✨ ${from} falls... and rises again as ${c.name}, whole once more!`, 'crit');
  markHunter(c);
}

// Chronos' Rewind: on a killing blow, once per fight, he steps back to where he stood two rounds ago. His life
// is what it was then (never less than REWIND_FLOOR), and every hindrance on him is undone.
const REWIND_FLOOR = 200;
function rewindTime(c, ab) {
  const then = c.trail?.[0];
  c.usedThisFight.push(ab.name);
  c.currentHp = Math.max(then?.hp ?? 0, REWIND_FLOOR);
  c.statusEffects = [];
  if (then && !isOccupied(then.x, then.y, c.id)) { c.x = then.x; c.y = then.y; }
  addLog(`⏳✨ ${c.name} REWINDS — time unwinds and he stands again with ${c.currentHp} HP!`, 'crit');
}

// Where each unit stood at the start of the last two rounds (Rewind goes back to the older one)
function recordTrail() {
  for (const c of S.combatants) {
    if (c.isKO) continue;
    (c.trail ??= []).push({ hp: c.currentHp, x: c.x, y: c.y });
    if (c.trail.length > 2) c.trail.shift();
  }
}

// Withering Hour: while it lasts, each basic attack that lands also cuts the target's maximum HP, and the cuts pile up
function witherMax(atk, def) {
  const w = atk.statusEffects.find(e => e.name === 'withering');
  if (!w || def.isKO) return;
  const cut = Math.min(w.amount ?? 0, def.maxHp - 1);
  if (cut <= 0) return;
  def.maxHp -= cut;
  def.currentHp = Math.min(def.currentHp, def.maxHp);
  addLog(`  ⌛ ${def.name} withers — maximum HP −${cut} (now ${def.maxHp}).`, 'status');
  updateCombatantCardDOM(def);
}

export function applyStatus(combatant, effectStr, defaultTurns = 2) {
  // A hit that kills its target still applies its effect afterwards; the dead keep no statuses
  if (!effectStr || combatant.isKO) return;
  const immunities = (combatant.sourceChar.immunities ?? []).map(i => i.toLowerCase());
  for (const part of String(effectStr).split(',')) {
    const p = part.trim();
    if (!p) continue;
    // "1dN effect" = 1/N probability check; succeed only on max roll (N)
    const probMatch = p.match(/^1d(\d+)\s+(.+)$/i);
    const effName   = probMatch ? probMatch[2].trim() : p;
    const key       = effName.toLowerCase();
    const beneficial = BENEFICIAL_STATUSES.includes(key);

    // Buffs are never blocked by immunities; everything else is checked against the
    // blanket "status" immunity and the status's own name or alias (gel ↔ freeze, toxic ↔ poison)
    if (!beneficial) {
      if (isDebuff({ name: key }) && combatant.statusEffects.some(e => e.name === 'ward')) {
        addLog(`🌙 ${combatant.name} is warded against ${effName}!`, 'info');
        continue;
      }
      if (immunities.includes('status')) {
        if (!piercesGate(combatant)) {
          addLog(`🛡 ${combatant.name} is immune to all status effects!`, 'info');
          continue;
        }
        addLog(`🪞 Authority ${strikeAuthority} pierces ${combatant.name}'s Anti-Magic!`, 'crit');
      }
      if (immunities.includes(key) || (STATUS_ALIASES[key] && immunities.includes(STATUS_ALIASES[key]))
          || (DOTS[key] && immunities.includes(DOTS[key].base) && !combatant.sourceChar.dotDamage?.[key])) {   // `dotDamage` names an upgrade the basic immunity does not cover (Wyldfire's toxic)
        addLog(`🛡 ${combatant.name} is immune to ${effName}!`, 'info');
        continue;
      }
      if (DOTS[key]?.base === 'bleed' && unitHasTag(combatant, 'mecha')) {
        addLog(`🛡 ${combatant.name} is a machine and cannot ${key === 'bleed' ? 'bleed' : 'haemorrhage'}!`, 'info');
        continue;
      }
    }
    if (probMatch) {
      const sides = parseInt(probMatch[1]);
      const roll  = Math.floor(random() * sides) + 1;
      if (roll < sides) {
        addLog(`${combatant.name} resists ${effName}. (${roll}/${sides})`, 'info');
        continue;
      }
    }
    // A damage over time lasts its own number of turns; the ones that hurt on a move need one more for the last turn's walk
    const dot   = DOTS[key];
    const turns = dot ? dot.life + (dot.moving ? 1 : 0) : (STATUS_TURNS[key] ?? defaultTurns);

    const eff      = findEffect(effName);
    const existing = dot ? null : combatant.statusEffects.find(e => e.name.toLowerCase() === key);
    if (key === 'wet') {
      const fire = combatant.statusEffects.filter(e => e.name.toLowerCase() === 'burn');
      if (fire.length) {
        combatant.statusEffects = combatant.statusEffects.filter(e => !fire.includes(e));
        addLog(`💧 The water puts out ${combatant.name}'s burning.`, 'status');
      }
    }
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

// A growing damage over time: its dice count rises by one for every turn it has already hurt
export const grownDice = eff => eff.dice.replace(/^(\d+)d/, (_, n) => `${Number(n) + (eff.ticks ?? 0)}d`);

// Chronostasis: at the start of his own turn the domain gives its owner back one of three things, picked at random
// (life, spell slots, or a charge of a move that has them); an option that is already full is not drawn
export function grantBoon(c, eff) {
  const { hp = 0, slots = 0, charges = 1 } = eff.boons ?? {};
  const charged = c.abilities.find(a => a.maxCharges > 0 && (c.remainingCharges[a.name] ?? a.maxCharges) < a.maxCharges);
  const options = [];
  if (hp > 0 && c.currentHp < c.maxHp) options.push('hp');
  if (slots > 0 && c.spellSlots < c.maxSpellSlots) options.push('slots');
  if (charged) options.push('charge');
  if (!options.length) return;
  const pick = options[Math.floor(random() * options.length)];
  if (pick === 'hp') applyHeal(c, String(hp), eff.nom);
  else if (pick === 'slots') restoreSlots(c, slots, eff.nom);
  else {
    (c.chargesWound ??= {})[charged.name] = (c.chargesWound[charged.name] ?? 0) + 1;
    c.remainingCharges[charged.name] = Math.min(charged.maxCharges, (c.remainingCharges[charged.name] ?? charged.maxCharges) + charges);
    addLog(`  ⏳ ${eff.nom}: ${c.name} winds back ${charged.name} (${c.remainingCharges[charged.name]}/${charged.maxCharges}).`, 'heal');
  }
}

export function tickTurn(c) {
  const regenNames = ['regen', 'domain regen', 'regeneration'];
  const expired   = [];

  for (const eff of c.statusEffects) {
    const n = eff.name.toLowerCase();
    if (TICKING_DOTS.includes(n) && eff.dice && eff.dice !== '—') {
      // A sheet can cap what one damage over time does to its owner (`dotDamage`: Wyldfire takes 1d4 from toxic)
      const cap = c.sourceChar.dotDamage?.[n];
      const r = parseDice(cap ?? (DOTS[n].grows ? grownDice(eff) : eff.dice));
      eff.ticks = (eff.ticks ?? 0) + 1;
      // A capped tick is no longer poison damage, so the owner's poison immunity does not swallow it
      const tickType = cap ? n : eff.damType;
      const dealt = applyDamage(c, r.total, tickType);
      if (dealt > 0) addLog(`${c.name} takes ${dealt} ${tickType} from ${eff.name}. (${r.breakdown})`, 'status');
      if (c.isKO) return false;
    }
    if (regenNames.some(rn => n.includes(rn)) && eff.dice && eff.dice !== '—') {
      applyHeal(c, eff.dice);
    }
    if (n === 'final_reckoning') applyHeal(c, '1d10', 'Final Reckoning');
    eff.turnsLeft--;
    if (eff.turnsLeft <= 0) expired.push(eff);
  }
  c.statusEffects = c.statusEffects.filter(e => !expired.includes(e));
  for (const e of expired) if (e.name !== 'form_timer') addLog(`${c.name}'s ${e.name} wears off.`, 'info');
  if (expired.some(e => e.name === 'form_timer')) revertForm(c);

  if (c.kiRegen > 0 && c.ki < c.maxKi) c.ki = Math.min(c.maxKi, c.ki + c.kiRegen);

  for (const key of Object.keys(c.cooldowns)) c.cooldowns[key] = Math.max(0, c.cooldowns[key] - 1);
  return true;
}

export function applyHpPerHitPassives(combatant) {
  for (const p of combatant.sourceChar.passif ?? []) {
    if (passiveLost(combatant, p)) continue;
    if (!p.applyOn?.includes('hpPerHit') || !p.dices) continue;
    applyHeal(combatant, p.dices, p.nom);   // rolled once, logged once (and only if HP was actually missing)
  }
}

export function removeFlying(target) {
  const idx = target.statusEffects.findIndex(e => e.name.toLowerCase() === 'fly');
  if (idx !== -1) {
    if (isImmovable(target)) { addLog(`⚓ ${target.name} cannot be grounded.`, 'info'); return; }
    target.statusEffects.splice(idx, 1);
    addLog(`⬇ ${target.name} is grounded — fly removed!`, 'status');
    updateCombatantCardDOM(target);
  }
}

const NEGATIVE_STATUSES = ['para','gel','freeze','burn','calcinated','bleed','hemoragie','stun','root','fear','silence','blind','toxic','poison'];
const isDebuff = e => NEGATIVE_STATUSES.some(n => e.name.toLowerCase().includes(n));
// A chain's hold is no ordinary status: Cleanse (Zhuqiao, Nya) cannot lift it, only damage to the chain does
const cleansable = e => isDebuff(e) && e.chainOf == null;

// Lifts one debuff (the first it finds), the way Phoenix Grace does
function cleanseOne(target, source) {
  const bad = target.statusEffects.find(cleansable);
  if (!bad) return;
  target.statusEffects = target.statusEffects.filter(e => e !== bad);
  addLog(`✨ ${source} lifts ${bad.name} from ${target.name}.`, 'heal');
  updateCombatantCardDOM(target);
}

// Gives back spell slots, never past the maximum
function restoreSlots(unit, amount, source) {
  const gained = Math.min(amount, unit.maxSpellSlots - unit.spellSlots);
  if (gained <= 0) return;
  unit.spellSlots += gained;
  addLog(`  ✦ ${unit.name} recovers ${gained} slot(s) from ${source}! (${unit.spellSlots}/${unit.maxSpellSlots})`, 'heal');
  updateCombatantCardDOM(unit);
}

// Wyldfire's Convert: the water cells in the blast turn to ice or steam; everyone wet in it is frozen or dried
function convertArea(caster, ability, at) {
  const radius = ability.radius > 0 ? ability.radius : 1;
  const freeze = ability.tags.includes('convert_ice');
  const inBlast = (x, y) => blastReaches(at.x, at.y, x, y, radius);
  const cells = [...(S.currentMap?.water ?? [])].filter(k => {
    const [x, y] = k.split(',').map(Number);
    return isWaterCell(x, y) && inBlast(x, y);
  });
  const caught = S.combatants.filter(x => !x.isKO && inBlast(x.x, x.y));
  const soaked = caught.filter(isWet);   // read before the cells change
  addLog(freeze ? `❄ ${caster.name} freezes the water around (${at.x}, ${at.y})!` : `♨ ${caster.name} boils the water around (${at.x}, ${at.y}) away!`, 'spell');
  for (const k of cells) (freeze ? S.iceCells : S.driedCells).add(k);
  if (cells.length) addLog(`  ${cells.length} water cell${cells.length > 1 ? 's' : ''} ${freeze ? 'turn to ice' : 'evaporate'}.`, 'info');
  for (const u of soaked) {
    dropWetStatus(u);
    if (freeze) applyStatus(u, 'gel');
    else addLog(`  ♨ ${u.name} is dried.`, 'info');
  }
  for (const u of caught) updateCombatantCardDOM(u);
}

// Fire Tornado: allies within the blast shed wet and every disadvantage
function dryAllies(caster, ability, center) {
  const radius = ability.radius > 0 ? ability.radius : 1;
  for (const a of livingCombatants(caster.teamIndex)) {
    if (chebyshev(a, center) > radius) continue;
    const clear = a.statusEffects.filter(e => ['wet', 'disadvantage', 'smoke_screen', ...HINDRANCE_NAMES].includes(e.name));
    if (!clear.length) continue;
    a.statusEffects = a.statusEffects.filter(e => !clear.includes(e));
    addLog(`🔥 The tornado dries ${a.name} and clears their head (${clear.map(e => e.name).join(', ')}).`, 'info');
    updateCombatantCardDOM(a);
  }
}

// Bénédiction of the Moon: two turns safe from new debuffs
function applyWard(ability, target) {
  if (ability.tags?.includes('ward') && pushStatus(target, { name: 'ward', turnsLeft: 3 }, true)) {
    addLog(`🌙 ${target.name} is warded against debuffs for 2 turns.`, 'spell');
  }
}

export function applyCleanse(target) {
  const removed = target.statusEffects.filter(cleansable);
  target.statusEffects = target.statusEffects.filter(e => !cleansable(e));
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

// Does this attacker's hit bypass damage-reduction passives? (its domain, or the move's own unblockabled tag)
function ignoresDR(c, ability) {
  return !!ability?.tags?.includes('unblockabled')
      || getDomainEffects(c, { applyOn: 'atkRoll', ability }).some(e => e.tags?.includes('unblockabled'));
}

// Does the unit carry this tag: a character tag (unless its transformation sheds it) or a status of that name
export function unitHasTag(c, tag) {
  const t = String(tag).toLowerCase();
  const shed = c.isTransformed ? (c.sourceChar.transformation?.loseTags ?? []) : [];
  if (shed.some(x => x.toLowerCase() === t)) return false;
  // a form can add tags of its own (Nirvana is a divinity)
  const formTags = c.isTransformed ? (c.sourceChar.transformation?.tags ?? []) : [];
  return [...(c.sourceChar.tags ?? []), ...formTags].some(x => x.toLowerCase() === t) || c.statusEffects.some(e => e.name.toLowerCase() === t);
}

// The extra dice a move deals to this target (Force Lightning vs mechas, Ice Coffin vs the wet), or null
function bonusVsFor(ability, target, diceMult = 1) {
  const b = ability?.bonusVs;
  if (!b || !target) return null;
  const applies = b.vs === 'wet' ? isWet(target) : unitHasTag(target, b.vs);
  if (!applies) return null;
  const r = parseDice(b.dice, { diceMult });
  return { total: r.total, label: `${ability.name} vs ${b.vs}[${r.breakdown}]` };
}

// Does passive `p` (owned by `owner`, facing `other`) currently apply?
// Conditions the engine cannot evaluate (e.g. selfBehindTarget, needs facing) never apply.
function passiveConditionMet(p, owner, other, ability) {
  const cond = p.condition;
  if (!cond) return true;
  if (cond.targetMoreHp)   return other.currentHp > owner.currentHp;
  if (cond.allyKO)         return S.combatants.some(c => c.teamIndex === owner.teamIndex && c.isKO);
  if (cond.selfBelow50pct) return owner.currentHp <= owner.maxHp * 0.5;
  if (cond.is1v1)          return livingCombatants(0).length === 1 && livingCombatants(1).length === 1;
  if (cond.targetArmored)  return (other.sourceChar.passif ?? []).some(q => /armou?r/i.test(q.nom) && q.applyOn?.includes('defRoll'));
  if (cond.targetHasTag) {
    // a character `tags` list (when the data provides one) or a status the target is under (e.g. "stun")
    const tag = cond.targetHasTag.toLowerCase();
    return unitHasTag(other, tag);
  }
  if (cond.weaponType) {
    const w = cond.weaponType.toLowerCase();
    if (ability) return !!ability.tags?.includes(w);
    const atk = owner.transformedBaseAtk ?? owner.sourceChar.baseAtk;
    return (atk?.tags ?? []).includes(w) || (atk?.nom ?? '').toLowerCase().includes(w);
  }
  if (cond.contextHasTag) {
    const tag = cond.contextHasTag.toLowerCase();
    if (tag === 'water') return isWaterCell(owner.x, owner.y) && !owner.statusEffects.some(e => e.name.toLowerCase() === 'fly');
    if (tag === 'melee') return !!other && chebyshev(owner, other) <= MELEE_RANGE && !ability?.tags?.includes('ranged');
  }
  return false;
}

// ── Passive helpers: lost passives, stacks, Divine Beast synergy ────────────

// A passive can be switched off for a while (Oslo's Bone Armor after Bone Shatter)
const passiveLost = (c, p) => c.statusEffects.some(e => e.name === `lost:${p.nom}` || e.name === 'passives_off')
  || (c.isTransformed && !!c.sourceChar.transformation?.losePassives?.includes(p.nom));   // Dragon forms lose Armored until they end

// Off for the owner's next `turns` turns, back on the one after (statuses tick when the owner's turn starts)
function losePassive(c, nom, turns) {
  c.statusEffects = c.statusEffects.filter(e => e.name !== `lost:${nom}`);
  c.statusEffects.push({ name: `lost:${nom}`, turnsLeft: turns + 1, dice: null, damType: null, notes: `Back after ${turns} turns` });
  addLog(`🦴 ${c.name}'s ${nom} is gone for ${turns} turns.`, 'status');
}

// A healing move's dice plus the caster's healing-roll bonuses (Battle Medic)
function healDice(caster, target, ability) {
  const extra = rollBonuses(caster, 'healRoll', target, ability).map(b => /^[+-]/.test(b.dices) ? b.dices : '+' + b.dices);
  return [ability.dice, ...extra].join('');
}

const hasPassiveTag = (c, tag) => !!c.sourceChar.passif?.some(p => p.tags?.includes(tag) && !passiveLost(c, p));

// Vampire Sienna's Blood Magic: every hit that lands heals her for a share (drainPct) of the damage it dealt
function drainOnHit(owner, dealt) {
  if (!(dealt > 0) || owner.isKO) return;
  for (const p of owner.sourceChar.passif ?? []) {
    if (!p.drainPct || passiveLost(owner, p)) continue;
    const amount = Math.floor(dealt * p.drainPct / 100);
    if (amount > 0) applyHeal(owner, String(amount), `${p.nom} drain`);
  }
}

// Healing past full HP turns into an absorb shield for fighters with an overhealShield passive (Blood Magic)
function overhealToShield(c, overflow) {
  if (!(overflow > 0) || !hasPassiveTag(c, 'overhealShield')) return;
  const existing = c.statusEffects.find(e => e.name === 'damage_shield');
  if (existing) existing.shieldHp += overflow;
  else c.statusEffects.push({ name: 'damage_shield', turnsLeft: 999, shieldHp: overflow, dice: null, damType: null, notes: '', source: 'Blood Magic' });
  addLog(`  🩸 ${c.name}'s overheal becomes a ${overflow} HP blood shield.`, 'spell');
}

// Bite: spell slots and ki are taken from the target; the caster keeps what fits
function drainResources(caster, target, ability) {
  const slots = ability.drainSlots ? Math.min(target.spellSlots, parseDice(ability.drainSlots).total) : 0;
  const ki    = ability.drainKi    ? Math.min(target.ki, parseDice(ability.drainKi).total) : 0;
  if (slots > 0) {
    target.spellSlots -= slots;
    caster.spellSlots = Math.min(caster.maxSpellSlots, caster.spellSlots + slots);
  }
  if (ki > 0) {
    target.ki -= ki;
    caster.ki = Math.min(caster.maxKi, caster.ki + ki);
  }
  if (slots > 0 || ki > 0) addLog(`  🩸 ${caster.name} drains ${slots} spell slot${slots === 1 ? '' : 's'} and ${ki} ki from ${target.name}.`, 'spell');
  updateCombatantCardDOM(target);
}

// Vampire Sienna's Apex Predator: when her mark dies she is restored to full HP and spell slots
function feastOnMark(fallen) {
  for (const o of livingCombatants(1 - fallen.teamIndex)) {
    if (o.huntMarkId !== fallen.id || !o.sourceChar.passif?.some(p => p.tags?.includes('huntFeast'))) continue;
    o.currentHp = o.maxHp;
    o.spellSlots = o.maxSpellSlots;
    addLog(`🩸 ${o.name} feasts on ${fallen.name}: full HP and spell slots restored!`, 'heal');
    updateCombatantCardDOM(o);
  }
}

// At the start of the battle each hunter marks one random enemy (never a summon)
function markHunters() {
  for (const c of S.combatants) markHunter(c);
}

function markHunter(c) {
  c.huntMarkId = null;
  if (c.isKO || !c.sourceChar.passif?.some(p => p.tags?.includes('huntMark'))) return;
  const prey = livingCombatants(1 - c.teamIndex).filter(f => !f.ownerId);
  if (!prey.length) return;
  const mark = prey[Math.floor(random() * prey.length)];
  c.huntMarkId = mark.id;
  addLog(`🎯 ${c.name} marks ${mark.name}: double damage against it, advantage on defense against it.`, 'spell');
}

// Annastasia's Sacrifice Mark: there is always a marked enemy. She marks a random one (never a summon, never `except`)
// at the start of the battle, and again each time the mark is spent.
function markSacrifice(c, except = null) {
  c.sacMarkId = null;
  const prey = livingCombatants(1 - c.teamIndex).filter(f => !f.ownerId && f.id !== except?.id);
  if (!prey.length) return;
  const mark = prey[Math.floor(random() * prey.length)];
  c.sacMarkId = mark.id;
  addLog(`🩸 ${c.name} marks ${mark.name} for sacrifice: its death will call demons.`, 'spell');
}

function markSacrifices() {
  for (const c of S.combatants) if (!c.isKO && c.sourceChar.passif?.some(p => p.tags?.includes('sacrificeMark'))) markSacrifice(c);
}

// The marked enemy fell: a weak one (max HP under 70) calls one Demon for the marker, a strong one calls two
const SACRIFICE_STRONG_HP = 70;
function reapSacrifice(fallen) {
  for (const o of livingCombatants(1 - fallen.teamIndex)) if (o.sacMarkId === fallen.id) springMark(o, fallen, `${fallen.name} was the sacrifice`);
}

// Calls the Demons of the marker's Sacrifice Mark; the mark is spent
function springMark(marker, victim, why) {
  const n = victim.maxHp < SACRIFICE_STRONG_HP ? 1 : 2;
  let made = 0;
  for (let i = 0; i < n; i++) if (spawnSummon(marker, 'Demon')) made++;
  addLog(`🩸 ${why}: ${made} Demon${made === 1 ? '' : 's'} rise${made === 1 ? 's' : ''} beside ${marker.name}.`, 'crit');
  markSacrifice(marker, victim);   // the mark passes to another enemy
}

const markedByYou = c => c.sacMarkId != null && !!getCombatant(c.sacMarkId) && !getCombatant(c.sacMarkId).isKO;

// Annastasia's Taboo: she loses half her current HP (never her last) and the mark is sprung at once, the victim still standing
function castTaboo(caster) {
  const loss = Math.floor(caster.currentHp / 2);
  if (loss > 0) {
    caster.currentHp -= loss;
    addLog(`  ${caster.name} pays ${loss} HP for the Taboo.`, 'hit');
    updateCombatantCardDOM(caster);
  }
  const victim = getCombatant(caster.sacMarkId);
  if (victim) springMark(caster, victim, `The Taboo springs the Sacrifice Mark on ${victim.name}`);
}

// An ally falling feeds the stacking passives of the fighters still standing (Relentless Warrior)
function noteFallen(fallen) {
  dismissOwned(fallen);
  releaseAllChains(fallen);
  feastOnMark(fallen);
  reapSacrifice(fallen);
  if (isSummonUnit(fallen)) return;   // a summon's fall is no ally's death
  for (const o of livingCombatants(fallen.teamIndex)) {
    for (const p of o.sourceChar.passif ?? []) {
      if (!p.maxStacks || !p.condition?.allyKO) continue;
      o.stacks[p.nom] = Math.min(p.maxStacks, (o.stacks[p.nom] ?? 0) + 1);
    }
  }
}

// Divine Beast synergy: a Beast's bonuses switch on while another Beast of its team stands
export function divineSyncActive(c) {
  return !!c.sourceChar.divineSync && !c.isKO
    && S.combatants.some(o => o.id !== c.id && o.teamIndex === c.teamIndex && !o.isKO && o.sourceChar.divineSync);
}

// The synergy effects of c's team that reach c for one kind of roll or tick. 'self' effects are the owner's own;
// 'allies' effects reach the owner's teammates, never the owner.
function divineEffects(c, applyOn) {
  const out = [];
  for (const owner of livingCombatants(c.teamIndex)) {
    if (!divineSyncActive(owner)) continue;
    for (const e of owner.sourceChar.divineSync.effects ?? []) {
      if (!e.applyOn?.includes(applyOn)) continue;
      if (e.target === 'self' ? owner.id === c.id : e.target === 'allies' && owner.id !== c.id) out.push(e);
    }
  }
  return out;
}

// A map water cell that Convert has not frozen or boiled away
const isWaterCell = (x, y) => {
  const k = `${x},${y}`;
  return !!S.currentMap?.water?.has(k) && !S.iceCells?.has(k) && !S.driedCells?.has(k);
};
const isConvert = ab => !!ab.tags?.some(t => t === 'convert_ice' || t === 'convert_steam');
const hasWetStatus = c => c.statusEffects.some(e => e.name === 'wet');
const dropWetStatus = c => { c.statusEffects = c.statusEffects.filter(e => e.name !== 'wet'); };

// Wet: soaked by a water spell (a status that fire or lightning or ice ends), or standing in the map's water
// (a flier above it stays dry). Nothing immune to wet ever is.
export function isWet(c) {
  if ((c.sourceChar.immunities ?? []).some(i => i.toLowerCase() === 'wet')) return false;
  if (hasWetStatus(c)) return true;
  if (!isWaterCell(c.x, c.y)) return false;
  return !c.statusEffects.some(e => e.name.toLowerCase() === 'fly');
}

const WET_SPEED = 0.8;
const WET_LIGHTNING = 1.5;

// Cells a unit may walk in one move (Western Gale adds to its allies; water slows)
export function moveSpeed(c) {
  let speed = c.speed;
  for (const e of divineEffects(c, 'speed')) speed += parseDice(e.dices).total;
  return isWet(c) ? Math.floor(speed * WET_SPEED) : speed;
}

// The status string a damaging move applies to `target`. Water makes ice bite: a 1dN freeze becomes certain,
// and an ice move with no freeze gets a 1d2 chance of one.
const bitesIce = ability => !!ability.tags?.includes('ice') && !!ability.dice && !ability.isHeal;

export function effectFor(ability, target) {
  const base = ability.effect;
  if (!isWet(target) || !bitesIce(ability)) return base;
  const parts = base ? base.split(',').map(p => p.trim()) : [];
  const freeze = parts.findIndex(p => /^(1d\d+\s+)?(gel|freeze)$/i.test(p));
  if (freeze === -1) return [...parts, '1d2 gel'].join(', ');
  parts[freeze] = parts[freeze].replace(/^1d\d+\s+/i, '');
  return parts.join(', ');
}

// Applies what a landed move does to its target; ice spends the soaking it just used
// The hindrance a disv move leaves on a target it reaches: disadvantage for `turns` of the target's turns
// (hindered: every d20; hindered_atk: attack rolls; hindered_def: the next defense roll). A `chance` below 1 is
// rolled, and a bonus hit makes it certain, like any 1d2 rider.
const HINDRANCE_NAMES = ['hindered', 'hindered_atk', 'hindered_def'];

function inflict(ability, target, guaranteed) {
  const { status, turns, chance = 1 } = ability.inflicts;
  if (target.isKO) return;
  if (target.statusEffects.some(e => e.name === 'ward')) {
    addLog(`🌙 ${target.name} is warded against ${ability.name}'s hindrance!`, 'info');
    return;
  }
  if (!guaranteed && chance < 1 && random() >= chance) {
    addLog(`${target.name} shrugs off the hindrance. (${ability.name})`, 'info');
    return;
  }
  // statuses tick when their owner's turn starts, so +1 keeps it for the owner's next `turns` turns
  if (pushStatus(target, { name: status, turnsLeft: turns + 1 })) {
    addLog(`  ⬇ ${target.name} rolls with disadvantage${status === 'hindered_def' ? ' on the next defense roll' : status === 'hindered_atk' ? ' on attacks' : ''}!`, 'status');
  }
}

// A lingering area works once per round on each unit of the side it is meant for standing in it (a field of
// foes hurts the caster's enemies, a field of allies helps the caster's team), from the cast until it fades
export function inField(f, c) {
  return chebyshev(c, { x: f.x, y: f.y }) <= f.radius;
}

export const fieldTouches = (f, c) => (c.teamIndex === f.teamIndex) === (f.kind === 'allies');

function exposeToField(f, c) {
  if (c.isKO || f.exposed[c.id] === S.roundNumber) return;
  f.exposed[c.id] = S.roundNumber;
  if (f.kind === 'allies') {
    addLog(`  🌸 ${c.name} stands in the ${f.name}.`, 'heal');
    if (f.cleanse) applyCleanse(c);
    if (f.heal) applyHeal(c, f.heal, f.name);
    return;
  }
  addLog(`  🌫 ${c.name} is caught in the ${f.name}.`, 'status');
  applyStatus(c, f.effect);
  if (f.ability.inflicts) inflict(f.ability, c, false);
}

function raiseField(caster, ability, center) {
  const f = {
    name: ability.name, kind: ability.field.affects === 'allies' ? 'allies' : 'foes', ability, casterId: caster.id, teamIndex: caster.teamIndex,
    x: center.x, y: center.y, radius: ability.radius > 0 ? ability.radius : 1,
    roundsLeft: ability.field.turns, effect: ability.field.effect, cleanse: !!ability.field.cleanse, heal: ability.field.heal ?? null, exposed: {},
  };
  // Casting a field again moves it: the caster keeps one of each
  S.fields = S.fields.filter(old => !(old.name === f.name && old.casterId === caster.id));
  S.fields.push(f);
  addLog(`🌫 ${caster.name} spreads the ${f.name} around (${f.x}, ${f.y}) for ${f.roundsLeft} rounds.`, 'spell');
  for (const u of S.combatants) if (fieldTouches(f, u) && inField(f, u)) exposeToField(f, u);
}

// A new round: every field has one round less in it
function tickFields() {
  for (const f of S.fields) f.roundsLeft--;
  for (const f of S.fields.filter(x => x.roundsLeft <= 0)) addLog(`🌫 The ${f.name} fades.`, 'info');
  S.fields = S.fields.filter(f => f.roundsLeft > 0);
}

// A bonus hit (`guaranteed`) makes the 1d2 riders certain
export function applyMoveEffect(ability, target, guaranteed = false) {
  const soaked = hasWetStatus(target);
  const effect = effectFor(ability, target);
  applyStatus(target, guaranteed && effect ? effect.replace(/(^|,\s*)1d2\s+/gi, '$1') : effect, ability.statusTurns != null ? ability.statusTurns + 1 : undefined);
  if (ability.inflicts) inflict(ability, target, guaranteed);
  if (soaked && bitesIce(ability) && !target.isKO) dropWetStatus(target);
}

// Does a passive of `owner` grant advantage on this kind of roll? (tag "adv" on the passive; a weapon condition
// looks at the move, anything else needs the opponent, so an area roll made against nobody in particular skips it)
function passiveAdvantage(owner, applyOn, other, ability) {
  if (applyOn === 'defRoll' && other && owner.huntMarkId === other.id) return true;   // the hunter defends with advantage against its mark
  const formPassives = owner.isTransformed ? owner.sourceChar.transformation?.passif ?? [] : [];   // a form's own passives (Jay's Dragon Reflexes)
  return [...(owner.sourceChar.passif ?? []), ...formPassives].some(p => {
    if (!p.tags?.includes('adv') || !p.applyOn?.includes(applyOn) || passiveLost(owner, p)) return false;
    const needsFoe = p.condition && Object.keys(p.condition).some(k => k !== 'weaponType');
    return (!needsFoe || !!other) && passiveConditionMet(p, owner, other, ability);
  });
}

// Hela's Death Presence: a living fighter with the passive makes every foe's first attack of the fight clumsy
const dreadsFirstAttack = c => livingCombatants(1 - c.teamIndex).some(h => h.sourceChar.passif?.some(p => p.tags?.includes('firstAttackDisadvantage')));

// White's Sword of Space: his attacks have no range limit, and walls only matter beyond this distance
const SPACE_SIGHT = 10;
const attacksFromAnywhere = c => !!c.sourceChar.passif?.some(p => p.tags?.includes('anyRange'));

// The dice that add to one of `owner`'s rolls: passives (a stacking one counts once per stack) and synergy effects
function rollBonuses(owner, applyOn, other, ability) {
  const out = [];
  for (const p of owner.sourceChar.passif ?? []) {
    if (!p.applyOn?.includes(applyOn) || !p.dices || passiveLost(owner, p)) continue;
    if (p.maxStacks && p.condition?.allyKO) {
      for (let i = owner.stacks[p.nom] ?? 0; i > 0; i--) out.push({ nom: p.nom, dices: p.dices });
    } else if (passiveConditionMet(p, owner, other, ability)) {
      out.push({ nom: p.nom, dices: p.dices });
    }
  }
  for (const e of divineEffects(owner, applyOn)) if (e.dices) out.push({ nom: e.nom, dices: e.dices });
  if (applyOn === 'atkRoll' && owner.statusEffects.some(e => e.name === 'orders')) out.push({ nom: 'Orders', dices: '+2' });
  return out;
}

// ── Status helpers ─────────────────────────────────────────────────────────

// Push a custom status (advantage, taunted, puppeteered...) while honouring immunities. Statuses tick when
// their owner's turn starts, so turnsLeft = N + 1 lasts through N of the owner's turns.
function pushStatus(c, eff, beneficial = false) {
  if (c.isKO) return false;
  const immune = (c.sourceChar.immunities ?? []).map(i => i.toLowerCase());
  if (!beneficial && (immune.includes('status') || immune.includes(eff.name))) {
    addLog(`🛡 ${c.name} is immune to ${eff.name}!`, 'info');
    return false;
  }
  const existing = c.statusEffects.find(e => e.name === eff.name);
  if (existing) Object.assign(existing, eff, { turnsLeft: Math.max(existing.turnsLeft, eff.turnsLeft) });
  else c.statusEffects.push({ dice: null, damType: null, notes: '', ...eff });
  updateCombatantCardDOM(c);
  return true;
}

// A d20 for one of the combatant's own attack or defense rolls. Advantage and disadvantage cancel out;
// Gravity's one-shot statuses are spent by the roll, Smoke Screen's disadvantage lasts.
function rollD20For(c, baseAdv = false, baseDis = false, role = null) {
  const roll = rollD20Raw(c, baseAdv, baseDis, role);
  // Djinn's Luck: a 1 is rolled again, once per turn
  if (roll.isNat1 && !c.luckSpent && c.sourceChar.passif?.some(p => p.tags?.includes('rerollOne') && !passiveLost(c, p))) {
    c.luckSpent = true;
    const again = rollD20();
    addLog(`  🍀 ${c.name}'s Djinn's Luck rerolls the 1 — now ${again.value}.`, 'spell');
    return again;
  }
  return roll;
}

function rollD20Raw(c, baseAdv, baseDis, role) {
  const advEff = c.statusEffects.find(e => e.name === 'advantage');
  const disEff = c.statusEffects.find(e => e.name === 'disadvantage');
  const adv = baseAdv || !!advEff;
  // Hindrances from disv moves: every roll, attack rolls only, or the next defense roll only
  const nextDef = role === 'def' ? c.statusEffects.find(e => e.name === 'hindered_def') : null;
  const dis = baseDis || !!disEff || !!nextDef
    || c.statusEffects.some(e => e.name === 'smoke_screen' || e.name === 'hindered' || (role === 'atk' && e.name === 'hindered_atk'));
  for (const e of [advEff, disEff]) {
    if (e && --e.uses <= 0) c.statusEffects = c.statusEffects.filter(x => x !== e);
  }
  if (nextDef) c.statusEffects = c.statusEffects.filter(x => x !== nextDef);
  const r1 = rollD20();
  if (adv === dis) return r1;
  const r2   = rollD20();
  const keep = adv ? (r1.value >= r2.value ? r1 : r2) : (r1.value <= r2.value ? r1 : r2);
  addLog(`  🎲 ${adv ? 'Advantage' : 'Disadvantage'} (${c.name}): rolled ${r1.value} & ${r2.value}, kept ${keep.value}`, adv ? 'spell' : 'miss');
  return keep;
}

// Team spells (Greater Levitation, Greater Invisibility, Mana Wall): the caster's allies within the radius share the
// boon (no map: the whole team). The caster's own share comes from the ordinary self-cast path, except invisibility.
function teamBoon(caster, ability, shieldHp = null) {
  const radius = ability.radius || 1;
  const members = livingCombatants(caster.teamIndex).filter(a => !S.currentMap || chebyshev(caster, a) <= radius);
  const shield = shieldHp ?? (ability.isBlock && ability.dice ? Math.max(0, parseDice(ability.dice).total) : 0);
  for (const a of members) {
    if (ability.tags?.includes('invisible') && pushStatus(a, { name: 'invisible', turnsLeft: (ability.duration > 0 ? ability.duration : 3) + 1 }, true)) {
      addLog(`👻 ${a.name} vanishes from sight — foes attack at disadvantage.`, 'spell');
    }
    if (a.id === caster.id) continue;
    if (ability.tags?.includes('fly') && !a.statusEffects.some(e => e.name.toLowerCase() === 'fly')) {
      a.statusEffects.push({ name: 'fly', turnsLeft: ability.duration > 0 ? ability.duration : 999, dice: null, damType: null, notes: '' });
      addLog(`🦅 ${a.name} is now flying!`, 'spell');
    }
    if (shield > 0) {
      grantDamageShield(a, shield, ability.source);
      addLog(`🛡 ${a.name} gains a ${shield} HP damage shield!`, 'spell');
    }
    updateCombatantCardDOM(a);
  }
}

// Dispel Magic: the target loses every boon that can be unravelled
function dispelTarget(caster, target) {
  const gone = target.statusEffects.filter(e => DISPELLABLE.includes(e.name.toLowerCase()));
  target.statusEffects = target.statusEffects.filter(e => !gone.includes(e));
  addLog(gone.length ? `✨ ${caster.name} dispels ${target.name}: ${gone.map(e => statusLabel(e.name)).join(', ')} unravel.` : `✨ ${caster.name}'s dispel finds nothing on ${target.name}.`, 'spell');
  updateCombatantCardDOM(target);
}
const statusLabel = name => name.replace(/_/g, ' ');

// Smoke Screen: everyone near the user except the user fights at disadvantage
function raiseSmoke(caster, ability) {
  const radius = ability.radius || 1;
  const caught = S.combatants.filter(x => !x.isKO && x.id !== caster.id && (!S.currentMap || chebyshev(caster, x) <= radius));
  addLog(`🌫 ${caster.name} fills the area with smoke!`, 'spell');
  const turns = (ability.duration > 0 ? ability.duration : 3) + 1;
  for (const x of caught) {
    if (pushStatus(x, { name: 'smoke_screen', turnsLeft: turns })) addLog(`  🌫 ${x.name} fights blind — disadvantage on attack and defense rolls.`, 'status');
  }
}

// Self Destruct: everyone within the radius takes remaining HP × the move's dice, then the caster falls
function selfDestruct(caster, ability) {
  const hp = caster.currentHp;
  const r  = parseDice(ability.dice);
  const dmg = hp * r.total;
  addLog(`💥 ${caster.name} self-destructs! ${hp} HP × ${r.breakdown} = ${dmg}`, 'crit');
  const radius = ability.radius || 1;
  const caught = S.combatants.filter(x => !x.isKO && x.id !== caster.id && (!S.currentMap || chebyshev(caster, x) <= radius));
  for (const x of caught) {
    applyDamage(x, dmg, damTypeFromTags(ability.tags), ability.tags);
    applyMoveEffect(ability, x);
  }
  caster.currentHp = 0;
  caster.isKO = true;
  noteFallen(caster);
  caster.statusEffects = [];
  addLog(`💀 ${caster.name} is KO!`, 'death');
  if (caster.domainActive) suppressDomain(caster);
  updateCombatantCardDOM(caster);
}

const grounds = ab => !!ab.tags?.includes('grounded') && random() < (ab.groundChance ?? 1);

// Sacrifice: a landed hit on a target under 10% of its HP (never less than 10 HP) kills outright (no resurrection), and feeds the caster
export const executeThreshold = target => Math.max(10, target.maxHp * 0.1);
export function executeStrike(caster, target, ability) {
  if (target.isKO) return;
  if (target.currentHp >= executeThreshold(target)) {
    addLog(`${ability.name} lands, but ${target.name} (${target.currentHp}/${target.maxHp}) is too healthy to be executed.`, 'info');
    return;
  }
  target.currentHp = 0;
  target.isKO = true;
  noteFallen(target);
  target.statusEffects = [];
  addLog(`💀 ${target.name} is executed by ${ability.name} — not even resurrection can save them!`, 'death');
  if (target.domainActive) suppressDomain(target);
  updateCombatantCardDOM(target);
  if (caster.spellSlots < caster.maxSpellSlots) {
    caster.spellSlots++;
    addLog(`  ✦ ${caster.name} recovers 1 spell slot. (${caster.spellSlots}/${caster.maxSpellSlots})`, 'heal');
  }
  applyHeal(caster, '50');
}

// The Authority behind one blow: the wielder's own or the relic's, whichever is higher, less any domain debuff
const authorityOf = (c, ability) => Math.max(c.sourceChar.autority ?? 0, ability?.authority ?? 0) + (c.authorityDebuff ?? 0);

// The Authority of the blow being resolved; applyDamage and applyStatus read it to see whether Anti-Magic holds
let strikeAuthority = 0;
let strikeSource = null;

// Hela's Anti-Magic: the immunity to magic and status only holds against Authority below the gate
const authorityGate = c => Math.max(0, ...(c.sourceChar.passif ?? []).filter(p => p.authorityGate && !passiveLost(c, p)).map(p => p.authorityGate));
const piercesGate = c => { const g = authorityGate(c); return g > 0 && strikeAuthority >= g; };

// Perfect Reflection: the spell goes back to its caster (doubled, unless `reflect_plain`); high Authority pierces it.
// Returns false when the reflection fails and the spell goes through.
function reflectSpell(reactor, reflectAb, action) {
  const attacker = getCombatant(action.attackerId ?? action.casterId);
  const spell    = action.ability;
  if (!attacker) return false;
  const authority = authorityOf(attacker, spell);
  if (reflectAb.bypassAuthority && authority >= reflectAb.bypassAuthority) {
    addLog(`🪞 ${attacker.name}'s authority (${authority}) pierces ${reflectAb.name}!`, 'crit');
    return false;
  }
  const rolled = action.result?.damage > 0 ? action.result.damage : parseDice(spell?.dice).total;
  const plain  = reflectAb.tags?.includes('reflect_plain');   // Hela's Perfect Reflection sends the spell back as it was cast
  const damage = plain ? rolled : rolled * 2;
  addLog(`🪞 ${reactor.name} sends ${spell?.name ?? 'the spell'} back! ${attacker.name} takes ${damage}${plain ? '' : ` (${rolled} ×2)`}!`, 'crit');
  if (damage > 0) applyDamage(attacker, damage, damTypeFromTags(spell?.tags ?? []), spell?.tags ?? []);
  return true;
}

// Greater Teleportation: allies within the radius follow the caster to the destination, landing on the
// nearest free cell in sight of the caster (up to GROUP_TELEPORT_REACH cells away, so tight spots still fit everyone)
const GROUP_TELEPORT_REACH = 3;
function relocateAllies(leader, origin, radius) {
  const moved = [];
  for (const a of allies(leader)) {
    if (a.id === leader.id || chebyshev(a, origin) > radius) continue;
    // Walking out of an enemy domain is not allowed, teleporting out of it neither
    const cell = freeCellNear(leader, a, GROUP_TELEPORT_REACH, a.id, (x, y) => !trappingDomainOwner(a, x, y));
    if (!cell) { addLog(`  ${a.name} finds no room at the destination.`, 'info'); continue; }
    addLog(`  ✦ ${a.name} follows to (${cell.x}, ${cell.y}).`, 'spell');
    a.x = cell.x; a.y = cell.y;
    moved.push(a.id);
  }
  return moved;
}

// Destiny Gamble: a d6. 1 costs 10 HP; 2-5 puts 2d8 on the next attack; 6 makes the next attack a sure natural 20.
function destinyGamble(caster) {
  const face = rollDie(6);
  addLog(`🎲 ${caster.name} gambles with destiny and rolls a ${face}.`, 'spell');
  if (face === 1) {
    addLog(`  💀 Fate turns on ${caster.name}: 10 damage!`, 'miss');
    applyDamage(caster, 10, damTypeFromTags([]), [], true);
  } else if (face <= 5) {
    pushStatus(caster, { name: 'gamble_bonus', turnsLeft: 2, dice: '2d8' }, true);
    addLog(`  ✨ Fortune smiles: +2d8 on the next attack.`, 'spell');
  } else {
    pushStatus(caster, { name: 'destiny_crit', turnsLeft: 2 }, true);
    addLog(`  🌟 Destiny itself: the next attack cannot miss, and it will be a critical.`, 'spell');
  }
}

// The dice a status banks for the next attack (Runik Precast, Destiny Gamble): spent by it
function spendNextBonus(c) {
  const st = c.statusEffects.find(e => (e.name === 'runik_precast' || e.name === 'gamble_bonus') && e.dice);
  if (!st) return null;
  c.statusEffects = c.statusEffects.filter(e => e !== st);
  return { dice: st.dice, label: st.name === 'gamble_bonus' ? 'DestinyGamble' : 'RuniquePrecast' };
}

// The bonuses a spell adds on top of its dice (Archmage, Great Staff, Runik Mage: passives on magicRoll)
function spellRollBonus(caster, target, ability, diceMult = 1) {
  if (!isSpellMove(ability)) return null;
  let total = 0;
  const parts = [];
  for (const b of rollBonuses(caster, 'magicRoll', target, ability)) {
    const pr = parseDice(b.dices, { diceMult });
    total += pr.total;
    parts.push(`${b.nom}[${pr.breakdown}]`);
  }
  return parts.length ? { total, label: parts.join(' ') } : null;
}

// Great Staff: a natural 1 on a spell roll is turned into a plain 2, a few times per fight
function steadyStaff(c, roll) {
  const p = (c.sourceChar.passif ?? []).find(q => q.tags?.includes('noFumble') && !passiveLost(c, q));
  const used = p ? (c.stacks[p.nom] ?? 0) : 0;
  if (!p || used >= p.uses) return roll;
  c.stacks[p.nom] = used + 1;
  addLog(`  🪄 ${c.name}'s ${p.nom} steadies the spell — the natural 1 becomes a 2. (${used + 1}/${p.uses})`, 'spell');
  return { value: 2, isNat20: false, isNat1: false };
}

// The attacker's d20 for one move. Advantage / sure-hit come from the owner's domain or the move's own tags.
function rollAttackD20(attacker, ability, defender = null) {
  const domainAtkEffs = getDomainEffects(attacker, { applyOn: 'atkRoll', ability });
  const adv     = domainAtkEffs.some(e => e.tags?.includes('adv'))         || !!ability?.tags?.includes('adv')
               || passiveAdvantage(attacker, 'atkRoll', defender, ability)
               || (isSpellMove(ability) && passiveAdvantage(attacker, 'magicRoll', defender, ability));
  // Hunter Instinct: the next attack lands, and arming it is spent by the swing
  const armed = attacker.statusEffects.find(e => e.name === 'sure_hit');
  if (armed) {
    attacker.statusEffects = attacker.statusEffects.filter(e => e !== armed);
    addLog(`🎯 ${attacker.name}'s Hunter Instinct guides the blow!`, 'spell');
  }
  const sureHit = !!armed || domainAtkEffs.some(e => e.tags?.includes('undodgeable')) || !!ability?.tags?.includes('undodgeable');

  const dread = !attacker.attacked && dreadsFirstAttack(attacker);
  attacker.attacked = true;
  if (dread) addLog(`💀 Death Presence — ${attacker.name}'s first attack is made at disadvantage.`, 'info');

  // Destiny Gamble's 6: the blow is a sure natural 20
  const fate = attacker.statusEffects.find(e => e.name === 'destiny_crit');
  if (fate) {
    attacker.statusEffects = attacker.statusEffects.filter(e => e !== fate);
    addLog(`🌟 ${attacker.name}'s destiny strikes true!`, 'spell');
    return { roll: { value: 20, isNat20: true, isNat1: false }, sureHit: true };
  }
  // A hidden target is hard to hit
  const hidden = !!defender?.statusEffects.some(e => e.name === 'invisible');
  if (hidden) addLog(`👻 ${defender.name} cannot be seen — ${attacker.name} attacks at disadvantage.`, 'info');
  const roll = rollD20For(attacker, adv, dread || hidden, 'atk');
  return { roll: roll.isNat1 && isSpellMove(ability) ? steadyStaff(attacker, roll) : roll, sureHit };
}

// A blow from more than an arm's length away, or one the move itself calls ranged
const isRangedAttack = (attacker, defender, ability) =>
  !(chebyshev(attacker, defender) <= MELEE_RANGE && !ability?.tags?.includes('ranged'));

// Timed buffs a move puts on its user (Stone Skin, Wind's Whim); a fresh cast refreshes the old one
function grantTimed(c, ab) {
  const g = ab.grants;
  c.statusEffects = c.statusEffects.filter(e => e.name !== g.status);
  // statuses tick when their owner's turn starts, so +1 keeps it for the owner's next `turns` turns
  c.statusEffects.push({ name: g.status, turnsLeft: g.turns + 1, amount: g.amount, label: g.label, dice: null, damType: null, notes: '' });
  addLog(`🛡 ${c.name} calls on ${g.label} for ${g.turns} turns.`, 'spell');
  updateCombatantCardDOM(c);
}

// Wind's Whim raised in answer to a blow that was already rolled: re-judge an ordinary hit against the new total
function strengthenDefense(action, defender) {
  const r = action.result;
  if (!r || r.atkRoll === '—' || !r.hit || !r.ordinary) return;
  const attacker = getCombatant(action.attackerId ?? action.casterId);
  if (!attacker) return;
  const bonus = defenseBonus(defender, attacker, action.ability) - (r.effectiveDefRoll - r.defRoll);
  if (bonus <= 0) return;
  r.effectiveDefRoll += bonus;
  if (r.atkRoll < r.effectiveDefRoll) {
    r.hit = false; r.damage = 0; r.breakdown = '—';
    addLog(`  🌬 ${defender.name}'s Wind's Whim lifts the defense to ${r.effectiveDefRoll} — the blow misses!`, 'spell');
  }
}

export function defenseBonus(defender, attacker, ability) {
  const guard = defender.statusEffects.find(e => e.name === 'ranged_guard');
  const windBonus = guard && isRangedAttack(attacker, defender, ability) ? guard.amount : 0;
  if (ability?.tags?.includes('arPen')) return windBonus;   // armour piercing: defense-roll passives (armour) do not count
  let bonus = windBonus;
  for (const b of rollBonuses(defender, 'defRoll', attacker, ability)) bonus += parseDice(b.dices).total;
  return bonus;
}

const hasInitiativeBonus = c => (c.sourceChar.passif ?? []).some(p => p.applyOn?.includes('initRoll'));

// Area moves (aoe / cone / splash): the caster rolls once, every victim rolls its own defense against it.
//   defense fails (or the caster rolled a natural 20 / the move is a sure-hit) → full damage
//   defense wins                                                              → half damage
//   defense wins by more than 5, or the victim has an initiative bonus        → no damage at all
// Returns the damage multiplier (1, 0.5 or 0).
const AREA_FULL_DODGE_MARGIN = 5;

// Shadow void: Black Hole stores the move it swallows, Shadow Gate spits one back out at a random target.
const GATE_CONE_RADIUS = 2;   // a gated cone has no origin, so it lands as a small burst around the target

function absorbIntoVoid(reactor, action) {
  const source = getCombatant(action.attackerId ?? action.casterId);
  let ability = action.ability;
  if (!ability && source) {
    const atk = source.transformedBaseAtk ?? source.sourceChar.baseAtk;
    if (atk) ability = resolveAbilitiesFromList([{ category: 'technique', base: { nom: atk.nom, dices: atk.dices, tags: atk.tags }, target: 'mono' }])[0];
  }
  if (!ability) return;
  reactor.shadowVoid.push({ ability, from: source?.name ?? 'Unknown' });
  addLog(`🌑 ${source?.name ?? 'The attacker'}'s ${ability.name} is swallowed by the shadow void! (${reactor.shadowVoid.length} stored)`, 'spell');
}

// The stored move as Shadow Gate launches it: free, and without the movement that belonged to its original caster
function gateAbility(stored) {
  const ab = stored.ability;
  return {
    ...ab,
    cost: null, cooldownTurns: 0, isOncePerFight: false, maxCharges: 0, isInstant: false,
    tags: ab.tags.filter(t => t !== 'dash' && t !== 'pull'),
  };
}
// What one victim's defense does to an area blow: { mult, diceMult, freeAction, mutual }. The d20 matrix of a
// single blow applies to the caster's one roll and each victim's own: a natural 20 or 1 on either side adds dice
// (x2, x4 against a natural 1), a natural 1 attack turns away unless the victim fumbles too (half on both), and a
// natural 20 defense turns an ordinary roll away, both leaving the victim a free action.
const NO_CLASH = { mult: 1, diceMult: 1, freeAction: false, mutual: false };

function areaDefense(atk, target, caster, ability) {
  if (atk.sureHit) return NO_CLASH;
  const defD20  = rollD20For(target, passiveAdvantage(target, 'defRoll', caster, ability), false, 'def');
  const defRoll = defD20.value;
  const bonus   = defenseBonus(target, caster, ability);
  const def     = defRoll + bonus;
  const defStr  = bonus ? `${defRoll}+${bonus}=${def}` : String(defRoll);
  const vs      = `${defStr} vs ${atk.roll.value}`;

  if (atk.roll.isNat1) {
    if (defD20.isNat1) {
      addLog(`  💥 ${target.name} fumbles too (${vs}) — the blow lands for half on each.`, 'crit');
      return { ...NO_CLASH, mult: 0.5, mutual: true };
    }
    addLog(`  💥 ${caster.name}'s fumble leaves ${target.name} untouched and with a free action (${vs})`, 'miss');
    return { ...NO_CLASH, mult: 0, freeAction: true };
  }
  if (atk.roll.isNat20) {
    const diceMult = defD20.isNat20 ? 1 : defD20.isNat1 ? 4 : 2;
    addLog(`  🎲 ${target.name} fails to defend (${vs})${diceMult > 1 ? ` — the blow is critical, dice ×${diceMult}` : ''}`, 'hit');
    return { ...NO_CLASH, diceMult };
  }
  if (defD20.isNat1) {
    addLog(`  🎲 ${target.name} stumbles (${vs}) — the blow is critical, dice ×2`, 'hit');
    return { ...NO_CLASH, diceMult: 2 };
  }
  if (defD20.isNat20) {
    addLog(`  💨 ${target.name} rolls a natural 20 and slips away (${vs}) — and earns a free action`, 'miss');
    return { ...NO_CLASH, mult: 0, freeAction: true };
  }
  if (def <= atk.roll.value) {
    addLog(`  🎲 ${target.name} fails to defend (${vs})`, 'hit');
    return NO_CLASH;
  }
  if (def - atk.roll.value > AREA_FULL_DODGE_MARGIN || hasInitiativeBonus(target)) {
    addLog(`  💨 ${target.name} evades completely! (${vs})`, 'miss');
    return { ...NO_CLASH, mult: 0 };
  }
  addLog(`  🛡 ${target.name} partly defends — half damage (${vs})`, 'info');
  return { ...NO_CLASH, mult: 0.5 };
}

// How the attacker's d20 and the defender's d20 settle one blow. A natural 20 or 1 on either side changes
// more than the comparison: the roll that lands a bonus hit rolls extra dice and makes the 1d2 riders certain,
// and a natural 1 or a natural 20 defense that turns the blow away gives the defender a free action.
//   atk 1  / def 1       both fumble: the blow is rolled, each side takes half
//   atk 1  / def other   the attack fails, the defender earns a free action
//   atk 20 / def 20      a plain hit
//   atk 20 / def 1       a hit with the dice rolled four times
//   atk 20 / def other   a hit with the dice doubled
//   atk other / def 1    a hit with the dice doubled
//   atk other / def 20   a miss, the defender earns a free action
//   otherwise            the totals compare, the attacker wins a tie
function clash(atk, def, effectiveDefRoll) {
  const plain = { hit: false, mutual: false, bonusMult: 1, freeAction: false };
  if (atk.isNat1) return def.isNat1 ? { ...plain, hit: true, mutual: true } : { ...plain, freeAction: true };
  if (atk.isNat20) return { ...plain, hit: true, bonusMult: def.isNat20 ? 1 : def.isNat1 ? 4 : 2 };
  if (def.isNat1)  return { ...plain, hit: true, bonusMult: 2 };
  if (def.isNat20) return { ...plain, freeAction: true };
  return { ...plain, hit: atk.value >= effectiveDefRoll };
}

export function resolveAttack(attacker, defender, diceExpr, ability = null) {
  const { roll: atkRoll, sureHit: domainSureHit } = rollAttackD20(attacker, ability, defender);

  const defRoll = rollD20For(defender, passiveAdvantage(defender, 'defRoll', attacker, ability), false, 'def');
  const effectiveDefRoll = defRoll.value + defenseBonus(defender, attacker, ability);

  const domainForcesHit = domainSureHit && !atkRoll.isNat1;
  if (domainForcesHit) addLog(`  🎯 Sure-Hit — attack cannot be dodged!`, 'spell');

  const outcome = clash(atkRoll, defRoll, effectiveDefRoll);
  const hit = outcome.hit || domainForcesHit;
  const { mutual, bonusMult } = outcome;
  const freeAction = outcome.freeAction && !hit;
  // Decided by the totals alone: no natural 1 or 20 on either side and no sure-hit (a later bonus can still turn it)
  const ordinary = !atkRoll.isNat1 && !atkRoll.isNat20 && !defRoll.isNat1 && !defRoll.isNat20 && !domainForcesHit;
  const crit   = atkRoll.isNat20;
  const fumble = atkRoll.isNat1;

  let damage = 0, recoil = 0, breakdown = '—';

  if (hit) {
    const pd = expr => parseDice(expr, { diceMult: bonusMult });
    const raw = diceExpr || (attacker.transformedBaseAtk?.dices ?? attacker.sourceChar.baseAtk?.dices) || '1d4';
    const rolled = parseDice(raw, { missingHp: defender.maxHp - defender.currentHp, diceMult: bonusMult });

    let passiveBonus = 0;
    const passiveParts = [];
    for (const b of rollBonuses(attacker, 'atkRoll', defender, ability)) {
      const pr = pd(b.dices);
      passiveBonus += pr.total;
      passiveParts.push(`${b.nom}[${pr.breakdown}]`);
    }

    const versus = bonusVsFor(ability, defender, bonusMult);
    if (versus) {
      passiveBonus += versus.total;
      passiveParts.push(versus.label);
    }

    const arcane = spellRollBonus(attacker, defender, ability, bonusMult);
    if (arcane) {
      passiveBonus += arcane.total;
      passiveParts.push(arcane.label);
    }

    const frStatus = attacker.statusEffects.find(e => e.name === 'final_reckoning');
    if (frStatus?.dice) {
      const fr = pd(frStatus.dice);
      passiveBonus += fr.total;
      passiveParts.push(`FinalReckoning[${fr.breakdown}]`);
    }

    const banked = spendNextBonus(attacker);
    if (banked) {
      const pr = pd(banked.dice);
      passiveBonus += pr.total;
      passiveParts.push(`${banked.label}[${pr.breakdown}]`);
    }

    if (attacker.shadowCounterBonus > 0) {
      passiveBonus += attacker.shadowCounterBonus;
      passiveParts.push(`ShadowCounter[+${attacker.shadowCounterBonus}]`);
      attacker.shadowCounterBonus = 0;
    }

    damage = rolled.total + passiveBonus;
    const marked = attacker.huntMarkId != null && attacker.huntMarkId === defender.id;
    if (marked) damage *= 2;   // the hunter's mark: double damage against its prey
    const steam = !!ability?.steamMode && attacker.prevKind === 'steamMode' && hasPassiveTag(attacker, 'steamGun');
    if (steam) damage = Math.floor(damage / 2);   // two techniques in a row
    if (mutual) damage = Math.floor(damage / 2);
    recoil = mutual ? damage : 0;
    const passiveStr = passiveParts.length ? ` + ${passiveParts.join(' ')}` : '';
    breakdown = `${marked ? 'HUNTED ×2: ' : ''}${steam ? 'STEAMGUN ÷2: ' : ''}${bonusMult > 1 ? `CRIT dice ×${bonusMult}: ` : mutual ? 'HALVED: ' : ''}${rolled.breakdown}${passiveStr} = ${damage}`;
  }

  return {
    hit, crit, fumble, mutual, freeAction, recoil, bonusMult, guaranteed: bonusMult > 1, ordinary,
    damage, atkRoll: atkRoll.value, defRoll: defRoll.value, effectiveDefRoll, breakdown, domainSureHit: domainForcesHit,
  };
}

// A mutual fumble: the attacker is hurt by the same half they dealt
function strikeBack(attacker, result, damType, tags) {
  if (!(result.recoil > 0) || attacker.isKO) return;
  addLog(`  💥 ${attacker.name} takes ${result.recoil} from the botched blow!`, 'miss');
  applyDamage(attacker, result.recoil, damType, tags);
}

export function logAttackResult(atk, def, r) {
  if (r.atkRoll === '—') return;   // effect-only move: there was no attack roll to report
  const defStr = r.effectiveDefRoll !== r.defRoll
    ? `${r.defRoll}+${r.effectiveDefRoll - r.defRoll}=${r.effectiveDefRoll}`
    : String(r.defRoll);
  if (r.mutual) {
    addLog(`💥 BOTH FUMBLE! ${atk.name} and ${def.name} roll 1 — the blow lands for half on each. ${r.breakdown}`, 'crit');
  } else if (r.fumble) {
    addLog(`💥 FUMBLE! ${atk.name} rolls 1 — the attack fails${r.freeAction ? ` and ${def.name} earns a free action!` : '.'}`, 'miss');
  } else if (r.hit && r.bonusMult > 1) {
    const why = r.crit ? `${atk.name} rolls 20 vs ${def.name}'s ${defStr}` : `${def.name} rolls 1 against ${atk.name}'s ${r.atkRoll}`;
    addLog(`⚔ CRITICAL! ${why}. ${r.breakdown}`, 'crit');
  } else if (r.hit) {
    const cmp = r.domainSureHit && r.atkRoll < r.effectiveDefRoll ? 'sure hit' : `${r.atkRoll} ≥ ${defStr}`;
    addLog(`${atk.name} hits ${def.name}! (${cmp}) ${r.breakdown}`, 'hit');
  } else if (r.freeAction) {
    addLog(`🛡 ${def.name} rolls a natural 20 — ${atk.name} misses and ${def.name} earns a free action!`, 'miss');
  } else {
    addLog(`${atk.name} misses ${def.name}. (${r.atkRoll} < ${defStr})`, 'miss');
  }
}

// Returns the index of the winning team, or null while both teams still stand
// (summons do not hold a team up: once its real fighters are down, the team is beaten)
export function checkVictory() {
  const standing = t => livingCombatants(t).some(c => !isSummonUnit(c));
  if (!standing(0)) return 1;
  if (!standing(1)) return 0;
  return null;
}

const isSpellMove = ab => !!ab && (ab.source === 'spell' || ab.source === 'technoSpell' || !!ab.tags?.includes('magic'));

// A natural 20 that lands cannot be answered: no block, dodge or teleport is offered against it
const unreactable = result => !!(result?.crit && result.hit);
function noReactToCrit(result, atkName) {
  if (!unreactable(result)) return false;
  addLog(`  ⚔ ${atkName}'s natural 20 leaves no time to react!`, 'crit');
  return true;
}

export function getReacts(target, incoming = null) {
  if (hasControlEffect(target)) return [];   // gel, stun, cocoon and fear: it can neither act nor react
  const insideClosedDomain = S.activeDomains.some(d => {
    const owner = getCombatant(d.casterId);
    if (!owner || owner.isKO || owner.teamIndex === target.teamIndex) return false;
    if (d.domain.type === 'Ouvert') return false;
    const domainRadius = d.domain.radius ?? 8;
    return chebyshev(target, { x: d.centerX, y: d.centerY }) <= domainRadius;
  });
  return target.abilities.filter(ab => {
    if (!ab.isReact && !ab.isInstant && !ab.isBlock) return false;
    if (ab.tags?.includes('extraAction')) return false;   // Borrowed Time is spent on the caster's own turn
    if (ab.tags?.includes('noReact')) return false;       // instant (no action used) but only on the caster's own turn: Blink, Hunter Instinct
    if (ab.isTransform) return false;
    // Guardbreak beats every block but not a dodge: teleports, dashes and the like still get away
    if (incoming?.tags?.includes('guardbreak') && ab.isBlock && !ab.tags?.some(t => ['dodge', 'dash', 'teleportation'].includes(t))) return false;
    if (ab.tags?.includes('reflect') && !isSpellMove(incoming)) return false;
    if (ab.tags?.includes('dispel') && !isSpellMove(incoming)) return false;   // Dispel Magic only unravels a spell
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
  if (refuseRepeat(atk, 'attack', 'a basic attack')) return;

  if (tauntViolation(atk, [def])) return;

  if (S.currentMap) {
    const range = targetInRange(atk, def, null);
    if (!range.inRange) {
      addLog(`⚠ ${atk.name} can't reach ${def.name}! (${range.reason})`, 'info');
      return;
    }
  }

  const preShield = def.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
  if (preShield) {
    spendAction(atk, 'attack');
    addLog(`🛡 ${def.name}'s pre-armed shield blocks ${atk.name}'s attack!`, 'spell');
    def.statusEffects = def.statusEffects.filter(e => e !== preShield);
    updateCombatantCardDOM(def);
    endAction(false);
    return;
  }

  spendAction(atk, 'attack');
  const result = resolveAttack(atk, def, null);
  S.pendingAction = { type: 'attack', attackerId, defenderId, result };

  const reacts = noReactToCrit(result, atk.name) ? [] : getReacts(def);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: def.id, ability: ab }));
    R.renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

export function handleCastAbility(casterId, abilityName, targetIds, center = null) {
  const caster  = getCombatant(casterId);
  let ability = caster?.abilities.find(a => a.name === abilityName);
  if (!ability || !abilityAvailable(caster, ability)) return;
  if (ability.allSlots) ability = { ...ability, dice: `${caster.spellSlots}d20+10`, cost: { type: 'slots', amount: caster.spellSlots } };
  if (ability.reactOnly) { addLog(`⚠ ${ability.name} can only be used as a reaction.`, 'info'); return; }
  if (S.hasActed && !ability.isInstant) { addLog('You have already acted this turn!', 'info'); return; }
  if (!ability.isInstant && refuseRepeat(caster, ability.name)) return;

  let targets = targetIds.map(id => getCombatant(id)).filter(t => t && (ability.isRevive || !t.isKO));
  if (ability.tags?.includes('repair') && !targets.every(isMecha)) {
    addLog(`⚠ ${ability.name} only mends machines (allies with the mecha tag).`, 'info');
    return;
  }

  // an ally to mend must be within the move's reach too (self is always in reach)
  const needsRangeCheck = !ability.isAoe && !ability.isCone
    && (ability.targetKind === 'enemy' || (ability.targetKind === 'ally' && !ability.isRevive && targets[0] && targets[0].id !== caster.id));
  if (S.currentMap && needsRangeCheck && targets.length > 0) {
    const range = targetInRange(caster, targets[0], ability);
    if (!range.inRange) {
      addLog(`⚠ ${ability.name} can't reach ${targets[0].name}! (${range.reason})`, 'info');
      return;
    }
  }
  if (ability.targetKind === 'enemy' && targets.length > 0 && tauntViolation(caster, targets)) return;
  if ((isConvert(ability) || ability.field) && !center && !targets[0]) { addLog('Pick a cell first.', 'info'); return; }
  if (!ability.isAoe && !ability.isCone && ability.targetKind !== 'self' && ability.targetKind !== 'ally' && !ability.isSplash && targets.length === 0) {
    addLog(`No valid target selected.`, 'info');
    return;
  }

  // Nothing is spent on a cast that cannot do anything
  if ((ability.isAoe || ability.isCone) && targets.length === 0 && !isConvert(ability) && !ability.field
      && doorsInBlast(caster, ability, center).length === 0) {
    addLog(`⚠ ${ability.name} has no valid target in that area.`, 'info');
    return;
  }
  if (ability.isRevive && !targets.some(t => t.isKO)) {
    addLog(`⚠ ${ability.name} needs a KO'd ally.`, 'info');
    return;
  }
  if (ability.isGate && caster.shadowVoid.length === 0) {
    addLog(`⚠ The shadow void is empty — ${ability.name} has nothing to spit out.`, 'info');
    return;
  }

  spendResource(caster, ability);
  // Cooldowns tick once at the start of the owner's turns, so +1 gives a lockout of exactly N turns
  if (ability.cooldownTurns > 0) caster.cooldowns[ability.name] = ability.cooldownTurns + 1;
  else if (ability.oncePerTurn) caster.cooldowns[ability.name] = 1;   // lifts when its owner's next turn starts
  if (ability.isOncePerFight) caster.usedThisFight.push(ability.name);
  if (ability.maxCharges > 0) {
    if (caster.remainingCharges[ability.name] == null) caster.remainingCharges[ability.name] = ability.maxCharges;
    caster.remainingCharges[ability.name]--;
  }

  if (!ability.isInstant) spendAction(caster, ability.name, ability.steamMode ? 'steamMode' : ability.source);

  addLog(`${caster.name} uses ${ability.name}!`, ability.source === 'spell' ? 'spell' : 'tech');
  if (ability.summon || ability.isDetonate || ability.isTaboo) {
    if (ability.summon) castSummon(caster, ability); else if (ability.isTaboo) castTaboo(caster); else castDetonate(caster, ability);
    concludeAction(!!ability.isInstant);
    return;
  }
  if (ability.tags?.includes('dispel')) {
    dispelTarget(caster, targets[0]);
    concludeAction(!!ability.isInstant);
    return;
  }
  if (ability.tags?.includes('shatter_armor')) losePassive(caster, 'Bone Armor', 2);
  if (ability.field) {
    raiseField(caster, ability, center ?? { x: targets[0].x, y: targets[0].y });
    endAction(ability.isInstant);
    return;
  }
  if (isConvert(ability)) {
    convertArea(caster, ability, center ?? { x: targets[0].x, y: targets[0].y });
    endAction(ability.isInstant);
    return;
  }
  if (ability.tags?.includes('awaken') && pushStatus(caster, { name: 'relic_awake', turnsLeft: 999 }, true)) {
    addLog(`🔥 ${caster.name}'s relic wakes — it no longer drinks fire, and its blade burns.`, 'spell');
  }

  // Shadow Gate: a random stored move is launched in place of the gate itself. The gate opens beside the
  // target, so the stored move's own range does not matter; area moves burst around the target.
  if (ability.isGate) {
    const [stored] = caster.shadowVoid.splice(Math.floor(random() * caster.shadowVoid.length), 1);
    const focus = targets[0];
    ability = gateAbility(stored);
    addLog(`🌑 The gate opens beside ${focus.name} — ${stored.from}'s ${ability.name} comes out of the void! (${caster.shadowVoid.length} left)`, 'spell');
    if (ability.isAoe || ability.isCone) {
      const area = { ...ability, radius: ability.isCone ? GATE_CONE_RADIUS : ability.radius };
      targets   = S.currentMap ? aoeCombatantHits(area, caster, focus.x, focus.y) : enemies(caster);
      targetIds = targets.map(t => t.id);
    }
  }

  // Effects that never prompt a react: friendly buffs, unblockable moves, and moves that deal no damage or status
  const noReacts = ability.targetKind === 'ally' || !!ability.tags?.some(t => t === 'unblockabled' || t === 'taunt');
  const hasMechanics = ability.summon || ability.isTaboo || ability.isDetonate || ability.dice || ability.effect || ability.precastDice || ability.slotRegen > 0 || ability.isRevive
    || ability.isBlock || ability.targetKind === 'self' || ability.field
    || ability.isContest || ability.tags?.some(t => ['dash', 'fly', 'teleportation', 'cleans', 'pull', 'taunt', 'smoke', 'adv_next', 'orders', 'ward', 'dry'].includes(t));
  if (!hasMechanics) addLog(`  ⚠ ${ability.name} has no mechanical effect in the simulator yet.`, 'info');

  // Dash: close the distance to the target before the move resolves
  if (ability.tags?.includes('dash') && ability.targetKind === 'enemy' && targets[0]) dashToward(caster, targets[0]);
  if (ability.tags?.includes('opportunity') && targets[0]) opportunityAttack(caster, targets[0]);

  if (ability.isAoe) {
    S.pendingAction = { type: 'aoe', casterId, abilityName, targetIds, ability, center, reactorId: null, reactedIds: [], blockedIds: [], halvedIds: [], noReacts };
    const firstReactor = noReacts ? null : targets.find(t => getReacts(t, ability).length > 0);
    if (firstReactor) {
      S.pendingAction.reactorId = firstReactor.id;
      S.pendingAction.reactedIds.push(firstReactor.id);
      S.awaitingReact = true;
      S.reactOptions  = getReacts(firstReactor, ability).map(ab => ({ combatantId: firstReactor.id, ability: ab }));
      R.renderReactOverlay();
      return;
    }
    resumePendingAction(null);
    return;
  }

  if (ability.isCone) {
    S.pendingAction = { type: 'cone', casterId, abilityName, targetIds, ability, center, reactorId: null, reactedIds: [], blockedIds: [], halvedIds: [], noReacts };
    const firstReactor = noReacts ? null : targets.find(t => getReacts(t, ability).length > 0);
    if (firstReactor) {
      S.pendingAction.reactorId = firstReactor.id;
      S.pendingAction.reactedIds.push(firstReactor.id);
      S.awaitingReact = true;
      S.reactOptions  = getReacts(firstReactor, ability).map(ab => ({ combatantId: firstReactor.id, ability: ab }));
      R.renderReactOverlay();
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
    const reacts = noReacts || noReactToCrit(result, caster.name) ? [] : getReacts(target, ability);
    if (reacts.length > 0) {
      S.awaitingReact = true;
      S.reactOptions  = reacts.map(ab => ({ combatantId: target.id, ability: ab }));
      R.renderReactOverlay();
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
      enterTeleportMode(caster, ability.range ?? SPELL_RANGE, ability.tags.includes('group') ? ability : null);
      return;
    }
    if (ability.tags?.includes('teleportation')) addLog(`✦ ${caster.name} teleports — without a map, position does not matter.`, 'spell');
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

  const preShieldSpell = ability.tags?.includes('guardbreak') ? null : target.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
  if (preShieldSpell) {
    addLog(`🛡 ${target.name}'s pre-armed shield blocks ${caster.name}'s ${ability.name}!`, 'spell');
    target.statusEffects = target.statusEffects.filter(e => e !== preShieldSpell);
    updateCombatantCardDOM(target);
    // Instant moves do not use the action: the turn stays open
    endAction(ability.isInstant);
    return;
  }

  const result = (ability.dice || ability.isContest)
    ? resolveAttack(caster, target, ability.dice ?? '0', ability)
    : { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', effectiveDefRoll: '—', breakdown: '—' };

  S.pendingAction = { type: 'ability', casterId, abilityName, targetIds: [target.id], result, ability };

  // A move with no damage and no status has nothing to block, so it never prompts a react
  const reacts = (noReacts || !(ability.dice || ability.effect || ability.isContest) || noReactToCrit(result, caster.name)) ? [] : getReacts(target, ability);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: target.id, ability: ab }));
    R.renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

export function handleTransform(casterId) {
  const c  = getCombatant(casterId);
  const tf = c?.sourceChar.transformation;
  if (!c || !tf || c.isTransformed) return;
  if (S.hasActed) { addLog('You have already acted this turn!', 'info'); return; }
  if (refuseRepeat(c, 'transform', 'a transformation')) return;

  if (c.usedThisFight.includes(tf.base.nom)) {
    addLog(`${c.name} has already transformed this fight!`, 'info'); return;
  }

  // Pay the transformation's listed cost (it used to be shown on the button but never charged)
  const tfAb = c.abilities.find(a => a.isTransform);
  if (tfAb && !abilityAvailable(c, tfAb)) { addLog(`⚠ ${c.name} cannot pay for ${tf.base.nom}.`, 'info'); return; }
  if (tfAb) spendResource(c, tfAb);

  spendAction(c, 'transform');   // before the form's own traits count: Nirvana's second action starts next turn
  c.formRestore = { abilities: c.abilities, speed: c.speed };
  c.isTransformed = true;
  c.usedThisFight.push(tf.base.nom);
  // A form's permanent flight
  if (tf.passif?.some(p => p.tags?.includes('fly')) && !c.statusEffects.some(e => e.name.toLowerCase() === 'fly')) {
    c.statusEffects.push({ name: 'fly', turnsLeft: 999, dice: null, damType: null, notes: '', fromForm: true });
    addLog(`🦅 ${c.name} takes to the air!`, 'spell');
  }
  // A form with a duration ends on its own: `duration` turns of the owner's (statuses tick when the owner's turn starts)
  if (tfAb?.duration > 0) c.statusEffects.push({ name: 'form_timer', turnsLeft: tfAb.duration + 1, dice: null, damType: null, notes: `${tf.base.nom} ends after ${tfAb.duration} turns` });
  if (tf.regainSlots) {
    c.spellSlots = c.maxSpellSlots;
    addLog(`  🔮 ${c.name} regains all spell slots (${c.spellSlots}/${c.maxSpellSlots}).`, 'spell');
  }

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
  endAction(false);   // transforming uses the action, like every other action
}

// The end of a timed form: back to the normal sheet, the form's extra HP and slots gone, its flight too
function revertForm(c) {
  const tf = c.sourceChar.transformation;
  if (!c.isTransformed || !tf) return;
  c.isTransformed = false;
  c.transformedBaseAtk = null;
  if (c.formRestore) { c.abilities = c.formRestore.abilities; c.speed = c.formRestore.speed; c.formRestore = null; }
  if (tf.hp > 0) { c.maxHp -= tf.hp; c.currentHp = Math.max(1, Math.min(c.currentHp, c.maxHp)); }
  if (tf.spellSlot > 0) {
    c.maxSpellSlots = Math.max(0, c.maxSpellSlots - tf.spellSlot);
    c.spellSlots    = Math.min(c.spellSlots, c.maxSpellSlots);
  }
  c.statusEffects = c.statusEffects.filter(e => !e.fromForm);
  addLog(`🔙 ${c.name}'s ${tf.base.nom} ends. ${c.name} is back to normal.`, 'status');
  updateCombatantCardDOM(c);
}

export function suppressDomain(ownerCombatant) {
  ownerCombatant.domainActive = false;
  S.activeDomains = S.activeDomains.filter(d => d.casterId !== ownerCombatant.id);
  for (const c2 of S.combatants.filter(c3 => c3.teamIndex === ownerCombatant.teamIndex)) {
    c2.statusEffects = c2.statusEffects.filter(e => !e.fromDomain);
  }
  updateCombatantCardDOM(ownerCombatant);
}

// One domain per team: a teammate's active domain blocks a new expansion until it ends
export function activeAllyDomain(c) {
  return S.activeDomains.find(d => d.casterId !== c.id && getCombatant(d.casterId)?.teamIndex === c.teamIndex) ?? null;
}

export function handleActivateDomain(casterId) {
  const c      = getCombatant(casterId);
  const domain = c?.sourceChar.domain;
  if (!c || !domain) return;
  if (S.hasActed) { addLog('You have already acted this turn!', 'info'); return; }
  if (refuseRepeat(c, 'domain', 'a domain expansion')) return;
  if (c.domainActive)   { addLog(`${c.name}'s domain is already active!`, 'info'); return; }
  const allyDomain = activeAllyDomain(c);
  if (allyDomain) {
    addLog(`⚠ ${getCombatant(allyDomain.casterId).name}'s ${allyDomain.domain.name} is already active — one domain per team.`, 'info'); return;
  }
  if (c.domainCharges <= 0) { addLog(`⚠ ${c.name} has no more domain charges!`, 'info'); return; }

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
        // Attacker still spends the charge and loses their action — their domain also cancels
        c.domainCharges--;
        spendAction(c, 'domain');
        updateCombatantCardDOM(c);
        endAction(false);
        return;
      } else {
        // A failed expansion burns the charge; the action is kept
        c.domainCharges--;
        addLog(`🌐 ${c.name}'s ${domain.name} is suppressed by ${enemyOwner.name}'s stronger domain! (charge lost)`, 'crit');
        updateCombatantCardDOM(c);
        R.renderCombatScreen();
        return;
      }
    }
  }

  c.domainCharges--;
  c.domainActive = true;
  S.activeDomains.push({ casterId: c.id, domain, centerX: c.x, centerY: c.y });
  spendAction(c, 'domain');

  addLog(`🌐 ${c.name} activates Domain Expansion: ${domain.name}! [${domain.type} · Ref. ${domain.rafinement ?? 'N/A'}]`, 'crit');
  addLog(`  "${domain.description}"`, 'spell');

  for (const eff of domain.effects ?? []) {
    addLog(`  • ${eff.nom}${eff.dices ? ` (${eff.dices})` : ''}`, 'spell');

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
  endAction(false);   // expanding a domain uses the action
}

export function handleReactYes() {
  const selectedName = (headless ? null : document.querySelector('input[name="react"]:checked')?.value)
    ?? S.reactOptions[0]?.ability.name;
  const option       = S.reactOptions.find(o => o.ability.name === selectedName) ?? S.reactOptions[0];
  const reactAbility = option?.ability ?? null;
  if (!headless) document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];

  if (reactAbility?.tags?.includes('teleportation') && S.currentMap) {
    const reactor = getCombatant(option.combatantId);
    if (reactor) {
      // Cost is paid once, in resumePendingAction, when the teleport has been placed
      S.pendingTeleportReact = reactAbility;
      enterTeleportMode(reactor, reactAbility.range ?? SPELL_RANGE, reactAbility.tags.includes('group') ? reactAbility : null);
      return;
    }
  }
  resumePendingAction(reactAbility);
}

export function handleReactNo() {
  if (!headless) document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];
  resumePendingAction(null);
}

// Halves the next physical hit taken. Statuses tick when their owner's turn starts, so 1 turn lasts
// through every enemy action until the owner acts again.
function raiseBladeArmor(c, ability) {
  const existing = c.statusEffects.find(e => e.name === 'living_blade_armor');
  if (existing) existing.turnsLeft = Math.max(existing.turnsLeft, 1);
  else c.statusEffects.push({ name: 'living_blade_armor', turnsLeft: 1, dice: null, damType: null, notes: '' });
  addLog(`⚔ ${c.name} raises ${ability.name} — halves next physical hit!`, 'spell');
  updateCombatantCardDOM(c);
}

// One absorb shield per combatant: a new cast refreshes it to the larger value instead of stacking forever
function grantDamageShield(target, shieldHp, source) {
  const existing = target.statusEffects.find(e => e.name === 'damage_shield');
  if (existing) {
    existing.shieldHp = Math.max(existing.shieldHp, shieldHp);
    existing.source = source;
  } else {
    target.statusEffects.push({ name: 'damage_shield', turnsLeft: 999, shieldHp, dice: null, damType: null, notes: '', source });
  }
}

// Resolves the pending action with the Authority of its attacker behind every hit and status it deals
export function resumePendingAction(reactAbility) {
  const action = S.pendingAction;
  const striker = action && getCombatant(action.attackerId ?? action.casterId);
  strikeAuthority = striker ? authorityOf(striker, action.ability) : 0;
  strikeSource = striker ?? null;
  try { settlePendingAction(reactAbility); } finally { strikeAuthority = 0; strikeSource = null; }
}

function settlePendingAction(reactAbility) {
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
      if (reactAbility.cooldownTurns > 0) reactor.cooldowns[reactAbility.name] = reactAbility.cooldownTurns + 1;
      if (reactAbility.isOncePerFight) reactor.usedThisFight.push(reactAbility.name);
      if (reactAbility.maxCharges > 0) {
        if (reactor.remainingCharges[reactAbility.name] == null) reactor.remainingCharges[reactAbility.name] = reactAbility.maxCharges;
        reactor.remainingCharges[reactAbility.name]--;
      }

      if (reactAbility.tags?.includes('reflect')) {
        if (reflectSpell(reactor, reactAbility, action)) {
          blocked = true;
          if (action.type === 'aoe' || action.type === 'cone') action.blockedIds.push(reactor.id);
        }
      } else if (reactAbility.tags?.includes('chain_guard')) {
        // The chains are in place before the blow lands; the attack itself is not stopped
        pushStatus(reactor, { name: 'chain_guard', turnsLeft: 1 }, true);
        addLog(`⛓ ${reactor.name} throws his chains between himself and the blow!`, 'spell');
      } else if (reactAbility.tags?.includes('half_phys')) {
        raiseBladeArmor(reactor, reactAbility);
      } else if (reactAbility.grants) {
        // A timed buff does not stop the blow: it is in place before the damage lands, and stays
        grantTimed(reactor, reactAbility);
        strengthenDefense(action, reactor);
      } else if (reactAbility.tags?.includes('teleportation')) {
        // A group teleport takes the allies who followed along (everyone, without a map) out of the way too
        const group = reactAbility.tags.includes('group');
        const gone  = !group ? [reactor.id]
          : S.currentMap ? [reactor.id, ...(S.lastTeleportedIds ?? [])]
          : allies(reactor).map(a => a.id);
        S.lastTeleportedIds = null;
        addLog(group ? `✦ ${reactor.name} spirits the team away — the attack misses them!` : `✦ ${reactor.name} blinks away — attack misses!`, 'spell');
        blocked = true;
        if (action.type === 'aoe' || action.type === 'cone') {
          for (const id of gone) if (!action.blockedIds.includes(id)) action.blockedIds.push(id);
        }
      } else if (reactAbility.tags?.includes('dispel')) {
        // The spell is unravelled before it lands
        addLog(`✨ ${reactor.name} unravels the spell with ${reactAbility.name}!`, 'spell');
        blocked = true;
        if (action.type === 'aoe' || action.type === 'cone') {
          if (!action.blockedIds.includes(reactor.id)) action.blockedIds.push(reactor.id);
          addLog(`  (${reactor.name} only — others still take damage)`, 'info');
        }
      } else if (reactAbility.isVoid) {
        addLog(`🌑 ${reactor.name} opens ${reactAbility.name}!`, 'spell');
        absorbIntoVoid(reactor, action);
        blocked = true;
        if (action.type === 'aoe' || action.type === 'cone') {
          const radius = reactAbility.radius || 1;
          const covered = livingCombatants(reactor.teamIndex).filter(a => !S.currentMap || chebyshev(reactor, a) <= radius);
          for (const a of covered) if (!action.blockedIds.includes(a.id)) action.blockedIds.push(a.id);
          addLog(`  ✦ The void shields ${covered.map(a => a.name).join(', ')}!`, 'spell');
        }
      } else if (reactAbility.tags?.includes('dodge') && (action.type === 'aoe' || action.type === 'cone')) {
        // A dodge is total against one target but only gets half out of the way of an area
        addLog(`💨 ${reactor.name} reacts with ${reactAbility.name} — half damage from the area.`, 'spell');
        if (!action.halvedIds.includes(reactor.id)) action.halvedIds.push(reactor.id);
      } else if (reactAbility.isBlock) {
        if (reactAbility.dice && !reactAbility.tags?.includes('regen') && !reactAbility.tags?.includes('heal')) {
          const shieldHp = Math.max(0, parseDice(reactAbility.dice).total);
          grantDamageShield(reactor, shieldHp, reactAbility.source);
          addLog(`🛡 ${reactor.name} raises ${reactAbility.name} — ${shieldHp} HP absorb shield!`, 'spell');
          if (reactAbility.tags?.includes('team')) teamBoon(reactor, reactAbility, shieldHp);
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
  // Asked after every answer, so one target taking the hit does not skip the others' reacts
  if ((action.type === 'aoe' || action.type === 'cone') && !action.noReacts) {
    const allT = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
    const next  = allT.find(t => !action.reactedIds.includes(t.id) && !action.blockedIds.includes(t.id) && getReacts(t, action.ability).length > 0);
    if (next) {
      action.reactorId = next.id;
      action.reactedIds.push(next.id);
      S.pendingAction = action;
      S.awaitingReact = true;
      S.reactOptions  = getReacts(next, action.ability).map(ab => ({ combatantId: next.id, ability: ab }));
      R.renderReactOverlay();
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
        if (action.result.hit) {
          const atkTags = atk.transformedBaseAtk?.tags ?? atk.sourceChar.baseAtk?.tags ?? [];
          const damType = damTypeFromTags(atkTags);
          const ignoreDR = getDomainEffects(atk, { applyOn: 'atkRoll' }).some(e => e.tags?.includes('unblockabled'));
          const dealt = applyDamage(def, action.result.damage, damType, atkTags, ignoreDR);
          drainOnHit(atk, dealt);
          const basic = atk.transformedBaseAtk ?? atk.sourceChar.baseAtk;
          if (!poisonCombo(basic, def)) applyStatus(def, basic?.effect);   // a basic attack's rider (Cole's 1d2 stun)
          if (atk.prevKind === 'steamMode' && hasPassiveTag(atk, 'steamGun') && !def.isKO) {
            addLog(`  🔥 ${atk.name}'s SteamGun scorches ${def.name}!`, 'status');
            applyStatus(def, 'burn');
          }
          witherMax(atk, def);
          strikeBack(atk, action.result, damType, atkTags);
          applyHpPerHitPassives(atk);
          if (atkTags.includes('grounded')) removeFlying(def);
          // Dual Wielder: a landed blow is followed by a second one
          if (!action.result.mutual && !atk.isKO && !def.isKO
              && atk.sourceChar.passif?.some(p => p.tags?.includes('doubleStrike') && !passiveLost(atk, p))) {
            addLog(`⚔ ${atk.name}'s second blade follows!`, 'crit');
            freeAttack(atk, def);
          }
        } else if (!action.result.hit && !action.result.freeAction) {
          const shadowEffs = getDomainEffects(def, { applyOn: 'atkRoll', foeJustMissed: true });
          if (shadowEffs.length > 0 && shadowEffs[0].dices) {
            const bonus = parseDice(shadowEffs[0].dices).total;
            def.shadowCounterBonus += bonus;
            addLog(`🌑 ${def.name}'s shadows stir — +${bonus} on next attack! (Shadow Counter)`, 'spell');
          }
        }
        if (action.result.freeAction && def.teamIndex !== atk.teamIndex) def.freeActionTarget = atk.id;   // not against a unit the blow just turned to our side
      }

    } else if (action.type === 'aoe') {
      const caster    = getCombatant(action.casterId);
      const ability   = action.ability;
      const allTargets = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
      const isPureHeal = ability.targetKind === 'ally';
      let precastBonus = 0;
      const banked = caster ? spendNextBonus(caster) : null;
      if (banked) {
        precastBonus = parseDice(banked.dice).total;
        addLog(`✦ ${caster.name}'s ${banked.label === 'DestinyGamble' ? 'Destiny Gamble' : 'Runik Precast'} activates! (+${precastBonus})`, 'spell');
      }
      const aoeIgnoreDR = ignoresDR(caster, ability);
      addLog(`${caster.name}'s ${ability.name} strikes all ${isPureHeal ? 'allies' : 'enemies'}!`, 'spell');
      if (ability.tags?.includes('dry') && allTargets[0]) dryAllies(caster, ability, allTargets[0]);
      // A taunt is not an attack: no roll to land it, no save against it
      const taunting = !!ability.tags?.includes('taunt');
      if (taunting && pushStatus(caster, { name: 'damage_reduction', turnsLeft: 1, amount: 10 }, true)) {
        addLog(`🐗 ${caster.name} braces — -10 damage taken for 1 turn.`, 'spell');
      }
      const aoeAtk = (isPureHeal || taunting) ? null : rollAttackD20(caster, ability);
      if (aoeAtk) addLog(`  🎲 ${caster.name} rolls ${aoeAtk.roll.value} to land it`, 'spell');
      for (const target of allTargets) {
        if ((action.blockedIds ?? []).includes(target.id)) continue;
        if (taunting) {
          if (pushStatus(target, { name: 'taunted', turnsLeft: 2, sourceId: caster.id })) {
            addLog(`🐗 ${target.name} is taunted — they must target ${caster.name} for 1 turn!`, 'status');
          }
          continue;
        }
        const fullBlock = ability.tags?.includes('guardbreak') ? null : target.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
        if (fullBlock) {
          addLog(`🛡 ${target.name}'s shield blocks the AoE!`, 'spell');
          target.statusEffects = target.statusEffects.filter(e => e !== fullBlock);
          updateCombatantCardDOM(target);
          continue;
        }
        const clash = aoeAtk ? areaDefense(aoeAtk, target, caster, ability) : NO_CLASH;
        if (clash.freeAction && !action.free) target.freeActionTarget = caster.id;
        let mult = clash.mult;
        if (mult === 0) continue;
        if ((action.halvedIds ?? []).includes(target.id)) mult *= 0.5;
        if (ability.tags?.includes('cleans')) applyCleanse(target);
        applyWard(ability, target);
        if (ability.dice) {
          if (isPureHeal) {
            if (ability.tags?.includes('regen')) {
              applyStatus(target, 'regen');
              const re = target.statusEffects.find(e => e.name.toLowerCase() === 'regen');
              if (re) re.dice = ability.dice;
              addLog(`  ${target.name} regenerates ${ability.dice}/turn!`, 'heal');
            } else {
              applyHeal(target, healDice(caster, target, ability), null, !!ability.tags?.includes("repair"));
            }
          } else {
            const rd = parseDice(ability.dice, { diceMult: clash.diceMult });
            const damType = damTypeFromTags(ability.tags);
            const versus = bonusVsFor(ability, target, clash.diceMult);
            const arcane = spellRollBonus(caster, target, ability, clash.diceMult);
            const totalDmg = Math.floor((rd.total + precastBonus + (versus?.total ?? 0) + (arcane?.total ?? 0)) * mult);
            addLog(`  ${target.name} is hit for ${totalDmg} (${rd.breakdown}${precastBonus ? ` +precast${precastBonus}` : ''}${versus ? ` +${versus.label}` : ''}${arcane ? ` +${arcane.label}` : ''}${mult < 1 ? ' ×½' : ''})`, 'hit');
            applyDamage(target, totalDmg, damType, ability.tags, aoeIgnoreDR);
            if (clash.mutual) strikeBack(caster, { recoil: totalDmg }, damType, ability.tags);
            if (ability.isHeal) applyHeal(caster, String(totalDmg));
            if (grounds(ability)) removeFlying(target);
            if (ability.tags?.includes('knockback')) knockBack(caster, target);
          }
        }
        applyMoveEffect(ability, target, clash.diceMult > 1);
        if (isPureHeal && ability.slotRegen > 0 && !(ability.excludeSelf && target.id === caster.id)) restoreSlots(target, ability.slotRegen, ability.name);
      }
      blastDoors(caster, ability, action.center);

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
          if (result.hit && ability.dice) {
            const ignoreDR = ignoresDR(caster, ability);
            applyDamage(current, result.damage, damType, ability.tags, ignoreDR);
            strikeBack(caster, result, damType, ability.tags);
            applyMoveEffect(ability, current, result.guaranteed);
            if (grounds(ability)) removeFlying(current);
            if (ability.followUp) (caster.followUps ??= []).push({ targetId: current.id, dice: ability.followUp, name: ability.name, damType, tags: ability.tags });
          }
          if (result.freeAction) current.freeActionTarget = caster.id;
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
      const coneIgnoreDR = ignoresDR(caster, ability);
      const coneAtk = rollAttackD20(caster, ability);
      addLog(`  🎲 ${caster.name} rolls ${coneAtk.roll.value} to land it`, 'spell');
      for (const target of allTargets) {
        if ((action.blockedIds ?? []).includes(target.id)) continue;
        const clash = areaDefense(coneAtk, target, caster, ability);
        if (clash.freeAction && !action.free) target.freeActionTarget = caster.id;
        let mult = clash.mult;
        if (mult === 0) continue;
        if ((action.halvedIds ?? []).includes(target.id)) mult *= 0.5;
        if (ability.dice) {
          const rd = parseDice(ability.dice, { diceMult: clash.diceMult });
          const versus = bonusVsFor(ability, target, clash.diceMult);
          const arcane = spellRollBonus(caster, target, ability, clash.diceMult);
          const main = ability.primaryBonus && target.id === action.targetIds[0] ? parseDice(ability.primaryBonus, { diceMult: clash.diceMult }) : null;
          const dmg = Math.floor((rd.total + (versus?.total ?? 0) + (arcane?.total ?? 0) + (main?.total ?? 0)) * mult);
          addLog(`  ${target.name} is hit for ${dmg} (${rd.breakdown}${versus ? ` +${versus.label}` : ''}${arcane ? ` +${arcane.label}` : ''}${main ? ` +main target ${main.breakdown}` : ''}${mult < 1 ? ' ×½' : ''})`, 'hit');
          applyDamage(target, dmg, damType, ability.tags, coneIgnoreDR);
          if (clash.mutual) strikeBack(caster, { recoil: dmg }, damType, ability.tags);
          if (grounds(ability)) removeFlying(target);
        }
        if (!poisonCombo(ability, target, mult)) applyMoveEffect(ability, target, clash.diceMult > 1);
        if (ability.tags?.includes('passives_off') && !target.isKO && pushStatus(target, { name: 'passives_off', turnsLeft: 2 })) {
          addLog(`  ✦ ${target.name}'s passives are switched off for 1 turn.`, 'status');
        }
      }
      blastDoors(caster, ability, action.center);

    } else if (action.type === 'splash') {
      const caster  = getCombatant(action.casterId);
      const primary = getCombatant(action.targetIds[0]);
      const ability = action.ability;
      if (caster && primary) {
        const damType = damTypeFromTags(ability.tags);
        logAttackResult(caster, primary, action.result);
        if (action.result.freeAction && !action.free) primary.freeActionTarget = caster.id;
        if (action.result.hit && ability.dice) {
          applyDamage(primary, action.result.damage, damType, ability.tags);
          strikeBack(caster, action.result, damType, ability.tags);
          if (ability.radius > 0) {
            const splashTargets = enemies(caster)
              .filter(t => t.id !== primary.id && blastReaches(primary.x, primary.y, t.x, t.y, ability.radius));
            if (splashTargets.length > 0) {
              addLog(`  Splash radius ${ability.radius} hits ${splashTargets.map(t => t.name).join(', ')}!`, 'spell');
              // the primary target's attack roll is the one the bystanders defend against
              const splashAtk = { roll: { value: action.result.atkRoll, isNat20: action.result.crit, isNat1: action.result.fumble }, sureHit: action.result.domainSureHit };
              for (const t of splashTargets) {
                const clash = areaDefense(splashAtk, t, caster, ability);
                if (clash.freeAction && !action.free) t.freeActionTarget = caster.id;
                if (clash.mult === 0) continue;
                const rd = parseDice(ability.splashDice ?? ability.dice, { diceMult: clash.diceMult });
                const splashDmg = Math.floor((ability.splashDice ? rd.total : rd.total / 2) * clash.mult);
                addLog(`  ${t.name} is caught by the splash for ${splashDmg} (${rd.breakdown}).`, 'hit');
                applyDamage(t, splashDmg, damType, ability.tags);
                if (clash.mutual) strikeBack(caster, { recoil: splashDmg }, damType, ability.tags);
                applyMoveEffect(ability, t, clash.diceMult > 1);
              }
            }
          }
        }
        applyMoveEffect(ability, primary, action.result.guaranteed);
      }

    } else if (action.type === 'ability') {
      const caster  = getCombatant(action.casterId);
      const target  = getCombatant(action.targetIds[0]);
      const ability = action.ability;
      if (caster && target) {
        const isPureHeal = ability.targetKind === 'ally';
        const isSelf     = ability.targetKind === 'self';

        if (isSelf && ability.tags?.includes('selfDestruct')) {
          selfDestruct(caster, ability);
        } else if (isSelf || isPureHeal) {
          if (ability.grants) grantTimed(target, ability);
          // Borrowed Time (instant): the turn's action comes back, so the caster acts once more
          if (ability.tags?.includes('extraAction')) {
            S.bonusActions++;
            S.hasActed = S.actionsDone.length >= actionBudget(caster);
            addLog(`⏳ ${caster.name} borrows a moment — he may act again!`, 'spell');
          }
          if (ability.tags?.includes('final_reckoning') && !caster.statusEffects.some(e => e.name === 'final_reckoning')) {
            caster.statusEffects.push({ name: 'final_reckoning', turnsLeft: 999, dice: '2d12', damType: null, notes: '+2d12 atk bonus, one more action a turn' });
            addLog(`💀 ${caster.name} enters Final Reckoning — a third action each turn and +2d12 damage!`, 'crit');
          }
          if (ability.tags?.includes('gamble')) destinyGamble(caster);
          if (ability.tags?.includes('half_phys')) {
            raiseBladeArmor(target, ability);
          } else if (ability.isBlock) {
            // A ward must outlast a full round: statuses tick when their owner's turn starts, so an ally
            // that acts right after the caster would otherwise lose it before any enemy could attack
            const wardTurns = target.id === caster.id ? 1 : 2;
            if (ability.dice && !ability.tags?.includes('regen')) {
              const shieldHp = Math.max(0, parseDice(ability.dice).total);
              grantDamageShield(target, shieldHp, ability.source);
              addLog(`🛡 ${target.name} gains a ${shieldHp} HP damage shield!`, 'spell');
            } else {
              applyStatus(target, 'water_shield', wardTurns);
              addLog(`🛡 ${target.name} ${isSelf ? 'prepares a shield' : 'is shielded'} — next attack blocked!`, 'spell');
              // Same effect as the react version: block one attack, then regenerate
              if (ability.dice && ability.tags?.includes('regen')) {
                applyStatus(target, 'regen');
                const re = target.statusEffects.find(e => e.name.toLowerCase() === 'regen');
                if (re) re.dice = ability.dice;
                addLog(`  💚 ${target.name} regenerates ${ability.dice}/turn!`, 'heal');
              }
            }
          }
          if (ability.tags?.includes('cleans')) applyCleanse(target);
          applyWard(ability, target);
          if (isSelf && ability.tags?.includes('team')) teamBoon(caster, ability);
          if (ability.tags?.includes('orders') && pushStatus(target, { name: 'orders', turnsLeft: 2 }, true)) {
            addLog(`📣 ${target.name} follows the orders — +2 on attack rolls until their next turn is over.`, 'spell');
          }
          if (ability.tags?.includes('sure_hit') && pushStatus(target, { name: 'sure_hit', turnsLeft: 2 }, true)) {
            addLog(`🎯 ${target.name}'s next attack cannot miss!`, 'spell');
          }
          if (ability.tags?.includes('adv_next') && pushStatus(target, { name: 'advantage', turnsLeft: 2, uses: 1 }, true)) {
            addLog(`🎲 ${target.name} will roll their next d20 with advantage!`, 'spell');
          }
          if (ability.tags?.includes('smoke')) raiseSmoke(caster, ability);
          if (ability.isRevive && target.isKO) {
            target.isKO = false;
            target.currentHp = Math.floor(target.maxHp * 0.5);
            addLog(`${caster.name} revives ${target.name} with ${target.currentHp}/${target.maxHp} HP!`, 'heal');
            reviveBeside(caster, target);
            // KO clears every status, so give back innate flight
            if (target.sourceChar.passif?.some(p => p.tags?.includes('fly'))
                || (target.isTransformed && target.sourceChar.transformation?.passif?.some(p => p.tags?.includes('fly'))))
              target.statusEffects.push({ name: 'fly', turnsLeft: 999, dice: null, damType: null, notes: '' });
            updateCombatantCardDOM(target);
          } else if (ability.dice && !ability.isBlock) {
            if (ability.tags?.includes('regen')) {
              applyStatus(target, 'regen');
              const re = target.statusEffects.find(e => e.name.toLowerCase() === 'regen');
              if (re) re.dice = ability.dice;
              addLog(`${target.name} regenerates ${ability.dice}/turn!`, 'heal');
            } else {
              applyHeal(target, healDice(caster, target, ability), null, !!ability.tags?.includes("repair"));
            }
          }
          applyMoveEffect(ability, target);
          if (ability.tags?.includes('fly') && !target.statusEffects.some(e => e.name.toLowerCase() === 'fly')) {
            target.statusEffects.push({ name: 'fly', turnsLeft: ability.duration > 0 ? ability.duration : 999, dice: null, damType: null, notes: '' });
            addLog(`🦅 ${target.name} is now flying!`, 'spell');
          }
          if (ability.precastDice) {
            target.statusEffects.push({ name: 'runik_precast', turnsLeft: 2, dice: ability.precastDice, damType: null, notes: '' });
            addLog(`✦ ${target.name} prepares a Runik Precast! (+${ability.precastDice} to next cast)`, 'spell');
          }
          updateCombatantCardDOM(target);
        } else {
          logAttackResult(caster, target, action.result);
          if (action.result.hit) {
            const damType = damTypeFromTags(ability.tags);
            if (ability.dice && action.result.damage > 0) {
              const ignoreDR = ignoresDR(caster, ability);
              const dealt = applyDamage(target, action.result.damage, damType, ability.tags, ignoreDR);
              strikeBack(caster, action.result, damType, ability.tags);
              if (ability.isHeal) applyHeal(caster, String(action.result.damage));
              else drainOnHit(caster, dealt);
              if (ability.drainSlots || ability.drainKi) drainResources(caster, target, ability);
              if (ability.isHeal && ability.slotRegen > 0) restoreSlots(caster, ability.slotRegen, ability.name);
              applyHpPerHitPassives(caster);
              if (grounds(ability)) removeFlying(target);
            }
            applyMoveEffect(ability, target, action.result.guaranteed);
            if (ability.grants) grantTimed(caster, ability);   // a hostile move that also arms its caster (Withering Hour)
            if (ability.tags?.includes('pull') && !target.isKO) pullTarget(caster, target);
            if (ability.tags?.includes('disv_next') && pushStatus(target, { name: 'disadvantage', turnsLeft: 2, uses: 1 })) {
              addLog(`⬇ ${target.name} is weighed down — next d20 at disadvantage!`, 'status');
            }
            if (ability.tags?.includes('puppet') && pushStatus(target, { name: 'puppeteered', turnsLeft: 2, controllerId: caster.id })) {
              addLog(`🎭 ${caster.name} seizes ${target.name}'s shadow — they decide what ${target.name} does next turn!`, 'spell');
            }
            if (ability.tags?.includes('execute')) executeStrike(caster, target, ability);
            if (ability.tags?.includes('chain_grab') && !target.isKO) chainBind(caster, target);
          } else if (!action.result.hit && !action.result.freeAction) {
            const shadowEffs = getDomainEffects(target, { applyOn: 'atkRoll', foeJustMissed: true });
            if (shadowEffs.length > 0 && shadowEffs[0].dices) {
              const bonus = parseDice(shadowEffs[0].dices).total;
              target.shadowCounterBonus += bonus;
              addLog(`🌑 ${target.name}'s shadows stir — +${bonus} on next attack! (Shadow Counter)`, 'spell');
            }
          }
          if (action.result.freeAction && !action.free) target.freeActionTarget = caster.id;
        }
      }
    }
  }

  // ── Victory check ─────────────────────────────────────────────────────
  for (const v of S.combatants) if (v.chains) v.statusEffects = v.statusEffects.filter(e => e.name !== 'chain_guard');
  const winner = checkVictory();
  if (winner !== null) { endCombat(winner); return; }

  // The action is over; anyone it earned a free action answers before the turn moves on
  concludeAction(action.free ? !!action.concludeInstant : !!action.ability?.isInstant);
}

// Victory check, then the free actions, then the next turn (an instant move leaves the turn open)
function concludeAction(instant) {
  const winner = checkVictory();
  if (winner !== null) { endCombat(winner); return; }

  if (runFreeActions(instant)) return;   // waiting on a person
  const winner2 = checkVictory();
  if (winner2 !== null) { endCombat(winner2); return; }

  // The turn stays open after an instant, or while an action is spent and another remains (a divinity, the Great Staff)
  if (!S.hasActed && (instant || (S.actionsDone.length > 0 && !activeCombatant()?.isKO))) { R.renderCombatScreen(); return; }
  advanceTurn();
}

// ── Free actions ───────────────────────────────────────────────────────────
// A fumbling foe, or a natural 20 defense, leaves the defender one free action against the attacker:
// dash in and strike, do nothing, or cast a spell at them. It sits outside the turn order.

const asksPerson = c => S.promptFreeAction || (!headless && S.aiTeam !== c.teamIndex);

// Can `actor` dash next to `foe` and strike? (A map-less fight always can.)
function canDashStrike(actor, foe) {
  if (!S.currentMap) return true;
  if (targetInRange(actor, foe, null).inRange) return true;
  const speed = moveSpeed(actor);
  if (chebyshev(actor, foe) > speed + MELEE_RANGE) return false;
  const cell = freeCellAdjacentTo(foe, actor, actor.id);
  return !!cell && chebyshev(actor, cell) <= speed && !trappingDomainOwner(actor, cell.x, cell.y);
}

// The offensive spells `actor` could cast at `foe` right now: single target or area (centred on the foe), in reach
function freeSpellsFor(actor, foe) {
  if (hasSilence(actor)) return [];
  return actor.abilities.filter(ab =>
    isSpellMove(ab) && ab.targetKind === 'enemy' && ab.dice && !ab.reactOnly && !ab.isBlock && !ab.isInstant
    && !ab.isCone && !ab.isSplash && !ab.isGate && !ab.isRevive && !ab.isTransform && !ab.isContest && !(ab.maxBounce > 0)
    && !ab.tags?.some(t => ['dash', 'teleportation', 'pull', 'taunt', 'execute', 'puppet'].includes(t))
    && abilityAvailable(actor, ab)
    && (!S.currentMap || (ab.isAoe
      ? chebyshev(actor, foe) <= (ab.range ?? SPELL_RANGE) && hasLos(actor.x, actor.y, foe.x, foe.y)
      : targetInRange(actor, foe, ab).inRange)));
}

export function freeActionOptions(actor, foe) {
  const options = [{ type: 'attack', ok: canDashStrike(actor, foe) }, { type: 'none', ok: true }];
  for (const ability of freeSpellsFor(actor, foe)) options.push({ type: 'spell', ok: true, ability });
  return options;
}

// What the bot (and a headless fight) does with a free action: strike when it can get there, else let it go
const autoFreeChoice = (actor, foe) => canDashStrike(actor, foe) ? { type: 'attack' } : { type: 'none' };

// A free spell is an ordinary pending action, so its target may react to it. It is marked `free`: it earns nobody
// another free action, and when it is done it concludes the action it answered (instant or not).
// Returns true when the pending action carries the fight on from here.
function freeSpell(actor, foe, ab, instant) {
  spendResource(actor, ab);
  if (ab.cooldownTurns > 0) actor.cooldowns[ab.name] = ab.cooldownTurns + 1;
  if (ab.isOncePerFight) actor.usedThisFight.push(ab.name);
  if (ab.maxCharges > 0) {
    if (actor.remainingCharges[ab.name] == null) actor.remainingCharges[ab.name] = ab.maxCharges;
    actor.remainingCharges[ab.name]--;
  }
  addLog(`⚡ ${actor.name} casts ${ab.name} at ${foe.name} as a free action!`, 'crit');

  const shield = ab.tags?.includes('guardbreak') ? null : foe.statusEffects.find(e => e.name.toLowerCase() === 'water_shield');
  if (shield) {
    addLog(`🛡 ${foe.name}'s pre-armed shield blocks ${actor.name}'s ${ab.name}!`, 'spell');
    foe.statusEffects = foe.statusEffects.filter(e => e !== shield);
    updateCombatantCardDOM(foe);
    return false;
  }

  const base = { casterId: actor.id, abilityName: ab.name, ability: ab, free: true, concludeInstant: instant };
  let targets;
  if (ab.isAoe) {
    targets = S.currentMap ? aoeCombatantHits(ab, actor, foe.x, foe.y) : enemies(actor);
    if (targets.length === 0) targets = [foe];
    S.pendingAction = { ...base, type: 'aoe', targetIds: targets.map(t => t.id), reactorId: null, reactedIds: [], blockedIds: [], halvedIds: [], noReacts: false };
  } else {
    targets = [foe];
    S.pendingAction = { ...base, type: 'ability', targetIds: [foe.id], result: resolveAttack(actor, foe, ab.dice, ab) };
  }

  const firstReactor = targets.find(t => getReacts(t, ab).length > 0);
  if (firstReactor) {
    if (ab.isAoe) {
      S.pendingAction.reactorId = firstReactor.id;
      S.pendingAction.reactedIds.push(firstReactor.id);
    }
    S.awaitingReact = true;
    S.reactOptions  = getReacts(firstReactor, ab).map(r => ({ combatantId: firstReactor.id, ability: r }));
    R.renderReactOverlay();
    return true;
  }
  resumePendingAction(null);
  return true;
}

// Returns true when a spell took over the rest of the action (its react flow concludes the turn)
export function resolveFreeAction(actor, foe, choice, instant = false) {
  if (!actor || !foe || actor.isKO || foe.isKO) return false;
  const ctrl = hasControlEffect(actor);
  if (ctrl) { addLog(`⚡ ${actor.name} is ${ctrl.name} and cannot use the free action.`, 'info'); return false; }

  if (choice?.type === 'attack') {
    if (!canDashStrike(actor, foe)) { addLog(`⚡ ${actor.name} cannot reach ${foe.name} for the free action.`, 'info'); return false; }
    addLog(`⚡ ${actor.name} takes a free action against ${foe.name}!`, 'crit');
    dashToward(actor, foe);
    freeAttack(actor, foe);
    return false;
  }
  if (choice?.type === 'spell') {
    const ab = freeSpellsFor(actor, foe).find(a => a.name === choice.abilityName);
    if (ab) return freeSpell(actor, foe, ab, instant);
    addLog(`⚡ ${actor.name} cannot cast ${choice.abilityName} now.`, 'info');
    return false;
  }
  addLog(`⚡ ${actor.name} lets the opening pass.`, 'info');
  return false;
}

// Plays every free action that is owed. Returns true when it stopped to ask a person.
function runFreeActions(instant) {
  for (let guard = 0; guard < S.combatants.length * 2; guard++) {
    const actor = S.combatants.find(c => c.freeActionTarget != null);
    if (!actor) return false;
    const foe = getCombatant(actor.freeActionTarget);
    actor.freeActionTarget = null;
    if (actor.isKO || !foe || foe.isKO) continue;
    if (asksPerson(actor)) {
      S.awaitingFree = { actorId: actor.id, targetId: foe.id, instant };
      R.renderFreeActionOverlay();
      return true;
    }
    if (resolveFreeAction(actor, foe, autoFreeChoice(actor, foe), instant)) return true;
    const w = checkVictory();
    if (w !== null) { endCombat(w); return true; }
  }
  return false;
}

// The person's answer to the free-action prompt: { type: 'attack' | 'none' } or { type: 'spell', abilityName }
export function handleFreeAction(choice) {
  const pending = S.awaitingFree;
  if (!pending) return;
  S.awaitingFree = null;
  if (!headless) document.getElementById('free-overlay')?.remove();
  if (resolveFreeAction(getCombatant(pending.actorId), getCombatant(pending.targetId), choice, pending.instant)) return;
  concludeAction(pending.instant);
}

// ── §11  Turn Flow ─────────────────────────────────────────────────────────

export function endCombat(winner) {
  S.winnerTeam = winner;
  S.phase = 'victory';
  R.renderCombatScreen();
  later(() => R.renderVictoryScreen(), 1200);
}

const FALLBACK_MAP = 'manor_of_nadargath';

/** Open the map-choice step; the first manifest entry is pre-selected every time. */
export async function goToMapChoice() {
  const manifest  = await loadManifest().catch(() => [FALLBACK_MAP]);
  S.currentMap    = null;
  S.mapChoice     = manifest[0] ?? FALLBACK_MAP;
  S.mapLoading    = false;
  S.phase         = 'mapchoice';
  R.render();
}

/** Resolve the chosen map (falling back to Manor on any failure), then roll initiative. */
export async function confirmMap(choice) {
  if (S.mapLoading || S.phase !== 'mapchoice') return;
  S.mapLoading = true;
  R.render();
  const map = choice === 'random'
    ? await loadRandomMapOrManor()
    : await loadMap(choice).catch(() => loadMap(FALLBACK_MAP));
  S.mapLoading = false;
  if (S.phase !== 'mapchoice') return; // left the screen while loading
  S.currentMap = map;
  await startInitiative();
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
  // A companion (the Sorcerer Master's Floating Head) is in the fight from the first round, acting right after its master
  for (const owner of [...S.combatants]) {
    if (owner.sourceChar.companion) spawnSummon(owner, owner.sourceChar.companion, { place: false });
  }

  S.mapViewFilter  = 'both';
  S.hasMoved       = false;
  S.hasActed       = false;
  S.actionsDone    = [];
  S.bonusActions   = 0;
  S.moveMode       = false;
  S.reachableCells = new Map();

  S.activeDomains  = [];
  S.phase = 'initiative';
  R.render();
}

export function startCombat() {
  S.iceCells = new Set();
  S.driedCells = new Set();
  S.fields = [];
  S.phase = 'combat';
  S.currentTurnIndex = 0;
  S.turnSerial++;
  S.roundNumber = 1;
  S.log = [];
  S.hasActed = false;
  S.actionsDone = [];
  S.bonusActions = 0;
  if (S.currentMap) placeCharacters(S.currentMap);
  S.hasMoved = false;
  addRoundDivider();
  markHunters();
  markSacrifices();
  R.render();
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
  S.turnSerial++;
  S.hasMoved         = false;
  S.hasActed         = false;
  S.actionsDone      = [];
  S.bonusActions     = 0;
  S.moveMode         = false;
  S.reachableCells   = new Map();
  clearAimState();
  exitTeleportMode();
  S.pendingTeleportReact = null;
  if (passedZero) { S.roundNumber++; addRoundDivider(); tickFields(); recordTrail(); }

  beginTurn(activeCombatant());
}

export function beginTurn(c) {
  if (!c) return;
  c.luckSpent = false;
  addLog(c.name, 'turn', { team: c.teamIndex });   // start-of-turn ticks belong to this turn

  chainTick(c);
  const survived = !c.isKO && tickTurn(c);
  if (!survived) {
    const w = checkVictory();
    if (w !== null) { endCombat(w); return; }
    advanceTurn(); return;   // died to damage-over-time: no turn to play
  }

  // A boomerang comes back: the blow queued by last turn's move lands now, on each target that was hit
  if (c.followUps?.length) {
    const due = c.followUps; c.followUps = [];
    for (const f of due) {
      const t = getCombatant(f.targetId);
      if (!t || t.isKO) continue;
      const r = parseDice(f.dice);
      addLog(`↩ ${c.name}'s ${f.name} comes back and hits ${t.name} for ${r.total} (${r.breakdown}).`, 'hit');
      applyDamage(t, r.total, f.damType, f.tags);
    }
    if (checkVictory() !== null) { endCombat(checkVictory()); return; }
  }

  // Paralysed: each turn it lasts, a 1d2 chance that the body locks up and the turn is lost (a stun that ends with it)
  if (c.statusEffects.some(e => e.name.toLowerCase() === 'para')) applyStatus(c, '1d2 stun', 1);

  // Absorb shield refreshed every turn (grantDamageShield keeps the larger value, so it never stacks)
  for (const p of c.sourceChar.passif ?? []) {
    if (passiveLost(c, p)) continue;
    if (!p.applyOn?.includes('shieldPerTurn') || !p.dices) continue;
    const shieldHp = Math.max(0, parseDice(p.dices).total);
    grantDamageShield(c, shieldHp, 'passif');
    addLog(`🛡 ${c.name}'s ${p.nom} — ${shieldHp} HP absorb shield.`, 'spell');
    updateCombatantCardDOM(c);
  }

  for (const p of c.sourceChar.passif ?? []) {
    if (passiveLost(c, p)) continue;
    if (!p.applyOn?.includes('hpPerTurn') || !p.dices) continue;
    if (p.condition?.selfBelow50pct && c.currentHp > c.maxHp * 0.5) continue;
    if (p.target === 'allies') {
      // `radius` limits it to allies within that many cells; `excludeSelf` leaves the owner out
      for (const ally of livingCombatants(c.teamIndex)) {
        if (p.excludeSelf && ally.id === c.id) continue;
        if (p.radius && S.currentMap && chebyshev(c, ally) > p.radius) continue;
        applyHeal(ally, p.dices);
      }
    } else {
      applyHeal(c, p.dices, null, false, false);   // a passive's own regeneration makes no blood shield
    }
  }

  // Divine Beast synergy: the healing auras of a synced Beast tick on its own turns
  if (divineSyncActive(c)) {
    for (const e of c.sourceChar.divineSync.effects ?? []) {
      if (!e.applyOn?.includes('hpPerTurn') || !e.dices || e.target !== 'allies') continue;
      for (const ally of livingCombatants(c.teamIndex)) {
        if (ally.id === c.id) continue;   // a Beast's blessing is for the others
        applyHeal(ally, e.dices, e.nom);
        if (e.tags?.includes('cleans')) cleanseOne(ally, e.nom);
      }
    }
  }

  // Lingering fields work on the foes who start a turn inside them
  for (const f of S.fields) if (fieldTouches(f, c) && inField(f, c)) exposeToField(f, c);

  // Domain auras tick on whoever starts a turn inside the area
  for (const entry of S.activeDomains) {
    const domainOwner = getCombatant(entry.casterId);
    if (!domainOwner || domainOwner.isKO) continue;
    const radius = entry.domain.radius ?? 8;
    if (S.currentMap && chebyshev(c, { x: entry.centerX, y: entry.centerY }) > radius) continue;
    const friendly = domainOwner.teamIndex === c.teamIndex;
    if (domainOwner.id === c.id) for (const eff of entry.domain.effects ?? []) if (eff.applyOn?.includes('turnBoon')) grantBoon(c, eff);
    for (const eff of entry.domain.effects ?? []) {
      if (!eff.applyOn?.includes('hpPerTurn') || !eff.dices) continue;
      if (friendly && eff.target !== 'foes') {
        applyHeal(c, eff.dices, eff.nom);
      } else if (!friendly && eff.target === 'foes') {
        const dmg = parseDice(eff.dices).total;
        const damType = damTypeFromTags(eff.tags ?? []);
        addLog(`🔥 ${c.name} is scorched by ${entry.domain.name}! (${eff.nom})`, 'status');
        applyDamage(c, dmg, damType, eff.tags ?? []);
        if (c.isKO) {
          const w = checkVictory();
          if (w !== null) { endCombat(w); return; }
          advanceTurn(); return;
        }
      }
    }
  }

  const puppet = c.statusEffects.find(e => e.name === 'puppeteered');
  if (puppet) addLog(`🎭 ${c.name} acts under ${getCombatant(puppet.controllerId)?.name ?? 'a puppeteer'}'s control — any target is fair game.`, 'status');
  const taunter = tauntSource(c);
  if (taunter) addLog(`🐗 ${c.name} is taunted — they must target ${taunter.name}.`, 'status');

  const ctrl = hasControlEffect(c);
  if (ctrl) {
    addLog(`${c.name} is ${ctrl.name} and cannot act!`, 'status');
    R.renderCombatScreen();
    const serial = S.turnSerial;
    later(() => { if (S.phase === 'combat' && S.turnSerial === serial) advanceTurn(); }, 1000);
    return;
  }

  R.renderCombatScreen();
}
