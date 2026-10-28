// Position evaluation: one number, higher is better for the given team. Reads the live fight state S and
// changes nothing; no dice are rolled. Built to run thousands of times per search decision, so it makes one
// pass over the combatants and allocates nothing.
import { S, abilityAvailable, hasControlEffect } from '../combat-logic.js';
import { avgDice } from './greedy.js';

// Starting weights, to be tuned against fight results
export const WEIGHTS = Object.freeze({
  hp: 1,            // per unit of HP fraction (own sum minus enemy sum)
  alive: 3,         // per living unit, own minus enemy: a KO costs clearly more than any wound
  control: 0.8,     // per enemy under a control effect (own controlled units cost the same)
  hinder: 0.3,      // per enemy that is silenced or rooted (own cost the same)
  unspent: 0.15,    // per unspent once-per-fight or charged ability on a living unit (own bonus, enemy malus)
  damage: 0.005,    // per point of average damage in ready damage abilities (own minus enemy)
  win: 1e6,         // no living enemy left; the same, negated, when no living own unit is left
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
  return mine - theirs;
}
