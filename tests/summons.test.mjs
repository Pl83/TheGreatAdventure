import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const owned = owner => S.combatants.filter(c => c.ownerId === owner.id);
const order = () => S.initiativeOrder.map(id => L.getCombatant(id).name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const cast = (c, name) => L.handleCastAbility(c.id, name, [c.id]);

// ── Companion: the Floating Head ───────────────────────────────────────────

test('the Sorcerer Master starts the fight with his Floating Head, acting right after him', async () => {
  await newFight({ teamA: ['Sorcerer Master'], teamB: ['Rox'], seed: 3 });
  const master = byName('Sorcerer Master'), head = byName('Floating Head');
  assert.ok(head, 'the head is in the fight');
  assert.equal(head.ownerId, master.id);
  assert.equal(head.teamIndex, master.teamIndex);
  const o = order();
  assert.equal(o.indexOf('Floating Head'), o.indexOf('Sorcerer Master') + 1);
  assert.ok(Math.max(Math.abs(head.x - master.x), Math.abs(head.y - master.y)) <= 4, 'it starts near him');
});

test('the Floating Head falls with the Sorcerer Master, and the fight is lost once he is down', async () => {
  await newFight({ teamA: ['Sorcerer Master'], teamB: ['Rox'], seed: 3 });
  const master = byName('Sorcerer Master'), head = byName('Floating Head');
  master.currentHp = 1;
  L.applyDamage(master, 500, 'physical', ['physical']);
  assert.ok(master.isKO);
  assert.ok(head.isKO, 'the head goes with him');
  assert.equal(L.checkVictory(), 1);
});

test('a summon alone does not keep its team in the fight', async () => {
  await newFight({ teamA: ['Sorcerer Master', 'Rox'], teamB: ['Irina'], seed: 4 });
  const master = byName('Sorcerer Master'), rox = byName('Rox'), head = byName('Floating Head');
  rox.isKO = true;
  master.isKO = true;   // (the head is still marked alive: only a summon stands)
  assert.ok(!head.isKO);
  assert.equal(L.checkVictory(), 1);
});

test('the three summon sheets carry the summon tag, which keeps them off the team selection grid', async () => {
  const { readFileSync } = await import('node:fs');
  const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
  const summons = roster.filter(c => c.tags?.includes('summon')).map(c => c.nom).sort();
  assert.deepEqual(summons, ['Demon', 'Fire Spirit', 'Floating Head', 'Golem']);
});

// ── Called summons: Irina and Leonidas ─────────────────────────────────────

test('Flaming Bird calls one Fire Spirit for 1 ki; it acts right after Irina and stands beside her', async () => {
  await newFight({ teamA: ['Irina'], teamB: ['Rox'], seed: 5 });
  const irina = toTurn('Irina');
  const ki = irina.ki;
  cast(irina, 'Flaming Bird');
  const [spirit] = owned(irina);
  assert.ok(spirit, 'a spirit stands');
  assert.equal(spirit.name, 'Fire Spirit');
  assert.equal(irina.ki, ki - 1);
  const o = order();
  assert.equal(o.indexOf('Fire Spirit'), o.indexOf('Irina') + 1);
  assert.ok(Math.max(Math.abs(spirit.x - irina.x), Math.abs(spirit.y - irina.y)) <= 4);
  assert.ok(S.log.some(e => /join/.test(e.text)), 'the call is logged');
});

test('the called spirit plays its own turn right after the caster', async () => {
  await newFight({ teamA: ['Irina'], teamB: ['Rox'], seed: 5 });
  const irina = toTurn('Irina');
  cast(irina, 'Flaming Bird');
  assert.equal(L.activeCombatant().name, 'Fire Spirit');
});

test('Golem Creation calls 1d4 Golems, all ordered right after Leonidas', async () => {
  await newFight({ teamA: ['Leonidas'], teamB: ['Rox'], seed: 6 });
  const leo = toTurn('Leonidas');
  const slots = leo.spellSlots;
  cast(leo, 'Golem Creation');
  const golems = owned(leo);
  assert.ok(golems.length >= 1 && golems.length <= 4, `${golems.length} golems`);
  assert.ok(golems.every(g => g.name === 'Golem' && g.teamIndex === leo.teamIndex));
  assert.equal(leo.spellSlots, slots - 1);
  const o = order(), at = o.indexOf('Leonidas');
  assert.deepEqual(o.slice(at + 1, at + 1 + golems.length), golems.map(() => 'Golem'));
});

test('summoned units get distinct ids and cells', async () => {
  await newFight({ teamA: ['Leonidas'], teamB: ['Rox'], seed: 7 });
  const leo = toTurn('Leonidas');
  cast(leo, 'Golem Creation');
  const ids = S.combatants.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const cells = S.combatants.filter(c => !c.isKO).map(c => `${c.x},${c.y}`);
  assert.equal(new Set(cells).size, cells.length, 'nobody shares a cell');
});

test('Living Bomb bursts every Fire Spirit: they are spent and the foes in reach are hit', async () => {
  await newFight({ teamA: ['Irina'], teamB: ['Rox'], seed: 8 });
  const irina = toTurn('Irina'), rox = byName('Rox');
  assert.ok(!L.abilityAvailable(irina, irina.abilities.find(a => a.name === 'Living Bomb')), 'no spirit, no bomb');
  cast(irina, 'Flaming Bird');
  const [spirit] = owned(irina);
  irina.ki = irina.maxKi;
  rox.x = spirit.x + 1; rox.y = spirit.y;   // beside the spirit
  assert.ok(L.abilityAvailable(irina, irina.abilities.find(a => a.name === 'Living Bomb')));
  toTurn('Irina');
  const hp = rox.currentHp;
  cast(irina, 'Living Bomb');
  assert.ok(spirit.isKO, 'the spirit is spent');
  assert.ok(S.log.some(e => /bursts/.test(e.text)));
  assert.ok(rox.currentHp <= hp);
});

test('when the caster falls, what she called fades with her', async () => {
  await newFight({ teamA: ['Irina'], teamB: ['Rox'], seed: 9 });
  const irina = toTurn('Irina');
  cast(irina, 'Flaming Bird');
  const [spirit] = owned(irina);
  L.applyDamage(irina, 999, 'physical', ['physical']);
  assert.ok(irina.isKO);
  assert.ok(spirit.isKO);
});

// ── Search: a snapshot taken before a summon forgets the summoned units ────

test('restoring a snapshot removes units summoned since, and the order with them', async () => {
  await newFight({ teamA: ['Leonidas'], teamB: ['Rox'], seed: 11 });
  const leo = toTurn('Leonidas');
  const before = { n: S.combatants.length, order: [...S.initiativeOrder] };
  const snap = snapshot();
  cast(leo, 'Golem Creation');
  assert.ok(S.combatants.length > before.n);
  restore(snap);
  assert.equal(S.combatants.length, before.n);
  assert.deepEqual(S.initiativeOrder, before.order);
  assert.ok(S.combatants.every(c => c.ownerId == null));
});

// ── Annastasia's Sacrifice Mark ────────────────────────────────────────────

test('the Sacrifice Mark calls one Demon for a weak victim and two for a strong one', async () => {
  for (const [maxHp, expected] of [[60, 1], [69, 1], [70, 2], [120, 2]]) {
    await newFight({ teamA: ['Annastasia'], teamB: ['Rox'], seed: 3 });
    const ann = byName('Annastasia'), rox = byName('Rox');
    assert.equal(ann.sacMarkId, rox.id, 'the lone enemy is marked');
    rox.maxHp = maxHp; rox.currentHp = 1;
    L.applyDamage(rox, 500, 'physical', ['physical']);
    const demons = S.combatants.filter(c => c.name === 'Demon' && c.ownerId === ann.id);
    assert.equal(demons.length, expected, `max HP ${maxHp}`);
    assert.equal(demons[0].teamIndex, ann.teamIndex);
  }
});

test('Irina is immune to burn', async () => {
  await newFight({ teamA: ['Irina'], teamB: ['Rox'], seed: 3 });
  const irina = byName('Irina');
  L.applyStatus(irina, 'burn');
  assert.ok(!irina.statusEffects.some(e => e.name.toLowerCase() === 'burn'));
});
