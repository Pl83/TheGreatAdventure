// Position evaluation: one number, higher is better for the given team. Reads the live fight state S and
// changes nothing; no dice are rolled. Built to run thousands of times per search decision, so it makes one
// pass over the combatants (plus one over the foes per own unit for the engagement term) and allocates little.
import { S, abilityAvailable, hasControlEffect, MELEE_RANGE, SPELL_RANGE } from '../combat-logic.js';
import { avgDice } from './greedy.js';
import { walkDistance } from './paths.js';

// Starting weights, to be tuned against fight results
export const WEIGHTS = Object.freeze({
  hp: 1,            // per unit of HP fraction (own sum minus enemy sum)
  alive: 3,         // per living unit, own minus enemy: a KO costs clearly more than any wound
  control: 0.8,     // per enemy under a control effect (own controlled units cost the same)
  hinder: 0.3,      // per enemy that is silenced or rooted (own cost the same)
  unspent: 0.15,    // per unspent once-per-fight or charged ability on a living unit (own bonus, enemy malus)
  damage: 0.005,    // per point of average damage in ready damage abilities (own minus enemy)
  engage: 0.03,     // per step an own unit must still walk before its longest reach covers the nearest foe
  engageRise: 0.1,  // the engage weight grows by this fraction per round, so late standoffs get broken
  win: 30,          // no living enemy left; the same, negated, when no living own unit is left. Above any
                    // material lead a 5v5 can show, yet small enough that a rare won sample cannot swamp a mean
});

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
export function engagement(teamIndex) {
  let gaps = 0;
  for (const c of S.combatants) {
    if (c.isKO || c.teamIndex !== teamIndex) continue;
    let walk = Infinity;
    for (const f of S.combatants) {
      if (!f.isKO && f.teamIndex !== teamIndex) walk = Math.min(walk, walkDistance(f.x, f.y, c.x, c.y));
    }
    gaps += Math.min(MAX_GAP, Math.max(0, walk - reach(c)));
  }
  return -WEIGHTS.engage * (1 + WEIGHTS.engageRise * S.roundNumber) * gaps;
}

// Score of one side's living units, from the point of view of the side that owns them
function side(c) {
  const W = WEIGHTS;
  let v = W.hp * (c.currentHp / c.maxHp) + W.alive;
  if (hasControlEffect(c)) v -= W.control;
  else if (hasEffect(c, 'silence') || hasEffect(c, 'root')) v -= W.hinder;
  for (const ab of c.abilities) {
    if (!(ab.isOncePerFight || ab.maxCharges > 0 || ab.dice) || !abilityAvailable(c, ab)) continue;
    if (ab.isOncePerFight || ab.maxCharges > 0) v += W.unspent;
    if (ab.dice && !ab.isHeal && !ab.isRevive && !ab.reactOnly) v += W.damage * average(ab.dice);
  }
  return v;
}

export function evaluate(teamIndex) {
  let mine = 0, theirs = 0, ownAlive = 0, foesAlive = 0;
  for (const c of S.combatants) {
    if (c.isKO) continue;
    if (c.teamIndex === teamIndex) { ownAlive++; mine += side(c); }
    else { foesAlive++; theirs += side(c); }
  }
  if (!foesAlive) return WEIGHTS.win;
  if (!ownAlive) return -WEIGHTS.win;
  return mine - theirs + engagement(teamIndex);
}
