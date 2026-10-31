// Position evaluation: one number, higher is better for the given team. Reads the live fight state S and
// changes nothing; no dice are rolled. Built to run thousands of times per search decision, so it makes one
// pass over the combatants (plus one over the foes per own unit for the engagement term) and allocates little.
import { S, abilityAvailable, hasControlEffect, MELEE_RANGE, SPELL_RANGE, DOTS, inField, grownDice } from '../combat-logic.js';
import { avgDice } from './greedy.js';
import { walkDistance } from './paths.js';

// Weights tuned against fight results (see docs/ai-runner.md)
export const WEIGHTS = Object.freeze({
  hp: 3,            // per unit of HP fraction (own sum minus enemy sum): wounds weigh about as much as KOs
  alive: 1.5,       // per living unit, own minus enemy: on top of the HP lost, a KO costs half a unit more
                    // (tuned: hp 1 / alive 3 won 70% against greedy, hp 3 / alive 1.5 won 81%)
  control: 0.8,     // per enemy under a control effect (own controlled units cost the same)
  hinder: 0.3,      // per enemy that is silenced or rooted (own cost the same)
  unspent: 0.15,    // per unspent once-per-fight or charged ability on a living unit (own bonus, enemy malus)
  damage: 0.005,    // per point of average damage in ready damage abilities (own minus enemy)
  dot: 2.5,         // per fraction of its max HP that a unit still has to lose to burn, poison and bleed (own cost, enemy gain)
  field: 0.3,       // per unit standing in a lingering field, per round the field has left (own field: gain; foe's: cost)
  engage: 0.05,     // per step an own unit must still walk before its longest reach covers the nearest foe
  engageRise: 0.25, // the engage weight is multiplied by (1 + engageRise * round)^2, so standoffs get broken
  win: 30,          // no living enemy left; the same, negated, when no living own unit is left. Every other
                    // position scores strictly inside (-win, win) (see bounded), yet win is small enough that a
                    // rare won sample cannot swamp a mean
});

// The engagement term never weighs more than a third of a win, at any round
const ENGAGE_MAX = WEIGHTS.win / 3;

// The weights every score below reads. A brain may decide with its own set (withWeights, used by the tuner to play
// two sets against each other); `win` always stays WEIGHTS.win, so the scale of a score never moves.
let active = WEIGHTS;
export function withWeights(w, fn) {
  const before = active;
  active = w;
  try { return fn(); } finally { active = before; }
}
export const TUNABLE = Object.freeze(Object.keys(WEIGHTS).filter(k => k !== 'win'));

// A position that is not over scores strictly between a loss and a win, whatever the roster or the round:
// a rollout that wiped a side always ranks beyond every rollout that did not
export const bounded = v => Math.max(1 - WEIGHTS.win, Math.min(WEIGHTS.win - 1, v));

// Living units of teamIndex and of its foes, as [own, foes]
export function livingCounts(teamIndex) {
  let own = 0, foes = 0;
  for (const c of S.combatants) if (!c.isKO) { if (c.teamIndex === teamIndex) own++; else foes++; }
  return [own, foes];
}

const avgCache = new Map();
const average = expr => {
  let v = avgCache.get(expr);
  if (v === undefined) avgCache.set(expr, v = avgDice(expr));
  return v;
};

const hasEffect = (c, name) => {
  for (const e of c.statusEffects) if (e.name.toLowerCase() === name) return true;
  return false;
};

const MAX_GAP = 20;   // steps counted at most per unit (a foe it cannot walk to counts as this far)

// Longest range at which c's moves can reach a foe (the basic attack included), cached per ability list
const reachCache = new WeakMap();
function reach(c) {
  let r = reachCache.get(c.abilities);
  if (r === undefined) {
    r = MELEE_RANGE;
    for (const ab of c.abilities) {
      if (ab.reactOnly || ab.isReact || ab.isBlock || ab.tags?.includes('teleportation')) continue;
      if (ab.targetKind === 'enemy' || ab.targetKind === 'any') r = Math.max(r, ab.range ?? SPELL_RANGE);
    }
    reachCache.set(c.abilities, r);
  }
  return r;
}

// The engagement penalty of teamIndex: the steps its living units must still walk to bring the nearest foe
// within reach, summed. It only ever counts against the side being scored, so a hold that keeps every foe
// out of reach never ties an approach (this one term is not symmetric between the two sides).
// `foes`, when given, are the foes to measure against, fallen or not: a search passes the foes alive when its
// plan began, so knocking out the foe nearest some units never reads as those units falling behind.
export function engagement(teamIndex, foes = null) {
  let gaps = 0;
  for (const c of S.combatants) {
    if (c.isKO || c.teamIndex !== teamIndex) continue;
    let walk = Infinity;
    for (const f of foes ?? S.combatants) {
      if (foes || (!f.isKO && f.teamIndex !== teamIndex)) walk = Math.min(walk, walkDistance(f.x, f.y, c.x, c.y));
    }
    gaps += Math.min(MAX_GAP, Math.max(0, walk - reach(c)));
  }
  const rise = 1 + active.engageRise * S.roundNumber;
  return -Math.min(ENGAGE_MAX, active.engage * rise * rise * gaps);
}

// The HP a unit is still due to lose to its damage-over-time statuses, as the engine will deal it: a ticking one
// hurts at the start of each of the owner's turns it has left, a bleed once per move (about one move a turn), a
// haemorrhage once per cell walked (about three a turn). Never more than the unit has.
const CELLS_PER_MOVE = 3;
// A growing damage over time hurts with one more die each turn: n, n+1, ... dice of the same size
function growingTotal(e, turns) {
  let sum = 0;
  for (let t = 0; t < turns; t++) sum += average(grownDice({ dice: e.dice, ticks: (e.ticks ?? 0) + t }));
  return sum;
}

function pendingDot(c) {
  let total = 0;
  for (const e of c.statusEffects) {
    const dot = DOTS[e.name.toLowerCase()];
    if (!dot || !e.dice || e.dice === '—') continue;
    const turns = dot.moving ? Math.max(0, e.turnsLeft - 1) : e.turnsLeft;
    total += (dot.grows ? growingTotal(e, turns) : average(e.dice) * turns) * (dot.moving === 'cell' ? CELLS_PER_MOVE : 1);
  }
  return Math.min(total, c.currentHp);
}

// Lingering fields, from teamIndex's side: every unit a field works on, standing in it, is worth `field` for each
// round the field has left. A field of foes works on the caster's enemies, a field of allies on the caster's team.
function fieldValue(teamIndex) {
  let v = 0;
  for (const f of S.fields ?? []) {
    const sign = f.teamIndex === teamIndex ? 1 : -1;
    for (const c of S.combatants) {
      if (c.isKO || (c.teamIndex === f.teamIndex) !== (f.kind === 'allies') || !inField(f, c)) continue;
      v += sign * active.field * f.roundsLeft;
    }
  }
  return v;
}

// Score of one side's living units, from the point of view of the side that owns them
function side(c) {
  const W = active;
  let v = W.hp * (c.currentHp / c.maxHp) + W.alive;
  if (c.statusEffects.length) v -= W.dot * pendingDot(c) / c.maxHp;
  if (hasControlEffect(c)) v -= W.control;
  else if (hasEffect(c, 'silence') || hasEffect(c, 'root')) v -= W.hinder;
  for (const ab of c.abilities) {
    if (!(ab.isOncePerFight || ab.maxCharges > 0 || ab.dice) || !abilityAvailable(c, ab)) continue;
    if (ab.isOncePerFight || ab.maxCharges > 0) v += W.unspent;
    if (ab.dice && !ab.isHeal && !ab.isRevive && !ab.reactOnly) v += W.damage * average(ab.dice);
  }
  return v;
}

// Everything but the engagement term: what both sides see with opposite signs
export function material(teamIndex) {
  let mine = 0, theirs = 0, ownAlive = 0, foesAlive = 0;
  for (const c of S.combatants) {
    if (c.isKO) continue;
    if (c.teamIndex === teamIndex) { ownAlive++; mine += side(c); }
    else { foesAlive++; theirs += side(c); }
  }
  if (!foesAlive) return WEIGHTS.win;
  if (!ownAlive) return -WEIGHTS.win;
  return bounded(mine - theirs + fieldValue(teamIndex));
}

// The position's score for teamIndex: material, plus the engagement term while the fight goes on
export function evaluate(teamIndex) {
  const [own, foes] = livingCounts(teamIndex);
  if (!own || !foes) return material(teamIndex);
  return bounded(material(teamIndex) + engagement(teamIndex));
}
