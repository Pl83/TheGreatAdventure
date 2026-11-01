import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { S } = L;

const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const logText = () => S.log.map(e => e.text).join('\n');
const isPoisoned = c => c.statusEffects.some(e => ['poison', 'toxic'].includes(e.name.toLowerCase()));

async function duel(attacker, foe, seed = 1) {
  await newFight({ teamA: [attacker], teamB: [foe], seed });
  const a = byName(attacker), f = byName(foe);
  a.x = 10; a.y = 10; f.x = 11; f.y = 10;
  f.maxHp = f.currentHp = 9999;
  toTurn(attacker);
  return { a, f };
}

test('Sylvanas Nightmare\'s scream stuns one time in two, not for sure', async () => {
  await newFight({ teamA: ['Sylvanas Nightmare'], teamB: ['Kay Climber'], seed: 1 });
  const scream = byName('Sylvanas Nightmare').abilities.find(a => a.name === 'Scream of the Banshee');
  assert.equal(scream.effect, '1d2 stun');
  let stunned = 0;
  const N = 60;
  for (let seed = 1; seed <= N; seed++) {
    await newFight({ teamA: ['Sylvanas Nightmare'], teamB: ['Kay Climber'], seed });
    const kay = byName('Kay Climber');
    L.applyStatus(kay, scream.effect);
    if (kay.statusEffects.some(e => e.name.toLowerCase() === 'stun')) stunned++;
  }
  assert.ok(stunned > 10 && stunned < 50, `stunned ${stunned}/${N}`);
});

test('Astrid Nightmare\'s daggers poison, and hurt for 1d12 more instead once the target is poisoned', async () => {
  let hurt = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { a, f } = await duel('Astrid Nightmare', 'Kay Climber', seed);
    a.statusEffects.push({ name: 'sure_hit', turnsLeft: 3, dice: null, damType: null, notes: '' });
    L.handleAttack(a.id, f.id); settle();
    if (!/Daggers/.test(logText()) && !isPoisoned(f)) continue;
    if (!isPoisoned(f)) continue;
    // a second blow on a target that is already poisoned
    toTurn('Kay Climber'); L.handlePass(); toTurn('Astrid Nightmare');
    a.statusEffects.push({ name: 'sure_hit', turnsLeft: 3, dice: null, damType: null, notes: '' });
    L.handleAttack(a.id, f.id); settle();
    if (/already poisoned/.test(logText())) { hurt++; break; }
  }
  assert.ok(hurt > 0, 'the combo triggered');
});

test('Spheras\' Poison Breath is a cone; on a poisoned foe it hurts for 1d12+8 instead of poisoning again', async () => {
  const { a, f } = await duel('Spheras Nightmare', 'Kay Climber');
  const breath = a.abilities.find(a2 => a2.name === 'Poison Breath');
  assert.ok(breath.isCone);
  assert.equal(breath.effect, '1d2 poison');
  assert.equal(breath.ifPoisoned, '1d12+8');
  assert.equal(breath.cooldownTurns, 2);
  f.maxHp = f.currentHp = 9999;
  L.applyStatus(f, 'poison');
  assert.ok(isPoisoned(f), 'fixture: poisoned');
  a.statusEffects.push({ name: 'sure_hit', turnsLeft: 3, dice: null, damType: null, notes: '' });
  const hp = f.currentHp;
  L.handleCastAbility(a.id, 'Poison Breath', [f.id]); settle();
  assert.match(logText(), /already poisoned/);
  assert.ok(hp - f.currentHp >= 9, `lost ${hp - f.currentHp}`);
});

test('Dream Hunter: corruption builds up, never drains, and at 100 the target becomes its summon', async () => {
  await newFight({ teamA: ['Dream Hunter'], teamB: ['Kay Climber', 'Zane Climber'], seed: 1 });
  const dh = byName('Dream Hunter'), kay = byName('Kay Climber'), zane = byName('Zane Climber');
  dh.x = 10; dh.y = 10; kay.x = 11; kay.y = 10; zane.x = 12; zane.y = 10;
  kay.maxHp = kay.currentHp = 9999;
  toTurn('Dream Hunter');
  const corruption = () => kay.statusEffects.find(e => e.name === 'corruption');
  let last = 0, rounds = 0;
  while (!kay.ownerId && rounds++ < 80) {
    dh.statusEffects.push({ name: 'sure_hit', turnsLeft: 3, dice: null, damType: null, notes: '' });
    L.handleAttack(dh.id, kay.id); settle();
    const now = corruption()?.value ?? 0;
    assert.ok(now >= last, `it never drains (${last} -> ${now}) ${JSON.stringify(kay.statusEffects.map(e => e.name))} ${S.log.slice(-5).map(e => e.text).join(' / ')}`);
    last = now;
    if (kay.ownerId) break;
    L.handlePass(); toTurn('Dream Hunter');
  }
  assert.ok(kay.ownerId === dh.id, 'Kay became a summon of the Dream Hunter');
  assert.equal(kay.teamIndex, dh.teamIndex);
  assert.ok(!kay.isKO, 'alive, on the other side');
  assert.ok(L.isSummonUnit(kay));
  assert.ok(S.initiativeOrder.indexOf(kay.id) === S.initiativeOrder.indexOf(dh.id) + 1, 'acts right after the hunter');
  assert.match(logText(), /joins Dream Hunter/);
});

test('Corruption comes from every blow of the Dream Hunter: a spell corrupts each foe it hits', async () => {
  await newFight({ teamA: ['Dream Hunter', 'Kay Climber'], teamB: ['Zane Climber', 'Jay Climber'], seed: 1 });
  const dh = byName('Dream Hunter'), mine = byName('Kay Climber'), zane = byName('Zane Climber'), jay = byName('Jay Climber');
  dh.abilities.push(mine.abilities.find(a => a.name === 'Fire Ball'));   // a borrowed spell, to prove it is not only the claws
  dh.x = 10; dh.y = 10; mine.x = 9; mine.y = 10; zane.x = 14; zane.y = 10; jay.x = 15; jay.y = 10;
  zane.maxHp = zane.currentHp = jay.maxHp = jay.currentHp = 9999;
  toTurn('Dream Hunter');
  dh.statusEffects.push({ name: 'sure_hit', turnsLeft: 3, dice: null, damType: null, notes: '' });
  L.handleCastAbility(dh.id, 'Fire Ball', [zane.id, jay.id], { x: 14, y: 10 }); settle();
  const corr = c => c.statusEffects.find(e => e.name === 'corruption')?.value ?? 0;
  assert.ok(corr(zane) > 0 && corr(jay) > 0, `zane ${corr(zane)}, jay ${corr(jay)}`);
  assert.equal(corr(mine), 0, 'allies are spared');
});

test('Hat Form is an instant dodge react', async () => {
  await newFight({ teamA: ['Dream Hunter'], teamB: ['Kay Climber'], seed: 1 });
  const hat = byName('Dream Hunter').abilities.find(a => a.name === 'Hat Form');
  assert.ok(hat.isReact && hat.isInstant);
  assert.ok(hat.tags.includes('dodge'));
});
