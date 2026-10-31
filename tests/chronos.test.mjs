import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { setRandom } = await import('../js/rng.js');
const { S } = L;

const CHRONOS = 'Chronos, Monarch of Time';
const roster = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const sheet = roster.find(c => c.nom === CHRONOS);

const byName = name => S.combatants.find(c => c.name.startsWith(name));
const toTurn = name => {
  for (let i = 0; i < 80 && !L.activeCombatant().name.startsWith(name); i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.ok(L.activeCombatant().name.startsWith(name), `reached ${name}'s turn`);
  return L.activeCombatant();
};
const place = (c, x, y) => { c.x = x; c.y = y; };
function freeRun(len) {
  const { cols, rows } = S.currentMap.grid;
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - len; x++) {
    let ok = true;
    for (let i = 0; i <= len && ok; i++) ok = isWalkableG(S.currentMap, x + i, y) && !L.isOccupied(x + i, y);
    if (ok) return { x, y };
  }
  throw new Error('no free run on the map');
}
const ability = (c, name) => c.abilities.find(a => a.name === name);
const logText = () => S.log.map(e => e.text).join('\n');

// The next d20s come out as `values`; then every die lands in the middle
function forceD20(...values) {
  const queue = values.map(v => (v - 0.5) / 20);
  setRandom(() => (queue.length ? queue.shift() : 0.5));
}
const settle = () => { for (let i = 0; i < 10 && S.awaitingReact; i++) L.handleReactNo(); };

async function duel(foe, seed = 1) {
  await newFight({ teamA: [CHRONOS], teamB: [foe], seed });
  const x = byName('Chronos'), y = byName(foe);
  const spot = freeRun(5);
  place(x, spot.x, spot.y);
  place(y, spot.x + 1, spot.y);
  toTurn('Chronos');
  return { x, y };
}

// ── The sheet ──────────────────────────────────────────────────────────────

test('Chronos is on the roster as a primordial god: Authority 9, immune to status, a Complet domain', () => {
  assert.ok(sheet, 'he is in characters.json');
  assert.equal(sheet.autority, 9);
  assert.deepEqual(sheet.immunities, ['status']);
  assert.ok(sheet.passif.some(p => p.authorityGate === 9), 'his status immunity gives way to Authority 9 only');
  assert.equal(sheet.domain.name, 'Chronostasis');
  assert.equal(sheet.domain.type, 'Complet');
  assert.equal(sheet.domain.rafinement, 7);
});

test('Archive of Ibis gives advantage on attack rolls, spell rolls and defense rolls', () => {
  const p = sheet.passif.find(q => q.nom === 'Archive of Ibis');
  assert.ok(p.tags.includes('adv'));
  assert.deepEqual([...p.applyOn].sort(), ['atkRoll', 'defRoll', 'magicRoll']);
});

test('the four gods he took are in his kit, none of them by name', () => {
  const text = JSON.stringify(sheet).toLowerCase();
  for (const god of ['norn', 'thoth', 'kala', 'janus']) assert.ok(!text.includes(god), god);
  for (const move of ['Three Threads', 'Withering Hour', 'Two-Faced Door']) assert.ok(sheet.moveSet.some(m => m.base.nom === move), move);
  assert.equal(sheet.moveSet.find(m => m.base.nom === 'Three Threads').charges, 3, 'one thread per Norn');
});

// ── Stasis ─────────────────────────────────────────────────────────────────

test('Stasis stuns Hela despite her status immunity, because Authority 9 beats her gate of 8', async () => {
  const { x, y } = await duel('Hela, Goddess of Death');
  forceD20(19, 19, 2);
  L.handleCastAbility(x.id, 'Stasis', [y.id]);
  settle();
  assert.ok(y.statusEffects.some(e => e.name.toLowerCase() === 'stun'), logText());
});

// ── Withering Hour ─────────────────────────────────────────────────────────

test('Withering Hour rots the target and arms Chronos: his landed basic attacks then cut max HP, and the cuts stack', async () => {
  const { x, y } = await duel('White');
  forceD20(19, 19, 2);
  L.handleCastAbility(x.id, 'Withering Hour', [y.id]);
  settle();
  assert.ok(x.statusEffects.some(e => e.name === 'withering'), 'Chronos is armed');
  assert.ok(y.statusEffects.some(e => /decay/i.test(e.name)), 'the target is decaying');
  const max0 = y.maxHp;
  for (let n = 1; n <= 2; n++) {
    toTurn('Chronos');
    x.statusEffects.find(e => e.name === 'withering').turnsLeft = 3;
    forceD20(19, 19, 2);
    L.handleAttack(x.id, y.id);
    settle();
    assert.equal(y.maxHp, max0 - 25 * n, `after hit ${n}`);
    assert.ok(y.currentHp <= y.maxHp);
  }
});

test('without Withering Hour a basic attack leaves max HP alone', async () => {
  const { x, y } = await duel('Kaelgrym');
  const max0 = y.maxHp;
  forceD20(19, 19, 2);
  L.handleAttack(x.id, y.id);
  settle();
  assert.equal(y.maxHp, max0);
  assert.ok(y.currentHp < max0, 'but the hit landed');
});

// ── Hand of the Hour ───────────────────────────────────────────────────────

test('his basic attack walks through Hela\'s Weapon Wall', async () => {
  const { x, y } = await duel('Hela, Goddess of Death');
  y.statusEffects.push({ name: 'damage_shield', shieldHp: 40, turnsLeft: 5, dice: null, damType: null, notes: '' });
  const before = y.currentHp;
  forceD20(19, 19, 19, 2, 2);   // Death Presence makes the first attack clumsy, so give it plenty of good dice
  L.handleAttack(x.id, y.id);
  settle();
  const shield = y.statusEffects.find(e => e.name === 'damage_shield');
  assert.equal(shield?.shieldHp, 40, 'the wall is untouched');
  assert.ok(y.currentHp < before, logText());
});

// ── Rewind ─────────────────────────────────────────────────────────────────

test('a killing blow sends Chronos back: HP restored, hindrances undone, once per fight', async () => {
  const { x } = await duel('Kaelgrym');
  x.statusEffects.push({ name: 'burn', turnsLeft: 3, dice: '1d4', damType: 'fire', notes: '' });
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.equal(x.isKO, false, 'he stands');
  assert.ok(x.currentHp >= 200, `HP ${x.currentHp}`);
  assert.equal(x.statusEffects.length, 0, 'the burning is undone');
  assert.ok(x.usedThisFight.includes('Rewind'));
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.equal(x.isKO, true, 'the second death is final');
});

test('Rewind returns him to where he stood two rounds ago, when that cell is free', async () => {
  const { x } = await duel('Kaelgrym');
  x.trail = [{ hp: 400, x: x.x - 1, y: x.y }, { hp: 300, x: x.x, y: x.y }];
  const home = { x: x.x - 1, y: x.y };
  L.applyDamage(x, 10000, 'physical', ['physical'], true);
  assert.deepEqual({ x: x.x, y: x.y }, home);
  assert.equal(x.currentHp, 400);
});

test('Rewind is not a move to cast, and Borrowed Time is not a reaction', async () => {
  const { x } = await duel('Kaelgrym');
  assert.equal(ability(x, 'Rewind').reactOnly, true);
  assert.ok(ability(x, 'Rewind').tags.includes('onDeath'));
  assert.ok(ability(x, 'Borrowed Time').tags.includes('extraAction'));
});

// ── Borrowed Time ──────────────────────────────────────────────────────────

test('Borrowed Time gives the action back after he has acted, and only once', async () => {
  const { x, y } = await duel('Kaelgrym');
  S.hasActed = true;   // he has already acted this turn
  L.handleCastAbility(x.id, 'Borrowed Time', [x.id]);
  settle();
  assert.equal(S.hasActed, false, 'and may act again');
  assert.ok(x.usedThisFight.includes('Borrowed Time'));
  assert.ok(!L.abilityAvailable(x, ability(x, 'Borrowed Time')), 'once per fight');
});

// ── The round trail ────────────────────────────────────────────────────────

test('each new round records where every unit stands, two rounds deep', async () => {
  const { x } = await duel('Kaelgrym');
  const startRound = S.roundNumber;
  while (S.roundNumber < startRound + 3) { if (S.awaitingReact) L.handleReactNo(); else L.handlePass(); }
  assert.equal(x.trail.length, 2);
  assert.ok(x.trail.every(t => Number.isInteger(t.hp) && Number.isInteger(t.x)));
});

// ── Decay ──────────────────────────────────────────────────────────────────

test('Decay hurts with one more die each turn it lasts, and ignores nothing it should not', async () => {
  const { y } = await duel('White');
  L.applyStatus(y, 'decay');
  const eff = y.statusEffects.find(e => e.name === 'Decay');
  assert.ok(eff, 'applied by name');
  assert.equal(eff.turnsLeft, 5);
  assert.equal(L.grownDice({ dice: '1d6', ticks: 0 }), '1d6');
  assert.equal(L.grownDice({ dice: '1d6', ticks: 3 }), '4d6');
  const hp = [y.currentHp];
  for (let i = 0; i < 3; i++) { L.tickTurn(y); hp.push(y.currentHp); }
  const lost = hp.slice(1).map((v, i) => hp[i] - v);
  assert.ok(lost[0] >= 1 && lost[0] <= 6 && lost[1] >= 2 && lost[1] <= 12 && lost[2] >= 3 && lost[2] <= 18, lost.join(','));
  assert.equal(eff.ticks, 3);
});

test('the bot counts a decay for what it will still do, which is more than the same poison', async () => {
  const { evaluate } = await import('../js/ai/evaluate.js');
  const { y } = await duel('White');
  const clean = evaluate(0);
  y.statusEffects.push({ name: 'Poison', turnsLeft: 3, dice: '1d6', damType: 'poison', notes: '' });
  const poisoned = evaluate(0);
  y.statusEffects = [{ name: 'Decay', turnsLeft: 3, dice: '1d6', damType: 'necro', notes: '' }];
  const decaying = evaluate(0);
  assert.ok(poisoned > clean && decaying > poisoned);
});

// ── Chronostasis ───────────────────────────────────────────────────────────

test('Chronostasis gives its owner a random boon each turn instead of hurting foes: data', () => {
  const eff = sheet.domain.effects;
  const boon = eff.find(e => e.applyOn.includes('turnBoon'));
  assert.deepEqual(boon.boons, { hp: 40, slots: 2, charges: 1 });
  assert.ok(!eff.some(e => e.applyOn.includes('hpPerTurn') || e.applyOn.includes('autority')), 'no aura on foes');
  assert.ok(eff.some(e => e.condition?.moveName === 'Withering Hour' && e.applyOn.includes('cooldown')));
  assert.ok(eff.some(e => e.condition?.moveName === 'Stasis' && e.tags.includes('undodgeable')));
});

test('the boon is life, slots or a Thread, each drawn at random, and never one that is already full', async () => {
  const { x } = await duel('White');
  const boon = sheet.domain.effects.find(e => e.applyOn.includes('turnBoon'));
  const drawn = (r) => {
    x.currentHp = x.maxHp - 100; x.spellSlots = x.maxSpellSlots - 5; x.remainingCharges['Three Threads'] = 1;
    const hp = x.currentHp, slots = x.spellSlots;
    setRandom(() => r);
    L.grantBoon(x, boon);
    if (x.currentHp > hp) return 'hp';
    if (x.spellSlots > slots) return 'slots';
    if (x.remainingCharges['Three Threads'] > 1) return 'thread';
    return 'none';
  };
  assert.equal(drawn(0.05), 'hp');
  assert.equal(drawn(0.5), 'slots');
  assert.equal(drawn(0.95), 'thread');
  assert.equal(x.remainingCharges['Three Threads'], 2);
  // everything full: nothing happens
  x.currentHp = x.maxHp; x.spellSlots = x.maxSpellSlots; x.remainingCharges['Three Threads'] = 3;
  setRandom(() => 0.5);
  L.grantBoon(x, boon);
  assert.equal(x.remainingCharges['Three Threads'], 3);
  // a full Thread counter is not drawn: only life and slots remain
  x.currentHp = x.maxHp - 100; x.spellSlots = x.maxSpellSlots - 5;
  setRandom(() => 0.99);
  const slots = x.spellSlots;
  L.grantBoon(x, boon);
  assert.ok(x.spellSlots > slots, 'the last of two options is slots');
});

test('the boon does not fire when Chronos has no domain open, and does when he is the domain owner starting his turn', async () => {
  const { x } = await duel('White');
  x.currentHp = x.maxHp - 200;
  S.activeDomains = [];
  const before = x.currentHp;
  L.beginTurn(x);
  assert.ok(x.currentHp <= before, 'no domain, no boon (the turn start only drains)');
  S.activeDomains = [{ casterId: x.id, domain: sheet.domain, centerX: x.x, centerY: x.y }];
  let moved = false;
  for (let i = 0; i < 12 && !moved; i++) {
    x.currentHp = x.maxHp - 200; x.spellSlots = x.maxSpellSlots - 5; x.remainingCharges['Three Threads'] = 1;
    const a = [x.currentHp, x.spellSlots, x.remainingCharges['Three Threads']];
    L.beginTurn(x);
    moved = x.currentHp > a[0] || x.spellSlots > a[1] || x.remainingCharges['Three Threads'] > a[2];
  }
  assert.ok(moved, 'a boon arrived');
});

// ── The site sheet ─────────────────────────────────────────────────────────

test('main.js has his sheet, his domain, the Decay effect and the Guild entry', async () => {
  const m = await import('../js/main.js');
  const s = m.personnageSheet.find(c => c.name === 'Chronos, Monarch of Time');
  assert.ok(s);
  assert.equal(s.hp, sheet.hp);
  assert.equal(s.spellSlots, sheet.spellSlot);
  assert.equal(m.domainData.Chronos.name, sheet.domain.name);
  assert.ok(m.EFFECTS.some(e => e.name === 'Decay' && e.type === 'necro'));
  assert.match(m.factions.find(f => f.slug === 'the-guild').text, /Guildmaster, Chronos/);
  assert.doesNotMatch(JSON.stringify(m.factions.find(f => f.slug === 'the-guild')), /god|time/i, 'the Guild does not know what he is');
  const text = JSON.stringify(s).toLowerCase();
  for (const god of ['norn', 'thoth', 'kala', 'janus']) assert.ok(!text.includes(god), god);
});

// ── Stasis lasts, spells cost one, a natural 20 cannot be answered ─────────

test('every spell of his costs one slot', () => {
  for (const m of sheet.moveSet.filter(m => m.category === 'spell')) assert.equal(m.spellCost, 1, m.base.nom);
});

test('Stasis keeps the target out of two full turns, then it acts again', async () => {
  const { x, y } = await duel('Kaelgrym');
  L.handleCastAbility(x.id, 'Stasis', [y.id]);
  settle();
  const skipped = [];
  for (let i = 0; i < 12 && skipped.length < 3; i++) {
    if (S.awaitingReact) { L.handleReactNo(); continue; }
    const c = L.activeCombatant();
    if (c === y) skipped.push(y.statusEffects.some(e => e.name.toLowerCase() === 'stun'));
    L.handlePass();
  }
  const log = logText();
  assert.equal((log.match(/Kaelgrym is Stun and cannot act/g) ?? []).length, 2, log);
  assert.match(log, /Kaelgrym's Stun wears off/);
});

test('a natural 20 that lands offers the defender no reaction, a plain hit still does', async () => {
  const { x, y } = await duel('Zhuqiao, Vermillion Bird');
  forceD20(20, 4, 10);
  L.handleAttack(x.id, y.id);
  assert.equal(S.awaitingReact, false, 'no react prompt after a natural 20');
  assert.match(logText(), /natural 20 leaves no time to react/);
  settle();
  toTurn('Chronos');
  place(y, x.x + 1, x.y);
  forceD20(15, 14, 3);
  L.handleAttack(x.id, y.id);
  assert.equal(S.awaitingReact, true, 'an ordinary hit can still be answered');
  settle();
});
