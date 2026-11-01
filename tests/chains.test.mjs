import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const VOR = 'Vorrakan Duskbane';
const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };
const logText = () => S.log.map(e => e.text).join('\n');
// Vorrakan answers the next blow with Chain Guard
const guard = v => v.statusEffects.push({ name: 'chain_guard', turnsLeft: 1, dice: null, damType: null, notes: '' });
const chainsAbility = v => v.abilities.find(a => a.name === 'Chains of Apophis');

// d20s come out as `values`, then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}

// Vorrakan (team 0) beside a foe (team 1) who has a teammate
async function setup(seed = 1) {
  await newFight({ teamA: [VOR, 'Rox'], teamB: ['Kadgar', 'Eragon'], seed });
  const vor = byName(VOR), foe = byName('Kadgar'), mate = byName('Eragon');
  vor.x = 10; vor.y = 10;
  foe.x = 11; foe.y = 10;
  return { vor, foe, mate };
}
async function grab(vor, foe) {
  toTurn(VOR);
  forceD20(20, 20);
  L.handleCastAbility(vor.id, 'Chains of Apophis', [foe.id]);
  settle();
}

test('Vorrakan carries two chains of 150 HP, and the grab is a two-charge relic with advantage', async () => {
  const { vor } = await setup();
  assert.deepEqual(vor.chains.map(c => [c.name, c.hp]), [['Left Chain', 150], ['Right Chain', 150]]);
  const ab = chainsAbility(vor);
  assert.equal(ab.maxCharges, 2);
  assert.ok(ab.tags.includes('adv'));
});

test('a hit on Vorrakan lands on the free chains instead, evenly', async () => {
  const { vor } = await setup();
  const hp = vor.currentHp;
  guard(vor);
  L.applyDamage(vor, 20, 'physical', ['physical']);
  assert.equal(vor.currentHp, hp);
  assert.deepEqual(vor.chains.map(c => c.hp), [140, 140]);
});

test('an unblockable hit goes through the chains', async () => {
  const { vor } = await setup();
  const hp = vor.currentHp;
  guard(vor);
  L.applyDamage(vor, 20, 'physical', ['physical', 'unblockabled']);
  assert.equal(vor.currentHp, hp - 20);
  assert.deepEqual(vor.chains.map(c => c.hp), [150, 150]);
});

test('what a chain cannot hold reaches Vorrakan, and a chain at 0 HP is broken', async () => {
  const { vor } = await setup();
  vor.chains[0].hp = 4; vor.chains[1].hp = 150;
  const hp = vor.currentHp;
  guard(vor);
  L.applyDamage(vor, 20, 'physical', ['physical']);
  assert.equal(vor.chains[0].hp, 0);
  assert.equal(vor.chains[1].hp, 140);
  assert.equal(vor.currentHp, hp - 6, 'the 6 the left chain could not take');
  assert.ok(/shatters/.test(logText()));
});

test('with no chain left the guard is gone and the grab cannot be cast', async () => {
  const { vor } = await setup();
  vor.chains.forEach(c => { c.hp = 0; });
  assert.ok(!L.abilityAvailable(vor, chainsAbility(vor)));
  const hp = vor.currentHp;
  L.applyDamage(vor, 10, 'physical', ['physical']);
  assert.equal(vor.currentHp, hp - 10);
});

test('the grab stuns and roots its target, drains HP and slots at once, and costs a charge', async () => {
  const { vor, foe } = await setup();
  const hp = foe.currentHp, slots = foe.spellSlots, mine = vor.currentHp;
  vor.currentHp = vor.maxHp - 30;
  await grab(vor, foe);
  const names = foe.statusEffects.map(e => e.name);
  assert.ok(names.includes('stun') && names.includes('root'), names.join());
  const chain = vor.chains.find(c => c.holdingId === foe.id);
  assert.ok(chain, 'one chain holds him');
  const lost = hp - foe.currentHp;
  assert.ok(lost >= 11 && lost <= 20, `drained ${lost}`);
  assert.ok(foe.spellSlots < slots || slots === 0, 'slots drained');
  assert.ok(vor.currentHp > mine - 30 || vor.currentHp === vor.maxHp - 30 + lost, 'Vorrakan took the HP');
  assert.equal(vor.remainingCharges['Chains of Apophis'], 1);
});

test('the chain that holds a prisoner no longer guards Vorrakan', async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  const holder = vor.chains.find(c => c.holdingId === foe.id);
  const other = vor.chains.find(c => c !== holder);
  const hp = vor.currentHp;
  guard(vor);
  L.applyDamage(vor, 20, 'physical', ['physical']);
  assert.equal(holder.hp, 150);
  assert.equal(other.hp, 130, 'the free chain takes all 20');
  assert.equal(vor.currentHp, hp);
});

test('the prisoner is drained again at the start of each of its turns', async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  const hp = foe.currentHp;
  for (let i = 0; i < 20 && foe.currentHp === hp; i++) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.ok(foe.currentHp < hp, 'a further drain');
});

test("the prisoner's allies free it by dealing 50 to the chain through it", async () => {
  const { vor, foe, mate } = await setup();
  await grab(vor, foe);
  const holder = vor.chains.find(c => c.holdingId === foe.id);
  const hp = foe.currentHp;
  toTurn('Eragon');
  L.applyDamage(foe, 30, 'physical', ['physical']);
  assert.equal(foe.currentHp, hp, 'the blow went to the chain');
  assert.equal(holder.hp, 120);
  assert.equal(holder.holdingId, foe.id, 'not yet free');
  L.applyDamage(foe, 20, 'physical', ['physical']);
  assert.equal(holder.hp, 100);
  assert.equal(holder.holdingId, null, '50 dealt: released');
  assert.ok(!foe.statusEffects.some(e => e.name === 'stun' || e.name === 'root'));
  assert.equal(foe.currentHp, hp);
  assert.ok(mate);
});

test("blows from Vorrakan's side land on the prisoner normally", async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  toTurn(VOR);
  const hp = foe.currentHp, holder = vor.chains.find(c => c.holdingId === foe.id);
  L.applyDamage(foe, 10, 'physical', ['physical']);
  assert.ok(foe.currentHp < hp);
  assert.equal(holder.hp, 150);
});

test('a broken chain lets its prisoner go', async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  const holder = vor.chains.find(c => c.holdingId === foe.id);
  holder.hp = 10;
  toTurn('Eragon');
  L.applyDamage(foe, 15, 'physical', ['physical']);
  assert.equal(holder.hp, 0);
  assert.equal(holder.holdingId, null);
  assert.ok(!foe.statusEffects.some(e => e.name === 'stun'));
});

test('when Vorrakan falls his prisoner is freed', async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  L.applyDamage(vor, 5000, 'physical', ['physical', 'unblockabled']);
  assert.ok(vor.isKO);
  assert.ok(!foe.statusEffects.some(e => e.name === 'stun' || e.name === 'root'));
});

test('a snapshot restores the chains', async () => {
  const { snapshot, restore } = await import('../js/ai/snapshot.js');
  const { vor } = await setup();
  const snap = snapshot();
  guard(vor);
  L.applyDamage(vor, 40, 'physical', ['physical']);
  assert.deepEqual(vor.chains.map(c => c.hp), [130, 130]);
  restore(snap);
  assert.deepEqual(vor.chains.map(c => c.hp), [150, 150]);
});

// ── Guard as a react ───────────────────────────────────────────────────────

test('without Chain Guard the chains do not take the hit', async () => {
  const { vor } = await setup();
  const hp = vor.currentHp;
  L.applyDamage(vor, 20, 'physical', ['physical']);
  assert.equal(vor.currentHp, hp - 20);
  assert.deepEqual(vor.chains.map(c => c.hp), [150, 150]);
});

test('Chain Guard is offered as a react while a chain is free, and not when none is', async () => {
  const { vor } = await setup();
  assert.ok(L.getReacts(vor).some(a => a.name === 'Chain Guard'));
  vor.chains.forEach(c => { c.hp = 0; });
  assert.ok(!L.getReacts(vor).some(a => a.name === 'Chain Guard'));
});

test('answering a blow with Chain Guard sends it to the chains, and only that blow', async () => {
  const { vor, foe } = await setup();
  const hp = vor.currentHp;
  toTurn('Kadgar');
  forceD20(19, 19);
  L.handleAttack(foe.id, vor.id);
  assert.ok(S.awaitingReact, 'Vorrakan is asked');
  const option = S.reactOptions.find(o => o.ability.name === 'Chain Guard');
  assert.ok(option, 'Chain Guard is among the options');
  L.resumePendingAction(option.ability);
  S.awaitingReact = false;
  assert.equal(vor.currentHp, hp, 'Vorrakan took nothing');
  assert.ok(vor.chains.some(c => c.hp < 150), 'the chains took it');
  assert.ok(!vor.statusEffects.some(e => e.name === 'chain_guard'), 'the guard did not outlast the action');
});

// ── The grab: Authority 5 ──────────────────────────────────────────────────

async function duelAgainst(name, seed = 2) {
  await newFight({ teamA: [VOR, 'Rox'], teamB: [name, 'Eragon'], seed });
  const vor = byName(VOR), foe = byName(name);
  vor.x = 10; vor.y = 10; foe.x = 11; foe.y = 10;
  return { vor, foe };
}

test('plain status immunities do not stop the grab: Escanor is held', async () => {
  const { vor, foe } = await duelAgainst('Escanor');
  assert.ok(foe.sourceChar.immunities.includes('status'));
  await grab(vor, foe);
  assert.ok(foe.statusEffects.some(e => e.name === 'stun'));
  assert.ok(vor.chains.some(c => c.holdingId === foe.id));
});

test('Hela and Chronos, whose immunity has an Authority gate above 5, turn the chain aside', async () => {
  for (const name of ['Hela, Goddess of Death', 'Chronos, Monarch of Time']) {
    const { vor, foe } = await duelAgainst(name);
    await grab(vor, foe);
    assert.ok(!foe.statusEffects.some(e => e.name === 'stun'), name);
    assert.ok(vor.chains.every(c => c.holdingId == null), name);
  }
});

test('no Cleanse lifts a chain: only damage to the chain does', async () => {
  const { vor, foe } = await setup();
  await grab(vor, foe);
  L.applyCleanse(foe);
  assert.ok(foe.statusEffects.some(e => e.name === 'stun') && foe.statusEffects.some(e => e.name === 'root'));
  assert.ok(vor.chains.some(c => c.holdingId === foe.id));
});
