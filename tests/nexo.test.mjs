import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const sheetOf = n => roster.find(c => c.nom === n);
const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 20 && S.awaitingReact; i++) L.handleReactNo(); };
// d20s come out as `values`, then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
// the sort of unit that has something to react with
const reactions = (target, attacker, ability = null) => L.getReacts(target, ability, attacker).map(a => a.name);

// ── The sheets ─────────────────────────────────────────────────────────────

test('no Nexo knight keeps a copy of Alicia\'s Fire Dragon Breath', () => {
  for (const n of ['Aron', 'Lance', 'Axel', 'Clay']) {
    assert.ok(!sheetOf(n).moveSet.some(m => /Fire Dragon Breath/.test(m.base.nom)), n);
  }
});

test('Lance flies like any flier, with no Nexo Power of his own; the others have theirs', () => {
  const lance = sheetOf('Lance');
  assert.deepEqual(lance.moveSet.map(m => m.base.nom), ['Combined Nexo Power']);   // the team synergy only
  assert.deepEqual(lance.passif.find(p => p.nom === 'Fly'), { nom: 'Fly', dices: '18', tags: ['buff', 'fly'], applyOn: ['speed'] });
  assert.deepEqual(sheetOf('Aron').moveSet.map(m => m.base.nom), ['Nexo Power: Arrow Rain', 'Combined Nexo Power']);
  assert.deepEqual(sheetOf('Axel').moveSet.map(m => m.base.nom), ['Nexo Power: Tremor', 'Combined Nexo Power']);
  assert.ok(sheetOf('Clay').moveSet.some(m => m.base.nom === 'Nexo Power: Energy Cuts' && m.base.dices === '4d6+8' && m.target === 'cone'));
});

test('Lance starts the fight flying, like any other holder of the Fly passive', async () => {
  await newFight({ teamA: ['Lance'], teamB: ['Kadgar'], seed: 1 });
  assert.ok(byName('Lance').statusEffects.some(e => e.name === 'fly'));
});

// ── Dead Eye (Aron) ────────────────────────────────────────────────────────

test('Dead Eye: a target with reactions has none against Aron\'s ranged blows, but keeps them against others', async () => {
  await newFight({ teamA: ['Aron', 'Lance'], teamB: ['Alicia', 'Kadgar'], seed: 2 });
  const aron = byName('Aron'), lance = byName('Lance'), alicia = byName('Alicia');
  aron.x = 2; aron.y = 2; lance.x = 3; lance.y = 2; alicia.x = 9; alicia.y = 2;
  const arrowRain = aron.abilities.find(a => a.name === 'Nexo Power: Arrow Rain');
  assert.ok(reactions(alicia, lance, null).includes('Fire Shield'), 'Alicia can answer another attacker');
  assert.deepEqual(reactions(alicia, aron, null), [], 'nothing against a normal attack at range');
  assert.deepEqual(reactions(alicia, aron, arrowRain), [], 'nor against Arrow Rain');
});

test('Dead Eye does not cover a blow struck at arm\'s length', async () => {
  await newFight({ teamA: ['Aron'], teamB: ['Alicia'], seed: 2 });
  const aron = byName('Aron'), alicia = byName('Alicia');
  aron.x = 5; aron.y = 5; alicia.x = 6; alicia.y = 5;
  assert.ok(reactions(alicia, aron, null).includes('Fire Shield'));
});

// ── Faster (Lance) ─────────────────────────────────────────────────────────

async function lanceHits(lanceInit, foeInit) {
  await newFight({ teamA: ['Lance'], teamB: ['Kadgar'], seed: 5 });
  const lance = byName('Lance'), foe = byName('Kadgar');
  lance.x = 5; lance.y = 5; foe.x = 6; foe.y = 5;
  lance.initiativeRoll = lanceInit; foe.initiativeRoll = foeInit;
  foe.currentHp = foe.maxHp = 400;
  toTurn('Lance');
  forceD20(19, 2);
  L.handleAttack(lance.id, foe.id);
  settle();
  return foe.maxHp - foe.currentHp;
}

test('Faster: Lance hits a slower foe 1.5 times as hard', async () => {
  const slower = await lanceHits(30, 1);
  const faster = await lanceHits(1, 30);
  assert.ok(slower > 0 && faster > 0);
  assert.equal(slower, Math.floor(faster * 1.5));
});

async function lanceTakes(lanceInit, foeInit) {
  await newFight({ teamA: ['Lance'], teamB: ['Kadgar'], seed: 5 });
  const lance = byName('Lance'), foe = byName('Kadgar');
  lance.x = 5; lance.y = 5; foe.x = 6; foe.y = 5;
  lance.initiativeRoll = lanceInit; foe.initiativeRoll = foeInit;
  lance.currentHp = lance.maxHp = 400;
  toTurn('Kadgar');
  forceD20(19, 2);
  L.handleAttack(foe.id, lance.id);
  settle();
  return lance.maxHp - lance.currentHp;
}

test('Faster: Lance takes half from a slower foe and the full blow from a faster one', async () => {
  const fromSlower = await lanceTakes(30, 1);
  const fromFaster = await lanceTakes(1, 30);
  assert.ok(fromSlower > 0 && fromFaster > 0);
  assert.equal(fromSlower, Math.floor(fromFaster / 2));
});

// ── Sturdy (Axel) ──────────────────────────────────────────────────────────

test('Sturdy: about one blow in three is ignored altogether', async () => {
  await newFight({ teamA: ['Axel'], teamB: ['Kadgar'], seed: 7 });
  const axel = byName('Axel');
  let ignored = 0;
  const N = 600;
  let n = 0;
  setRandom(() => ((n++ * 0.6180339887) % 1));
  for (let i = 0; i < N; i++) {
    axel.currentHp = axel.maxHp;
    L.applyDamage(axel, 10, 'physical', ['physical']);
    if (axel.currentHp === axel.maxHp) ignored++;
  }
  setRandom(null);
  assert.ok(ignored > N / 3 - 60 && ignored < N / 3 + 60, `ignored ${ignored} of ${N}`);
});

test('Sturdy: a roll under a third spares him, a roll above does not', async () => {
  await newFight({ teamA: ['Axel'], teamB: ['Kadgar'], seed: 7 });
  const axel = byName('Axel');
  setRandom(() => 0.1);
  L.applyDamage(axel, 10, 'physical', ['physical']);
  assert.equal(axel.currentHp, axel.maxHp);
  setRandom(() => 0.9);
  L.applyDamage(axel, 10, 'physical', ['physical']);
  assert.ok(axel.currentHp < axel.maxHp);
});

// ── Leader (Clay) ──────────────────────────────────────────────────────────

test('Leader: the first lethal blow on an ally is blocked, the second one is not', async () => {
  await newFight({ teamA: ['Clay', 'Aron'], teamB: ['Kadgar'], seed: 3 });
  const clay = byName('Clay'), aron = byName('Aron');
  setRandom(() => 0.99);
  aron.currentHp = 5;
  L.applyDamage(aron, 100, 'physical', ['physical']);
  assert.ok(!aron.isKO && aron.currentHp === 5, 'the blow is blocked whole');
  assert.ok(clay.leaderSpent);
  L.applyDamage(aron, 100, 'physical', ['physical']);
  assert.ok(aron.isKO, 'only the first time');
});

test('Leader: a blow that does not kill goes through and keeps the block for later; Clay does not shield himself', async () => {
  await newFight({ teamA: ['Clay', 'Aron'], teamB: ['Kadgar'], seed: 3 });
  const clay = byName('Clay'), aron = byName('Aron');
  setRandom(() => 0.99);
  const before = aron.currentHp;
  L.applyDamage(aron, 3, 'physical', ['physical']);
  assert.ok(aron.currentHp < before, 'a small blow lands');
  assert.ok(!clay.leaderSpent);
  clay.currentHp = 2;
  L.applyDamage(clay, 100, 'physical', ['physical']);
  assert.ok(clay.isKO, 'he falls like anyone');
});

// ── Tremor (Axel) ──────────────────────────────────────────────────────────

test('Tremor is a 3d6+4 area that can root and hinder', () => {
  const m = sheetOf('Axel').moveSet[0];
  assert.equal(m.base.dices, '3d6+4');
  assert.equal(m.target, 'aoe');
  assert.equal(m.effect, '1d2 root');
  assert.deepEqual(m.inflicts, { status: 'hindered', turns: 1, chance: 0.5 });
});

// ── Synergy: all five Nexo Knights on one team ─────────────────────────────

const FIVE = ['Alicia', 'Aron', 'Lance', 'Axel', 'Clay'];
const combined = c => c.abilities.find(a => a.name === 'Combined Nexo Power');
const logText = () => S.log.map(l => l.text ?? l.msg ?? String(l)).join('\n');

test('Combined Nexo Power: only a team of all five can use it', async () => {
  await newFight({ teamA: FIVE, teamB: ['Kadgar'], seed: 2 });
  for (const n of FIVE) assert.ok(L.abilityAvailable(byName(n), combined(byName(n))), n);
  await newFight({ teamA: FIVE.slice(0, 4), teamB: ['Kadgar'], seed: 2 });
  for (const n of FIVE.slice(0, 4)) assert.ok(!L.abilityAvailable(byName(n), combined(byName(n))), n);
});

test('Combined Nexo Power: one d12 per knight standing, and the team has one shot', async () => {
  await newFight({ teamA: FIVE, teamB: ['Kadgar'], seed: 2 });
  const foe = byName('Kadgar');
  foe.currentHp = foe.maxHp = 2000;
  byName('Lance').isKO = true;
  const clay = toTurn('Clay');
  forceD20(19, 2);
  L.handleCastAbility(clay.id, 'Combined Nexo Power', [foe.id], { x: foe.x, y: foe.y });
  settle();
  assert.match(logText(), /4 of five still stand \(4d12\)/);
  assert.ok(foe.currentHp < foe.maxHp, 'the foe is hurt');
  for (const n of ['Alicia', 'Aron', 'Axel', 'Clay']) assert.ok(!L.abilityAvailable(byName(n), combined(byName(n))), `${n} cannot fire it again`);
});

test('Combined Nexo Power: the team keeps it when one knight falls before it is used', async () => {
  await newFight({ teamA: FIVE, teamB: ['Kadgar'], seed: 2 });
  byName('Axel').isKO = true;
  assert.ok(L.abilityAvailable(byName('Aron'), combined(byName('Aron'))));
});
