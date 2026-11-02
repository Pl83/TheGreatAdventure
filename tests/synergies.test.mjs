import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installShims, newFight } from '../tools/headless.mjs';
import { buffEffects, TECHNIQUES, techniqueFielded, techniqueStanding, techniqueOf } from '../js/synergies.js';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const byName = name => S.combatants.find(c => c.name === name);
const toTurn = name => {
  for (let i = 0; i < 80 && L.activeCombatant().name !== name; i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.equal(L.activeCombatant().name, name);
  return L.activeCombatant();
};
const settle = () => { for (let i = 0; i < 20 && S.awaitingReact; i++) L.handleReactNo(); };
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
const logText = () => S.log.map(l => l.text ?? l.msg ?? String(l)).join('\n');
const namesOf = (c, applyOn, ability = null) => L.rollBonuses(c, applyOn, null, ability).map(b => b.nom);

// A unit as the pure rules see it
let uid = 0;
const unit = (name, x = 0, y = 0) => {
  const sheet = roster.find(c => c.nom === name);
  return { id: ++uid, name, x, y, sourceChar: { faction: sheet?.faction ?? [] } };
};
const effects = (me, ...mates) => buffEffects(me, [me, ...mates]).map(e => `${e.nom} ${e.dices} ${e.applyOn.join('+')}${e.ifTag ? ' @' + e.ifTag : ''}`);

// ── 1. Ninja Teamwork ──────────────────────────────────────────────────────

test('Ninja Teamwork: 2 ninjas move and roll initiative better, 3 add +1 on rolls, 4 add +2 instead', () => {
  const kay = unit('Kay Climber');
  assert.deepEqual(effects(kay), [], 'alone: nothing');
  const two = effects(kay, unit('Pixal')).filter(e => e.startsWith('Ninja'));
  assert.deepEqual(two, ['Ninja Teamwork +2 initRoll', 'Ninja Teamwork +1 speed']);
  const three = effects(kay, unit('Pixal'), unit('Sora')).filter(e => e.startsWith('Ninja'));
  assert.ok(three.includes('Ninja Teamwork +1 allRolls'));
  const four = effects(kay, unit('Pixal'), unit('Sora'), unit('Arin')).filter(e => e.startsWith('Ninja'));
  assert.ok(four.includes('Ninja Teamwork +2 allRolls') && !four.includes('Ninja Teamwork +1 allRolls'));
});

test('Ninja Teamwork: only ninjas gain it', () => {
  const alicia = unit('Alicia');
  assert.deepEqual(effects(alicia, unit('Kay Climber'), unit('Pixal')), []);
});

test('Ninja Teamwork in a fight: speed, and a bonus on defense rolls from three ninjas', async () => {
  await newFight({ teamA: ['Kay Climber', 'Pixal', 'Sora'], teamB: ['Kadgar'], seed: 3 });
  const kay = byName('Kay Climber');
  assert.equal(L.moveSpeed(kay), 6 + 1);
  assert.ok(namesOf(kay, 'defRoll').includes('Ninja Teamwork'));
  assert.ok(namesOf(kay, 'atkRoll').includes('Ninja Teamwork'));
  assert.ok(!namesOf(byName('Kadgar'), 'defRoll').includes('Ninja Teamwork'));
});

test('Ninja Teamwork: a fallen ninja takes the tier down', async () => {
  await newFight({ teamA: ['Kay Climber', 'Pixal', 'Sora'], teamB: ['Kadgar'], seed: 3 });
  byName('Sora').isKO = true;
  assert.ok(!namesOf(byName('Kay Climber'), 'defRoll').includes('Ninja Teamwork'), 'two ninjas: speed and initiative only');
  assert.equal(L.moveSpeed(byName('Kay Climber')), 7);
  byName('Pixal').isKO = true;
  assert.equal(L.moveSpeed(byName('Kay Climber')), 6);
});

// ── 2. Elemental Kin ───────────────────────────────────────────────────────

test('Elemental Kin: two ninjas of one element add 1d4 to moves of that element only', async () => {
  await newFight({ teamA: ['Kay Climber', 'Kay Demon'], teamB: ['Kadgar'], seed: 3 });
  const kay = byName('Kay Climber');
  const fire = { tags: ['fire'] }, ice = { tags: ['ice'] };
  assert.ok(namesOf(kay, 'atkRoll', fire).includes('Elemental Kin'));
  assert.ok(!namesOf(kay, 'atkRoll', ice).includes('Elemental Kin'));
  assert.ok(!namesOf(kay, 'atkRoll', null).includes('Elemental Kin'));
});

test('Elemental Kin: ninjas of different elements get nothing', () => {
  assert.ok(!effects(unit('Kay Climber'), unit('Zane Climber')).some(e => e.startsWith('Elemental Kin')));
  assert.ok(effects(unit('Zane Climber'), unit('Ivo')).some(e => e === 'Elemental Kin +1d4 atkRoll @ice'));
});

// ── 5. Mecha Link ──────────────────────────────────────────────────────────

// ── 6. Siblings ────────────────────────────────────────────────────────────

test('Siblings: Kay and Nya each take 1d4 less while the other stands', async () => {
  const hit = async (withNya) => {
    await newFight({ teamA: withNya ? ['Kay Climber', 'Nya Léviathan'] : ['Kay Climber', 'Pixal'], teamB: ['Kadgar'], seed: 3 });
    const kay = byName('Kay Climber');
    setRandom(() => 0.5);
    const before = kay.currentHp;
    L.applyDamage(kay, 20, 'physical', ['physical']);
    return before - kay.currentHp;
  };
  const with_ = await hit(true), without = await hit(false);
  assert.ok(with_ < without, `${with_} vs ${without}`);
});

test('Siblings: when one is hit, the other gets +2 on its next defense roll, once', async () => {
  await newFight({ teamA: ['Kay Climber', 'Nya Léviathan'], teamB: ['Kadgar'], seed: 3 });
  const kay = byName('Kay Climber'), nya = byName('Nya Léviathan'), foe = byName('Kadgar');
  const base = L.defenseBonus(nya, foe, null);
  setRandom(() => 0.5);
  L.applyDamage(kay, 10, 'physical', ['physical']);
  assert.ok(nya.statusEffects.some(e => e.name === 'sibling_guard'));
  assert.equal(L.defenseBonus(nya, foe, null), base + 2);
  forceD20(10, 10);
  L.resolveAttack(foe, nya, '1d4');
  assert.ok(!nya.statusEffects.some(e => e.name === 'sibling_guard'), 'spent by the roll');
});

// ── 7. Sensei's Guidance ───────────────────────────────────────────────────

test('Sensei\'s Guidance: Lloyd with two more ninjas steadies every ally in reach', async () => {
  await newFight({ teamA: ['Sensei Lloyd', 'Kay Climber', 'Pixal', 'Alicia'], teamB: ['Kadgar'], seed: 3 });
  const lloyd = byName('Sensei Lloyd'), alicia = byName('Alicia'), kay = byName('Kay Climber');
  lloyd.x = 5; lloyd.y = 5; alicia.x = 8; alicia.y = 5; kay.x = 5; kay.y = 6;
  assert.ok(namesOf(alicia, 'defRoll').includes("Sensei's Guidance"), 'a non-ninja ally in reach');
  assert.ok(namesOf(lloyd, 'defRoll').includes("Sensei's Guidance"), 'Lloyd himself');
  alicia.x = 20; alicia.y = 5;
  assert.ok(!namesOf(alicia, 'defRoll').includes("Sensei's Guidance"), 'too far');
});

test('Sensei\'s Guidance: he needs two more ninjas', async () => {
  await newFight({ teamA: ['Sensei Lloyd', 'Kay Climber', 'Alicia'], teamB: ['Kadgar'], seed: 3 });
  const lloyd = byName('Sensei Lloyd');
  assert.ok(!namesOf(lloyd, 'defRoll').includes("Sensei's Guidance"));
});

// ── 9. Storm Pair ──────────────────────────────────────────────────────────

test('Storm Pair: Mira, Libber and Jay add 1d6 to lightning moves, in pairs', () => {
  const storm = (me, ...m) => effects(me, ...m).includes('Storm Pair +1d6 atkRoll @lightning');
  assert.ok(storm(unit('Mira'), unit('Libber')));
  assert.ok(storm(unit('Jay Climber'), unit('Libber')));
  assert.ok(storm(unit('Jay Climber'), unit('Mira')));
  assert.ok(!storm(unit('Mira'), unit('Kay Climber')));
  assert.ok(!storm(unit('Mira')));
});

test('Storm Pair: a lightning hit from the pair can paralyse, and a bonus hit makes it certain', async () => {
  await newFight({ teamA: ['Mira', 'Libber'], teamB: ['Kadgar'], seed: 3 });
  const mira = toTurn('Mira'), foe = byName('Kadgar');
  const lightning = { name: 'Zap', tags: ['lightning'] };
  foe.statusEffects = [];
  L.applyMoveEffect(lightning, foe, true);
  assert.ok(foe.statusEffects.some(e => /para/i.test(e.name)), 'certain on a bonus hit');
  foe.statusEffects = [];
  L.applyMoveEffect({ name: 'Smack', tags: ['physical'] }, foe, true);
  assert.ok(!foe.statusEffects.some(e => /para/i.test(e.name)), 'not on a physical move');
  assert.ok(mira);
});

// ── Techniques: the rules ──────────────────────────────────────────────────

test('techniques: each key is carried by the sheets that should have it, and by nobody else', () => {
  for (const [key, tech] of Object.entries(TECHNIQUES)) {
    const holders = roster.filter(c => c.moveSet?.some(m => techniqueOf({ tags: m.base.tags }) === key)).map(c => c.nom).sort();
    assert.deepEqual(holders, [...tech.members].sort(), key);
  }
});

test('techniques: fielded and standing are counted separately', () => {
  const fielded = names => names.map(name => ({ name }));
  const dm = TECHNIQUES.dragonMasters, cs = TECHNIQUES.climberSpinjitzu;
  assert.ok(techniqueFielded(dm, fielded(['Kay Climber', 'Cole Climber'])));
  assert.ok(!techniqueFielded(dm, fielded(['Kay Climber'])));
  assert.ok(!techniqueFielded(cs, fielded(['Kay Climber', 'Jay Climber', 'Zane Climber'])), 'Nya does not replace Cole');
  assert.ok(techniqueFielded(cs, fielded(['Kay Climber', 'Jay Climber', 'Zane Climber', 'Cole Climber'])), 'Nya is optional');
  assert.equal(techniqueStanding(cs, fielded(['Kay Climber', 'Nya Léviathan', 'Alicia'])), 2);
});

// ── 3. Climber Spinjitzu ───────────────────────────────────────────────────

const CLIMBERS = ['Kay Climber', 'Jay Climber', 'Zane Climber', 'Cole Climber'];
const has = (c, name) => c.abilities.find(a => a.name === name);
const usable = (n, name) => L.abilityAvailable(byName(n), has(byName(n), name));

async function strike(team, who, abilityName, foeName = 'Kadgar') {
  await newFight({ teamA: team, teamB: [foeName], seed: 2 });
  const foe = byName(foeName), me = toTurn(who);
  foe.currentHp = foe.maxHp = 3000;
  foe.statusEffects = [];
  forceD20(19, 2);
  L.handleCastAbility(me.id, abilityName, [foe.id], { x: foe.x, y: foe.y });
  settle();
  return { me, foe };
}

test('Climber Spinjitzu: the four Climbers fielded, Nya or not; three do not make it', async () => {
  await newFight({ teamA: [...CLIMBERS, 'Nya Léviathan'], teamB: ['Kadgar'], seed: 2 });
  for (const n of [...CLIMBERS, 'Nya Léviathan']) assert.ok(usable(n, 'Climber Spinjitzu'), n);
  await newFight({ teamA: CLIMBERS, teamB: ['Kadgar'], seed: 2 });
  assert.ok(usable('Kay Climber', 'Climber Spinjitzu'));
  await newFight({ teamA: [...CLIMBERS.slice(0, 3), 'Nya Léviathan'], teamB: ['Kadgar'], seed: 2 });
  assert.ok(!usable('Kay Climber', 'Climber Spinjitzu'));
});

test('Climber Spinjitzu: 1d12 per member standing, once for the whole team', async () => {
  const { foe } = await strike([...CLIMBERS, 'Nya Léviathan'], 'Cole Climber', 'Climber Spinjitzu');
  assert.match(logText(), /5 of 5 still stand \(5d12\)/);
  assert.ok(foe.currentHp < foe.maxHp);
  for (const n of [...CLIMBERS, 'Nya Léviathan']) assert.ok(!usable(n, 'Climber Spinjitzu'), n);
});

test('Climber Spinjitzu: it needs two members standing', async () => {
  await newFight({ teamA: [...CLIMBERS, 'Nya Léviathan'], teamB: ['Kadgar'], seed: 2 });
  for (const n of ['Jay Climber', 'Zane Climber', 'Cole Climber']) byName(n).isKO = true;
  assert.ok(usable('Kay Climber', 'Climber Spinjitzu'), 'Kay and Nya stand');
  byName('Nya Léviathan').isKO = true;
  assert.ok(!usable('Kay Climber', 'Climber Spinjitzu'), 'Kay is alone');
});

test('Climber Spinjitzu twists: Kay burns, Cole knocks prone, Nya soaks', async () => {
  const kay = await strike(CLIMBERS, 'Kay Climber', 'Climber Spinjitzu');
  assert.ok(kay.foe.statusEffects.some(e => /burn/i.test(e.name)), 'burn');
  const cole = await strike(CLIMBERS, 'Cole Climber', 'Climber Spinjitzu');
  assert.ok(cole.foe.statusEffects.some(e => /prone/i.test(e.name)), 'prone');
  const nya = await strike([...CLIMBERS, 'Nya Léviathan'], 'Nya Léviathan', 'Climber Spinjitzu');
  assert.ok(nya.foe.statusEffects.some(e => /wet/i.test(e.name)) || L.isWet(nya.foe), 'wet');
});

// ── 4. Dragon Masters ──────────────────────────────────────────────────────

test('Dragon Masters: two Climbers fielded are enough, one is not', async () => {
  await newFight({ teamA: ['Kay Climber', 'Zane Climber', 'Alicia'], teamB: ['Kadgar'], seed: 2 });
  assert.ok(usable('Kay Climber', 'Dragon Masters Fury'));
  await newFight({ teamA: ['Kay Climber', 'Alicia'], teamB: ['Kadgar'], seed: 2 });
  assert.ok(!usable('Kay Climber', 'Dragon Masters Fury'));
});

test('Dragon Masters: 2d10 per Climber standing, in the element of whoever fires', async () => {
  const { foe } = await strike(['Jay Climber', 'Zane Climber', 'Cole Climber'], 'Jay Climber', 'Dragon Masters Fury');
  assert.match(logText(), /3 of 4 still stand \(6d10\)/);
  assert.ok(foe.currentHp < foe.maxHp);
  assert.ok(!usable('Zane Climber', 'Dragon Masters Fury'), 'the team has one breath');
  assert.ok(usable('Zane Climber', 'Climber Spinjitzu') === false, 'three Climbers fielded: no Spinjitzu');
});

// ── 8. Imperium Strike ─────────────────────────────────────────────────────

test('Imperium Strike: Sora, Arin and Wyldfire fielded, usable while two stand', async () => {
  await newFight({ teamA: ['Sora', 'Arin', 'Wyldfire'], teamB: ['Kadgar'], seed: 2 });
  for (const n of ['Sora', 'Arin', 'Wyldfire']) assert.ok(usable(n, 'Imperium Strike'), n);
  byName('Arin').isKO = true;
  assert.ok(usable('Sora', 'Imperium Strike'));
  byName('Wyldfire').isKO = true;
  assert.ok(!usable('Sora', 'Imperium Strike'));
  await newFight({ teamA: ['Sora', 'Arin'], teamB: ['Kadgar'], seed: 2 });
  assert.ok(!usable('Sora', 'Imperium Strike'), 'two fielded is not the trio');
});

test('Imperium Strike twists: Sora mends the team, Arin knocks the foes prone', async () => {
  await newFight({ teamA: ['Sora', 'Arin', 'Wyldfire'], teamB: ['Kadgar'], seed: 2 });
  const arin = byName('Arin'), foe = byName('Kadgar');
  arin.currentHp = 10;
  const sora = toTurn('Sora');
  foe.currentHp = foe.maxHp = 3000;
  forceD20(19, 2);
  L.handleCastAbility(sora.id, 'Imperium Strike', [foe.id], { x: foe.x, y: foe.y });
  settle();
  assert.ok(arin.currentHp > 10, 'Arin is mended');
  const a = await strike(['Sora', 'Arin', 'Wyldfire'], 'Arin', 'Imperium Strike');
  assert.ok(a.foe.statusEffects.some(e => /prone/i.test(e.name)), 'prone');
});
