import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  return L.activeCombatant();
};
const MEDIC = 'Battle Medic (Heal)';

async function setup(medic, ally = 'Kay Climber') {
  await newFight({ teamA: [medic, ally], teamB: ['Zane Climber'], seed: 1 });
  const me = byName(medic), friend = byName(ally), foe = byName('Zane Climber');
  me.x = 10; me.y = 10; friend.x = 11; friend.y = 10; foe.x = 14; foe.y = 10;
  foe.maxHp = foe.currentHp = 9999;
  return { me, friend, foe };
}

for (const medic of ['Sienna', 'Simo', 'Libra']) {
  test(`${medic}: Battle Medic heals 1d6+3 as a bonus action, once a turn`, async () => {
    const { me, friend } = await setup(medic);
    let min = 99, max = 0;
    for (let i = 0; i < 40; i++) {
      toTurn(me.name);
      friend.currentHp = 10;
      const done = S.actionsDone.length;
      L.handleCastAbility(me.id, MEDIC, [friend.id]); settle();
      const got = friend.currentHp - 10;
      min = Math.min(min, got); max = Math.max(max, got);
      assert.equal(L.activeCombatant(), me, 'a bonus action: the turn is still open');
      assert.equal(S.actionsDone.length, done, 'no action spent');
      // a second try in the same turn is refused
      friend.currentHp = 10;
      L.handleCastAbility(me.id, MEDIC, [friend.id]); settle();
      assert.equal(friend.currentHp, 10, 'once a turn only');
      L.handlePass(); settle();
    }
    assert.ok(min >= 4 && max <= 9, `1d6+3 is 4..9, saw ${min}..${max}`);
  });
}

test('Battle Medic reaches an adjacent ally or herself, not a distant one', async () => {
  const { me, friend } = await setup('Simo');
  toTurn(me.name);
  friend.x = 14; friend.y = 14; friend.currentHp = 10;
  L.handleCastAbility(me.id, MEDIC, [friend.id]); settle();
  assert.equal(friend.currentHp, 10, 'out of reach');
  friend.x = 11; friend.y = 10;
  me.currentHp = 5;
  L.handleCastAbility(me.id, MEDIC, [me.id]); settle();
  assert.ok(me.currentHp >= 9, 'she can mend herself');
});

test('the +3 healing bonus also lifts the other heals (First Aid Kit 1d6+1+3)', async () => {
  const { me, friend } = await setup('Simo');
  let min = 99, max = 0;
  for (let i = 0; i < 40; i++) {
    toTurn(me.name);
    friend.currentHp = 10;
    L.handleCastAbility(me.id, 'First Aid Kit', [friend.id]); settle();
    const got = friend.currentHp - 10;
    min = Math.min(min, got); max = Math.max(max, got);
  }
  assert.ok(min >= 5 && max <= 10, `1d6+4 is 5..10, saw ${min}..${max}`);
});
