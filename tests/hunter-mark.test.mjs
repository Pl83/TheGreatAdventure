import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const logText = () => S.log.map(e => e.text).join('\n');

async function setup(hunter, foes = ['Kay Climber', 'Zane Climber'], seed = 1) {
  await newFight({ teamA: [hunter], teamB: foes, seed });
  const me = byName(hunter);
  const prey = foes.map(byName);
  const mark = prey.find(f => f.id === me.huntMarkId);
  const other = prey.find(f => f !== mark);
  for (const f of prey) { f.maxHp = f.currentHp = 9999; }
  return { me, mark, other };
}

// a hit with flat dice, so the only thing that can double it is the mark
function hitFor(attacker, defender) {
  for (let i = 0; i < 200; i++) {
    const r = L.resolveAttack(attacker, defender, '10');
    if (r.hit && !r.mutual && r.bonusMult === 1) return r.damage;
  }
  throw new Error('no clean hit in 200 tries');
}

for (const hunter of ['Sienna', 'Vampire Sienna']) {
  test(`${hunter} marks one random enemy at the start of the battle`, async () => {
    const { me, mark } = await setup(hunter);
    assert.ok(mark, 'a mark was picked among the foes');
    assert.match(logText(), /marks/);
    assert.equal(S.combatants.filter(c => c.huntMarkId != null).length, 1);
  });

  test(`${hunter} deals double damage to her mark, not to the others`, async () => {
    const { me, mark, other } = await setup(hunter);
    const onMark = hitFor(me, mark);
    const onOther = hitFor(me, other);
    assert.ok(onMark >= 20, `marked hit ${onMark} is at least 2 x 10`);
    assert.ok(onOther < 20, `ordinary hit ${onOther}`);
  });

  test(`${hunter} defends with advantage against her mark only`, async () => {
    const { me, mark, other } = await setup(hunter);
    S.log = [];
    L.resolveAttack(mark, me, '1');
    assert.match(logText(), /Advantage \(.*\)/, 'rolled with advantage against the mark');
    // the advantage line is about the defender: Sienna herself
    assert.ok(S.log.some(e => e.text.includes(`Advantage (${me.name})`)));
    S.log = [];
    for (let i = 0; i < 5; i++) L.resolveAttack(other, me, '1');
    assert.ok(!S.log.some(e => e.text.includes(`Advantage (${me.name})`)), 'none against an unmarked foe');
  });
}

test('Vampire Sienna is restored to full HP and spell slots when her mark dies; Sienna is not', async () => {
  const v = await setup('Vampire Sienna');
  v.me.currentHp = 5; v.me.spellSlots = 0;
  L.applyDamage(v.mark, 99999);
  assert.ok(v.mark.isKO);
  assert.equal(v.me.currentHp, v.me.maxHp);
  assert.equal(v.me.spellSlots, v.me.maxSpellSlots);

  const s = await setup('Sienna');
  s.me.currentHp = 5;
  L.applyDamage(s.mark, 99999);
  assert.ok(s.mark.isKO);
  assert.equal(s.me.currentHp, 5, 'Sienna does not feast');
});

test('killing an enemy that is not the mark does not restore Vampire Sienna', async () => {
  const v = await setup('Vampire Sienna');
  v.me.currentHp = 5;
  L.applyDamage(v.other, 99999);
  assert.ok(v.other.isKO);
  assert.equal(v.me.currentHp, 5);
});
