import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { greedyTurn, greedyReact } = await import('../js/ai/greedy.js');
const { snapshot, restore } = await import('../js/ai/snapshot.js');
const { enumeratePlans, enumerateReacts } = await import('../js/ai/candidates.js');

const { S } = L;
const teamA = ['Zhuqiao, Vermillion Bird', 'Jay, Azure Dragon', 'Jeagen, White Tiger', 'Black Turtle', 'Meï'];
const teamB = ['Admiral Jaina', 'Thormak, The Titan Slayer', 'Susano', 'Alicia', 'Sensei Lloyd'];

const unit = name => S.combatants.find(c => c.name === name);
const casts = (plans, ability) => plans.filter(p => p.action.type === 'cast' && p.action.ability === ability);
const ofType = (plans, type) => plans.filter(p => p.action.type === type);
const free = (x, y) => isWalkableG(S.currentMap, x, y) && !L.isOccupied(x, y);

// Ids an action points at, whatever its shape
const targetsOf = a => a.type === 'attack' ? [a.targetId] : a.targetIds ?? [];

test('a once-per-fight ability already used is never offered', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const jaina = unit('Admiral Jaina');
  // Bring a foe well inside the relic's reach so the cast is offered at all
  const foe = L.enemies(jaina)[0];
  const spot = [...L.bfsReachable(jaina.x, jaina.y, 3).keys()].map(k => k.split(',').map(Number)).find(([x, y]) => free(x, y));
  [foe.x, foe.y] = spot;
  assert.ok(casts(enumeratePlans(jaina), 'Dominion of the Seven Sea').length > 0);
  jaina.usedThisFight.push('Dominion of the Seven Sea');
  assert.equal(casts(enumeratePlans(jaina), 'Dominion of the Seven Sea').length, 0);
});

test('an ability on cooldown is absent', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const jaina = unit('Admiral Jaina');
  const foe = L.enemies(jaina)[0];
  const spot = [...L.bfsReachable(jaina.x, jaina.y, 3).keys()].map(k => k.split(',').map(Number)).find(([x, y]) => free(x, y));
  [foe.x, foe.y] = spot;
  assert.ok(casts(enumeratePlans(jaina), 'Runik Sea Dragon').length > 0);
  jaina.cooldowns['Runik Sea Dragon'] = 2;
  assert.equal(casts(enumeratePlans(jaina), 'Runik Sea Dragon').length, 0);
});

test('a taunted unit only targets its taunter', async () => {
  await newFight({ teamA, teamB, seed: 2 });
  const c = unit('Jay, Azure Dragon');
  const foes = L.enemies(c);
  const taunter = foes[2];
  // Gather the foes around the unit so many targets are in reach
  const spots = [...L.bfsReachable(c.x, c.y, 3).keys()].map(k => k.split(',').map(Number)).filter(([x, y]) => free(x, y));
  foes.forEach((f, i) => { [f.x, f.y] = spots[i]; });
  c.statusEffects.push({ name: 'taunted', sourceId: taunter.id, turnsLeft: 2 });
  const plans = enumeratePlans(c);
  const foeIds = new Set(foes.map(f => f.id));
  const aimed = plans.filter(p => targetsOf(p.action).some(id => foeIds.has(id)));
  assert.ok(aimed.length > 0);
  for (const p of aimed) {
    if (p.action.type === 'attack' || p.action.targetIds.length === 1) assert.deepEqual(targetsOf(p.action), [taunter.id]);
    else assert.ok(p.action.targetIds.includes(taunter.id), JSON.stringify(p));
  }
});

test('a controlled unit gets exactly one plan: pass in place', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const c = unit('Alicia');
  c.statusEffects.push({ name: 'stun', turnsLeft: 1, dice: null, damType: null, notes: '' });
  assert.deepEqual(enumeratePlans(c), [{ move: null, action: { type: 'pass' } }]);
});

test('transform is offered until the unit has transformed', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const lloyd = unit('Sensei Lloyd');
  assert.ok(ofType(enumeratePlans(lloyd), 'transform').length > 0);
  lloyd.isTransformed = true;
  lloyd.usedThisFight.push(lloyd.sourceChar.transformation.base.nom);
  assert.equal(ofType(enumeratePlans(lloyd), 'transform').length, 0);
});

test('domain is offered until it is active', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const lloyd = unit('Sensei Lloyd');
  lloyd.spellSlots = 99;
  assert.ok(ofType(enumeratePlans(lloyd), 'domain').length > 0);
  lloyd.domainActive = true;
  S.activeDomains.push({ casterId: lloyd.id, domain: lloyd.sourceChar.domain, centerX: lloyd.x, centerY: lloyd.y });
  assert.equal(ofType(enumeratePlans(lloyd), 'domain').length, 0);
});

test('a domain a stronger enemy domain would crush is not offered', async () => {
  await newFight({ teamA: ['Susano'], teamB: ['Sensei Lloyd'], seed: 1 });
  const susano = unit('Susano'), lloyd = unit('Sensei Lloyd');
  susano.spellSlots = 99;
  const strong = { ...lloyd.sourceChar.domain, type: 'Fermé', rafinement: 99 };
  S.activeDomains.push({ casterId: lloyd.id, domain: strong, centerX: lloyd.x, centerY: lloyd.y });
  lloyd.domainActive = true;
  assert.equal(ofType(enumeratePlans(susano), 'domain').length, 0);
});

test('the list is never empty and always holds pass', async () => {
  await newFight({ teamA: ['Susano'], teamB: ['Alicia'], seed: 1 });
  const c = unit('Susano');
  for (const ab of c.abilities) c.cooldowns[ab.name] = 5;
  c.speed = 0;
  c.isTransformed = true;
  c.domainCharges = 0;
  const plans = enumeratePlans(c);
  assert.ok(plans.length > 0);
  assert.ok(plans.some(p => p.move === null && p.action.type === 'pass'));
});

test('area plans hit an enemy and no plan targets the fallen, except revive', async () => {
  await newFight({ teamA, teamB, seed: 3 });
  const zhuqiao = unit('Zhuqiao, Vermillion Bird');
  const ally = unit('Meï');
  ally.isKO = true; ally.currentHp = 0;
  const fallenFoe = L.enemies(zhuqiao)[0];
  fallenFoe.isKO = true; fallenFoe.currentHp = 0;
  for (const c of S.combatants.filter(x => !x.isKO)) {
    const plans = enumeratePlans(c);
    for (const p of plans) {
      const ab = p.action.type === 'cast' && c.abilities.find(a => a.name === p.action.ability);
      const ids = targetsOf(p.action);
      if (ab && (ab.isAoe || ab.isCone) && ab.targetKind === 'enemy') {
        assert.ok(ids.some(id => L.getCombatant(id).teamIndex !== c.teamIndex), JSON.stringify(p));
      }
      if (ids.some(id => L.getCombatant(id).isKO)) assert.ok(ab?.isRevive, `${c.name}: ${JSON.stringify(p)}`);
    }
  }
  // The fallen ally can be raised
  const revives = enumeratePlans(zhuqiao).filter(p => p.action.ability === 'Resurrection Ember');
  assert.ok(revives.length > 0 && revives.every(p => p.action.targetIds[0] === ally.id));
});

test('plans are unique, moves are legal, and a rooted unit stays put', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  for (const c of S.combatants) {
    const plans = enumeratePlans(c);
    const keys = plans.map(p => JSON.stringify(p));
    assert.equal(new Set(keys).size, keys.length, `${c.name} has duplicate plans`);
    const reach = L.bfsReachable(c.x, c.y, c.speed);
    const cells = new Set(plans.filter(p => p.move).map(p => `${p.move.x},${p.move.y}`));
    assert.ok(cells.size <= 5, `${c.name} has ${cells.size} move cells`);
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number);
      assert.ok(reach.has(k) && !L.isOccupied(x, y, c.id), `${c.name} moves to ${k}`);
    }
  }
  const c = unit('Jay, Azure Dragon');
  c.statusEffects.push({ name: 'root', turnsLeft: 2, dice: null, damType: null, notes: '' });
  assert.ok(enumeratePlans(c).every(p => p.move === null));
  assert.ok(enumeratePlans(unit('Meï'), { maxMoves: 1 }).every(p => p.move === null));
});

test('enumeration leaves the fight untouched', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  const before = JSON.stringify(S.combatants.map(({ sourceChar, abilities, ...rest }) => rest));
  const logLen = S.log.length;
  for (const c of S.combatants) enumeratePlans(c);
  assert.equal(JSON.stringify(S.combatants.map(({ sourceChar, abilities, ...rest }) => rest)), before);
  assert.equal(S.log.length, logLen);
});

for (const seed of [1, 2]) {
  test(`every plan of the opening unit is accepted by the engine (seed ${seed})`, async () => {
    await newFight({ teamA, teamB, seed });
    const c = L.activeCombatant();
    const snap = snapshot();
    const plans = enumeratePlans(c);
    for (const p of plans) {
      const res = applyPlan(p);
      assert.ok(res.accepted && !res.reason, `${c.name}: ${JSON.stringify(p)} -> ${res.reason}`);
      restore(snap);
    }
  });
}

test('a teleport ability is offered with legal destinations', async () => {
  await newFight({ teamA: ['Thormak, The Titan Slayer'], teamB: ['Alicia', 'Susano'], seed: 1 });
  const thormak = unit('Thormak, The Titan Slayer');
  const blinks = casts(enumeratePlans(thormak), 'Blink');
  assert.ok(blinks.length > 0);
  for (const p of blinks) {
    assert.ok(p.action.dest, 'teleport without a destination');
    const { x, y } = p.action.dest;
    assert.ok(L.chebyshev(thormak, p.action.dest) <= 10 && free(x, y));
  }
});

test('reacts always include declining, and a teleport react carries destinations', async () => {
  await newFight({ teamA: ['Kadgar'], teamB: ['Thormak, The Titan Slayer'], seed: 1 });
  const kadgar = unit('Kadgar');
  const tele = kadgar.abilities.find(a => a.tags.includes('teleportation'));
  const other = { name: 'Other React', tags: ['react'] };
  S.reactOptions = [];
  assert.deepEqual(enumerateReacts(), [null]);
  S.reactOptions = [{ combatantId: kadgar.id, ability: tele }, { combatantId: kadgar.id, ability: other }];
  const choices = enumerateReacts();
  assert.ok(choices.includes(null));
  assert.ok(choices.some(ch => ch?.abilityName === 'Other React' && !ch.dest));
  const hops = choices.filter(ch => ch?.abilityName === tele.name);
  assert.ok(hops.length >= 2);
  for (const ch of hops) {
    assert.ok(ch.dest && !(ch.dest.x === kadgar.x && ch.dest.y === kadgar.y));
    assert.ok(L.chebyshev(kadgar, ch.dest) <= tele.range && free(ch.dest.x, ch.dest.y));
  }
  S.reactOptions = [];
});

test('enumerating a mid-fight 5v5 state stays fast', async () => {
  await newFight({ teamA, teamB, seed: 1 });
  // Play a few greedy rounds so units are spread and engaged
  while (S.phase === 'combat' && S.roundNumber <= 3) {
    settleReacts(greedyReact);
    if (S.phase !== 'combat') break;
    if (!applyPlan(greedyTurn(L.activeCombatant())).accepted) applyPlan({ move: null, action: { type: 'pass' } });
  }
  settleReacts(greedyReact);
  const living = S.combatants.filter(c => !c.isKO);
  const start = performance.now();
  for (let i = 0; i < 200; i++) enumeratePlans(living[i % living.length]);
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `200 enumerations took ${ms.toFixed(0)} ms`);
});
