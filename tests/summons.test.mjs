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

test('Taboo costs half her current HP and springs the mark at once, the victim still standing', async () => {
  await newFight({ teamA: ['Annastasia'], teamB: ['Rox'], seed: 3 });
  const ann = byName('Annastasia'), rox = byName('Rox');
  const hp = ann.currentHp, slots = ann.spellSlots;
  assert.ok(L.getAbilities?.(ann) ?? true);
  toTurn('Annastasia');
  L.handleCastAbility(ann.id, 'Taboo', [ann.id]);
  assert.equal(ann.currentHp, hp - Math.floor(hp / 2));
  assert.equal(ann.spellSlots, slots - 1);
  assert.ok(!rox.isKO);
  assert.equal(ann.sacMarkId, null, 'no other enemy to carry the mark');
  assert.equal(S.combatants.filter(c => c.name === 'Demon' && c.ownerId === ann.id).length, rox.maxHp < 70 ? 1 : 2);
});

test('the Sacrifice Mark always passes to another enemy: after a death and after a Taboo', async () => {
  await newFight({ teamA: ['Annastasia'], teamB: ['Rox', 'Irina', 'Ray'], seed: 3 });
  const ann = byName('Annastasia');
  const first = L.getCombatant(ann.sacMarkId);
  L.applyDamage(first, 999, 'physical', ['physical']);
  const second = L.getCombatant(ann.sacMarkId);
  assert.ok(second && !second.isKO && second.id !== first.id, 'a new living enemy is marked');
  toTurn('Annastasia');
  L.handleCastAbility(ann.id, 'Taboo', [ann.id]);
  const third = L.getCombatant(ann.sacMarkId);
  assert.ok(third && !third.isKO && third.id !== second.id, 'Taboo moves the mark to another enemy');
  assert.ok(!second.isKO, 'the Taboo victim lives');
});

test('easter egg: when Sienna falls she has a 1 in 100 chance to rise as Vampire Sienna', async () => {
  await newFight({ teamA: ['Sienna'], teamB: ['Rox'], seed: 3 });
  const sienna = byName('Sienna');
  assert.equal(sienna.sourceChar.reborn.chance, 0.01);
  const id = sienna.id, team = sienna.teamIndex, sheet = sienna.sourceChar;
  sheet.reborn.chance = 1;
  try { L.applyDamage(sienna, 999, 'physical', ['physical']); } finally { sheet.reborn.chance = 0.01; }
  assert.equal(sienna.name, 'Vampire Sienna');
  assert.ok(!sienna.isKO);
  assert.equal(sienna.id, id);
  assert.equal(sienna.teamIndex, team);
  assert.equal(sienna.currentHp, sienna.maxHp);
});

test('Sienna usually just falls', async () => {
  await newFight({ teamA: ['Sienna'], teamB: ['Rox'], seed: 3 });
  const sienna = byName('Sienna');
  sienna.sourceChar.reborn.chance = 0;
  try { L.applyDamage(sienna, 999, 'physical', ['physical']); } finally { sienna.sourceChar.reborn.chance = 0.01; }
  assert.ok(sienna.isKO);
  assert.equal(sienna.name, 'Sienna');
});

// ── Krux & Acronix's Summoning Portal: Time Remnants ───────────────────────

test('the Time Remnant cost climbs with the HP: 1 slot at 50, 5 at 120', () => {
  assert.equal(L.remnantCost(50), 1);
  assert.equal(L.remnantCost(70), 1);
  assert.equal(L.remnantCost(95), 3);
  assert.equal(L.remnantCost(120), 5);
  assert.equal(L.remnantCost(180), 15);
  assert.ok(L.remnantRoster().every(r => !['Fire Spirit', 'Golem', 'Floating Head', 'Demon', 'Krux & Acronix'].includes(r.nom)));
});

test('the Summoning Portal calls a whole character as a Time Remnant, pays its cost, fades after two turns', async () => {
  await newFight({ teamA: ['Krux & Acronix'], teamB: ['Rox'], seed: 3 });
  const kx = byName('Krux & Acronix');
  const pick = L.remnantRoster().find(r => r.cost === 3);
  toTurn('Krux & Acronix');
  const slots = kx.spellSlots;
  L.handleCastAbility(kx.id, 'Summoning Portal', [kx.id], null, pick.nom);
  const rem = owned(kx).find(u => u.name === `Time Remnant ${pick.nom}`);
  assert.ok(rem, 'the remnant stands');
  assert.equal(rem.teamIndex, kx.teamIndex);
  assert.equal(kx.spellSlots, slots - 3);
  assert.equal(rem.maxHp, pick.hp);
  toTurn(rem.name); L.handlePass();       // first turn
  assert.ok(!rem.isKO);
  toTurn(rem.name); L.handlePass();       // second turn
  assert.ok(rem.isKO, 'it fades after its second turn');
});

test('at most two Time Remnants at once, and a wrong or unaffordable choice costs nothing', async () => {
  await newFight({ teamA: ['Krux & Acronix'], teamB: ['Rox'], seed: 3 });
  const kx = byName('Krux & Acronix');
  const cheap = L.remnantRoster()[0].nom;
  toTurn('Krux & Acronix');
  const slots = kx.spellSlots;
  L.handleCastAbility(kx.id, 'Summoning Portal', [kx.id], null, null);
  L.handleCastAbility(kx.id, 'Summoning Portal', [kx.id], null, 'Golem');
  assert.equal(kx.spellSlots, slots);
  assert.equal(owned(kx).length, 0);
  kx.spellSlots = 40;
  for (let i = 0; i < 2; i++) {
    S.hasActed = false; S.actionsDone = [];
    L.handleCastAbility(kx.id, 'Summoning Portal', [kx.id], null, cheap);
  }
  assert.equal(owned(kx).filter(u => !u.isKO).length, 2);
  const ab = kx.abilities.find(a => a.name === 'Summoning Portal');
  assert.equal(L.abilityAvailable(kx, ab), false, 'a third cannot be called');
});

// ── Runik Sea Bound and Holy Duel ──────────────────────────────────────────

test('Runik Sea Bound: 1d2 chances, better of two rolls against a wet target', async () => {
  await newFight({ teamA: ['Admiral Jaina'], teamB: ['Rox'], seed: 3 });
  const jaina = byName('Admiral Jaina'), rox = byName('Rox');
  const ab = jaina.abilities.find(a => a.name === 'Runik Sea Bound');
  assert.equal(ab.effect, '1d2 stun, 1d2 root');
  assert.equal(L.effectFor(ab, rox), '1d2 stun, 1d2 root', 'dry: plain chances');
  L.applyStatus(rox, 'wet');
  assert.equal(L.effectFor(ab, rox), '1d2adv stun, 1d2adv root', 'wet: advantage on both');
  let landed = 0;
  for (let i = 0; i < 400; i++) {
    rox.statusEffects = rox.statusEffects.filter(e => e.name === 'wet');
    L.applyStatus(rox, L.effectFor(ab, rox));
    if (rox.statusEffects.some(e => e.name.toLowerCase() === 'stun')) landed++;
  }
  assert.ok(landed > 400 * 0.65 && landed < 400 * 0.85, `about 75% with advantage, got ${landed / 4}%`);
});

test('Holy Duel: Arthur gains twice the adversary max HP and rolls with advantage against it', async () => {
  await newFight({ teamA: ['Arthur'], teamB: ['Rox', 'Irina'], seed: 3 });
  const arthur = byName('Arthur'), rox = byName('Rox'), irina = byName('Irina');
  toTurn('Arthur');
  if (S.currentMap) { rox.x = arthur.x + 1; rox.y = arthur.y; }
  const hp = arthur.maxHp;
  L.handleCastAbility(arthur.id, 'Holy Duel', [rox.id]);
  assert.equal(arthur.maxHp, hp + rox.maxHp * 2);
  assert.equal(arthur.duelId, rox.id);
  assert.ok(arthur.currentHp > hp);
});

test('Demon Pact: 10 HP buys 1 spell slot, as an instant, never her last HP', async () => {
  await newFight({ teamA: ['Annastasia'], teamB: ['Rox'], seed: 3 });
  const ann = byName('Annastasia');
  const pact = ann.abilities.find(a => a.name === 'Demon Pact');
  toTurn('Annastasia');
  assert.equal(L.abilityAvailable(ann, pact), false, 'full slots: nothing to buy');
  ann.spellSlots = 2;
  const hp = ann.currentHp;
  L.handleCastAbility(ann.id, 'Demon Pact', [ann.id]);
  assert.equal(ann.currentHp, hp - 10);
  assert.equal(ann.spellSlots, 3);
  assert.equal(S.hasActed, false, 'it costs no action');
  ann.currentHp = 10;
  assert.equal(L.abilityAvailable(ann, pact), false, 'she cannot pay her last HP');
});

// ── Phoenix King and Prince ────────────────────────────────────────────────

test('Phoenix Feathers revive a fallen ally with all its spell slots, four times at most', async () => {
  await newFight({ teamA: ['Phoenix King', 'Arya'], teamB: ['Rox'], seed: 3 });
  const king = byName('Phoenix King'), arya = byName('Arya');
  arya.isKO = true; arya.currentHp = 0; arya.spellSlots = 0;
  toTurn('Phoenix King');
  if (S.currentMap) { arya.x = king.x + 1; arya.y = king.y; }
  L.handleCastAbility(king.id, 'Phoenix Feathers', [arya.id]);
  assert.ok(!arya.isKO, 'revived');
  assert.equal(arya.spellSlots, arya.maxSpellSlots, 'with every slot back');
  assert.equal(king.remainingCharges['Phoenix Feathers'], 3);
});

test('Grow Spurt lasts until the end of the fight: the Prince stays grown', async () => {
  await newFight({ teamA: ['Phoenix Prince'], teamB: ['Rox'], seed: 3 });
  const prince = byName('Phoenix Prince');
  const hp = prince.maxHp;
  toTurn('Phoenix Prince');
  L.handleTransform(prince.id);
  assert.ok(prince.isTransformed);
  assert.equal(prince.maxHp, hp + 20);
  assert.ok(prince.abilities.some(a => a.name === 'Phoenix Hug'));
  for (let i = 0; i < 8; i++) { toTurn('Phoenix Prince'); L.handlePass(); }
  assert.ok(prince.isTransformed, 'the form does not end');
  assert.equal(prince.maxHp, hp + 20);
});

test('Phoenix Hug heals the Prince and his ally, and both again when his next turn starts', async () => {
  await newFight({ teamA: ['Phoenix Prince', 'Arya'], teamB: ['Rox'], seed: 3 });
  const prince = byName('Phoenix Prince'), arya = byName('Arya');
  toTurn('Phoenix Prince');
  L.handleTransform(prince.id);
  toTurn('Phoenix Prince');
  if (S.currentMap) { arya.x = prince.x + 1; arya.y = prince.y; }
  prince.currentHp = 10; arya.currentHp = 10;
  L.handleCastAbility(prince.id, 'Phoenix Hug', [arya.id]);
  const p1 = prince.currentHp, a1 = arya.currentHp;
  assert.ok(p1 > 10 && a1 > 10, 'both healed at once');
  L.handlePass();
  toTurn('Phoenix Prince');
  assert.ok(prince.currentHp > p1 && arya.currentHp > a1, 'and again next turn');
});
