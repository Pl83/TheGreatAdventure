import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, setRng, applyStatus, resolveAttack, resolveAbilitiesFromList,
  hasControlEffect, handleTransform, decayStatuses, getCombatant,
} from '../js/combat-logic.js';
import { resetState, makeChar, seqRng, frac } from './helpers.js';

// ── Effect derivation from tags ──────────────────────────────────────────────
test('buff/adv tags derive an "advantage" effect; disv/debuff derive "disadvantage"', () => {
  const [buff] = resolveAbilitiesFromList([{ base: { nom: 'Bless',  tags: ['buff'] },  target: 'self' }]);
  const [adv]  = resolveAbilitiesFromList([{ base: { nom: 'Focus',  tags: ['adv'] },   target: 'self' }]);
  const [debf] = resolveAbilitiesFromList([{ base: { nom: 'Smoke',  tags: ['debuff'] }, target: 'mono' }]);
  const [disv] = resolveAbilitiesFromList([{ base: { nom: 'Hex',    tags: ['disv'] },  target: 'mono' }]);
  assert.equal(buff.effect, 'advantage');
  assert.equal(adv.effect, 'advantage');
  assert.equal(debf.effect, 'disadvantage');
  assert.equal(disv.effect, 'disadvantage');
});

test('controled tag derives a "controled" effect and is a gating control', () => {
  const [ab] = resolveAbilitiesFromList([{ base: { nom: 'Puppeteer', tags: ['controled', 'psy'] }, target: 'mono', duration: 1 }]);
  assert.equal(ab.effect, 'controled');
  assert.equal(ab.effectTurns, 1);
  const [d] = resetState();
  applyStatus(d, 'controled', 1);
  assert.ok(hasControlEffect(d), 'controled should gate the turn');
});

test('explicit effect is preserved and merged with tag-derived markers', () => {
  const [ab] = resolveAbilitiesFromList([{ base: { nom: 'Mix', tags: ['debuff'] }, effect: 'burn', target: 'mono' }]);
  assert.deepEqual(ab.effect.split(', ').sort(), ['burn', 'disadvantage']);
});

test('adv on an offensive move rolls with advantage but does NOT buff the enemy', () => {
  const [ab] = resolveAbilitiesFromList([{ base: { nom: 'Ice Arrow', tags: ['magic', 'adv'] }, target: 'mono', base_dices: '1d8' }]);
  assert.equal(ab.effect, null, 'enemy should not gain an advantage status');
  // roll1=4, roll2=19 (kept via the ability's own adv), defRoll=2, then 1d8 dmg
  setRng(seqRng([frac(4, 20), frac(19, 20), frac(2, 20), frac(5, 8)]));
  const [a, d] = resetState();
  const r = resolveAttack(a, d, '1d8', ab);
  assert.equal(r.atkRoll, 19);
});

// ── Advantage / disadvantage in the attack roll ──────────────────────────────
test('advantage status rolls twice and keeps the higher d20', () => {
  // roll1=5, roll2=18 (kept), defRoll=2, then 1d6 damage
  setRng(seqRng([frac(5, 20), frac(18, 20), frac(2, 20), frac(3, 6)]));
  const [a, d] = resetState();
  applyStatus(a, 'advantage');
  const r = resolveAttack(a, d, null);
  assert.equal(r.atkRoll, 18);
  assert.ok(r.hit);
});

test('disadvantage status rolls twice and keeps the lower d20', () => {
  setRng(seqRng([frac(18, 20), frac(5, 20), frac(2, 20), frac(3, 6)]));
  const [a, d] = resetState();
  applyStatus(a, 'disadvantage');
  const r = resolveAttack(a, d, null);
  assert.equal(r.atkRoll, 5);
});

test('advantage and disadvantage cancel to a single straight roll', () => {
  setRng(seqRng([frac(7, 20), frac(2, 20), frac(3, 6)]));
  const [a, d] = resetState();
  applyStatus(a, 'advantage');
  applyStatus(a, 'disadvantage');
  const r = resolveAttack(a, d, null);
  assert.equal(r.atkRoll, 7);   // only one d20 consumed before the defense roll
});

// ── Transformation revert ────────────────────────────────────────────────────
function transformer(dur) {
  return makeChar({
    nom: 'Shifter',
    moveSet: [{ category: 'transformation', base: { nom: 'Beast Form', tags: ['buff'] }, duration: dur }],
    transformation: { base: { nom: 'Beast Form' }, hp: 20, spellSlot: 0 },
  });
}

test('a timed transformation reverts after its duration, restoring max HP', () => {
  setRng(() => 0);
  const [c] = resetState(transformer(2), makeChar({ nom: 'Foe' }));
  const baseMax = c.maxHp;
  handleTransform(c.id);
  assert.equal(c.isTransformed, true);
  assert.equal(c.maxHp, baseMax + 20);
  assert.ok(c.statusEffects.some(e => e.name === 'transformed'));

  decayStatuses(c);                       // 2 → 1
  assert.equal(c.isTransformed, true);
  decayStatuses(c);                       // 1 → 0 → revert
  assert.equal(c.isTransformed, false);
  assert.equal(c.maxHp, baseMax);
  assert.ok(!c.statusEffects.some(e => e.name === 'transformed'));
});

test('current HP is clamped down when a transformation reverts', () => {
  setRng(() => 0);
  const [c] = resetState(transformer(1), makeChar({ nom: 'Foe' }));
  const baseMax = c.maxHp;
  handleTransform(c.id);
  c.currentHp = c.maxHp;                   // topped up while transformed
  decayStatuses(c);                        // 1 → 0 → revert
  assert.equal(c.maxHp, baseMax);
  assert.equal(c.currentHp, baseMax);      // clamped to the reduced max
});

test('a permanent transformation (dur -1) is never armed to revert', () => {
  setRng(() => 0);
  const [c] = resetState(transformer(-1), makeChar({ nom: 'Foe' }));
  handleTransform(c.id);
  assert.ok(!c.statusEffects.some(e => e.name === 'transformed'));
  decayStatuses(c);
  assert.equal(c.isTransformed, true);
});
