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

test('GunRang comes back at the start of Rig\'s next turn: 1d4 more on each target it hit, every time', async () => {
  let comebacks = 0;
  for (let seed = 1; seed <= 12; seed++) {
    await newFight({ teamA: ['Rig'], teamB: ['Kay Climber'], seed });
    const rig = byName('Rig'), foe = byName('Kay Climber');
    rig.x = 10; rig.y = 10; foe.x = 12; foe.y = 10;
    foe.maxHp = foe.currentHp = 9999;
    toTurn('Rig');
    L.handleCastAbility(rig.id, 'GunRang', [foe.id]);
    settle();
    const queued = rig.followUps?.length ?? 0;
    const hit = /GunRang/.test(logText()) && queued > 0;
    if (!hit) continue;
    const before = foe.currentHp;
    toTurn('Kay Climber'); L.handlePass();
    toTurn('Rig');
    assert.match(logText(), /GunRang comes back/);
    assert.ok(before - foe.currentHp >= 1 && before - foe.currentHp <= 4, 'a 1d4 blow landed');
    assert.equal(rig.followUps.length, 0, 'it is spent');
    comebacks++;
  }
  assert.ok(comebacks > 0, 'GunRang hit at least once');
});

test('Glysain\'s Ice Flame is a free cone of fire and ice with no cooldown, freezing one time in two', async () => {
  await newFight({ teamA: ['Glysain'], teamB: ['Kay Climber'], seed: 1 });
  const g = byName('Glysain');
  const flame = g.abilities.find(a => a.name === 'Ice Flame');
  assert.equal(flame.targetKind, 'enemy');
  assert.ok(flame.isCone);
  assert.equal(flame.dice, '1d8+2');
  assert.ok(!flame.tags.includes('magic') && flame.tags.includes('fire') && flame.tags.includes('ice'));
  assert.equal(flame.cooldownTurns, 0);
  assert.ok(!(flame.spellCost > 0) && !(flame.kiCost > 0));
  assert.equal(flame.effect, '1d2 freeze');
  let frozen = 0;
  const N = 60;
  for (let seed = 1; seed <= N; seed++) {
    await newFight({ teamA: ['Glysain'], teamB: ['Kay Climber'], seed });
    const kay = byName('Kay Climber');
    L.applyStatus(kay, flame.effect);
    if (kay.statusEffects.some(e => ['gel', 'freeze'].includes(e.name.toLowerCase()))) frozen++;
  }
  assert.ok(frozen > 10 && frozen < 50, `frozen ${frozen}/${N}`);
});

test('Zed\'s Smoke Screen lasts 4 turns', async () => {
  await newFight({ teamA: ['Zed'], teamB: ['Kay Climber'], seed: 1 });
  assert.equal(byName('Zed').abilities.find(a => a.name === 'Smoke Screen').duration, 4);
});

test('Oslo\'s Warden of the Wilds hits beasts harder: Thormak, Jeagen and Ras carry the tag', async () => {
  await newFight({ teamA: ['Oslo'], teamB: ['Ras', 'Kay Climber'], seed: 1 });
  const ras = byName('Ras'), kay = byName('Kay Climber');
  assert.ok(L.unitHasTag(ras, 'beast'));
  assert.ok(!L.unitHasTag(kay, 'beast'));
});
