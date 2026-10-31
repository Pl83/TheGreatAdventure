import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isWalkableG } from '../js/dungeon-loader.js';
import { installShims, newFight } from '../tools/headless.mjs';

installShims();
const L = await import('../js/combat-logic.js');
const { applyPlan, settleReacts } = await import('../js/ai/apply.js');
const { setRandom, mulberry32 } = await import('../js/rng.js');
const { S } = L;

const chars = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url), 'utf8'));
const moveOf = (who, move) => chars.find(c => c.nom.startsWith(who)).moveSet.find(m => m.base.nom === move);
const byName = name => S.combatants.find(c => c.name.startsWith(name));
const toTurn = name => {
  for (let i = 0; i < 60 && !L.activeCombatant().name.startsWith(name); i++) {
    if (S.awaitingReact) L.handleReactNo(); else L.handlePass();
  }
  assert.ok(L.activeCombatant().name.startsWith(name), `reached ${name}'s turn`);
  return L.activeCombatant();
};
const place = (c, x, y) => { c.x = x; c.y = y; };
// A free horizontal run of walkable cells, `len` long, with nobody standing on it
function freeRun(len) {
  const { cols, rows } = S.currentMap.grid;
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - len; x++) {
    let ok = true;
    for (let i = 0; i <= len && ok; i++) ok = isWalkableG(S.currentMap, x + i, y) && !L.isOccupied(x + i, y);
    if (ok) return { x, y };
  }
  throw new Error('no free run on the map');
}
// Plays the cast and declines every react prompt it raises, so the move resolves
const cast = (c, ability, targetIds) => {
  const result = applyPlan({ move: null, action: { type: 'cast', ability, targetIds } });
  if (S.awaitingReact) settleReacts(() => null);
  return result;
};
const logText = () => S.log.map(e => e.text);
const status = (name, turnsLeft = 2) => ({ name, turnsLeft, dice: null, damType: null, notes: '' });

// ── Hunter Instinct ────────────────────────────────────────────────────────

test('Hunter Instinct is a self cast that ends the turn and arms the next attack', async () => {
  assert.equal(moveOf('Ras', 'Hunter Instinct').target, 'self');
  await newFight({ teamA: ['Ras'], teamB: ['Kaelgrym'], seed: 1 });
  const ras = toTurn('Ras');
  const serial = S.turnSerial;
  assert.equal(cast(ras, 'Hunter Instinct', [ras.id]).accepted, true);
  assert.notEqual(S.turnSerial, serial, 'the turn ended');
  assert.ok(ras.statusEffects.some(e => e.name === 'sure_hit'));
});

test('an armed unit never misses its next attack, and the status is spent by it', async () => {
  let missesWithout = 0;
  for (let seed = 1; seed <= 40; seed++) {
    await newFight({ teamA: ['Ras'], teamB: ['Kay Climber'], seed });
    const ras = byName('Ras'), kay = byName('Kay Climber');
    setRandom(mulberry32(seed));
    const plain = L.resolveAttack(ras, kay, null);
    if (!plain.hit && !plain.fumble) missesWithout++;

    ras.statusEffects.push(status('sure_hit'));
    setRandom(mulberry32(seed));
    const armed = L.resolveAttack(ras, kay, null);
    assert.ok(armed.hit || armed.fumble, `seed ${seed}: an armed attack lands unless the d20 is a 1`);
    assert.ok(!ras.statusEffects.some(e => e.name === 'sure_hit'), 'spent by the attack');
  }
  assert.ok(missesWithout > 0, 'the control attacks do miss, so the test can tell');
});

test('Hunter Instinct lasts through the next turn of its owner and no longer', async () => {
  await newFight({ teamA: ['Ras'], teamB: ['Kaelgrym'], seed: 2 });
  const ras = toTurn('Ras');
  cast(ras, 'Hunter Instinct', [ras.id]);
  toTurn('Ras');
  assert.ok(ras.statusEffects.some(e => e.name === 'sure_hit'), 'still armed on the next turn');
  L.handlePass();
  toTurn('Ras');
  assert.ok(!ras.statusEffects.some(e => e.name === 'sure_hit'), 'gone a turn later');
});

// ── Divine Beast synergy ───────────────────────────────────────────────────

const BEASTS = ['Jeagen, White Tiger', 'Jay, Azure Dragon', 'Zhuqiao, Vermillion Bird', 'Black Turtle'];

test('a Divine Beast gains nothing alone and its bonuses switch on when another Beast is alive on its team', async () => {
  await newFight({ teamA: ['Jeagen, White Tiger', 'Mira'], teamB: ['Kaelgrym'], seed: 1 });
  const alone = byName('Jeagen');
  assert.equal(L.moveSpeed(alone), alone.speed, 'alone: no speed bonus');

  await newFight({ teamA: ['Jeagen, White Tiger', 'Jay, Azure Dragon', 'Mira'], teamB: ['Kaelgrym'], seed: 1 });
  const jeagen = byName('Jeagen'), jay = byName('Jay'), mira = byName('Mira');
  assert.equal(L.moveSpeed(jay), jay.speed + 3, 'Western Gale: allies move 3 more');
  assert.equal(L.moveSpeed(jeagen), jeagen.speed + 3);
  assert.equal(L.moveSpeed(mira), mira.speed + 3);

  jay.isKO = true;
  assert.equal(L.moveSpeed(jeagen), jeagen.speed, 'the partner fell: the bonus is gone');
});

test('a Divine Beast\'s Beast partner on the other team does not count', async () => {
  await newFight({ teamA: ['Jeagen, White Tiger', 'Mira'], teamB: ['Jay, Azure Dragon'], seed: 1 });
  const jeagen = byName('Jeagen');
  assert.equal(L.moveSpeed(jeagen), jeagen.speed);
});

test('the Beast attack bonus (Eastern Wind) is rolled only while another Beast is alive', async () => {
  const sawBonus = async team => {
    for (let seed = 1; seed <= 30; seed++) {
      await newFight({ teamA: team, teamB: ['Kaelgrym'], seed });
      const jay = byName('Jay'), foe = byName('Kaelgrym');
      const cell = L.freeCellAdjacentTo(foe, jay, jay.id); place(jay, cell.x, cell.y);
      setRandom(mulberry32(seed));
      const r = L.resolveAttack(jay, foe, null);
      if (r.hit && r.breakdown.includes('Eastern Wind')) return true;
    }
    return false;
  };
  assert.equal(await sawBonus(['Jay, Azure Dragon', 'Zhuqiao, Vermillion Bird']), true);
  assert.equal(await sawBonus(['Jay, Azure Dragon', 'Mira']), false);
});

test('Black Turtle\'s Tidal Anchor adds 2 to its defense only with a Beast partner, and Northern Depths cuts damage to allies', async () => {
  await newFight({ teamA: ['Black Turtle', 'Mira'], teamB: ['Kaelgrym'], seed: 1 });
  const lone = byName('Black Turtle'), foe = byName('Kaelgrym');
  const aloneDefense = L.defenseBonus(lone, foe, null);
  const miraAlone = byName('Mira'), before = miraAlone.currentHp;
  L.applyDamage(miraAlone, 20);
  assert.equal(before - miraAlone.currentHp, 20, 'no reduction without a partner');

  await newFight({ teamA: ['Black Turtle', 'Jay, Azure Dragon', 'Mira'], teamB: ['Kaelgrym'], seed: 1 });
  const turtle = byName('Black Turtle'), mira = byName('Mira');
  assert.equal(L.defenseBonus(turtle, byName('Kaelgrym'), null), aloneDefense + 2);
  const hp = mira.currentHp;
  L.applyDamage(mira, 20);
  const lost = hp - mira.currentHp;
  assert.ok(lost >= 12 && lost <= 19, `1d8 shaved off 20 (lost ${lost})`);
  assert.ok(logText().some(t => t.includes('Northern Depths')));
});

test('Dragon Blessing heals the allies of a synced Jay at the start of his turn; Phoenix Grace also lifts one debuff each', async () => {
  await newFight({ teamA: ['Jay, Azure Dragon', 'Black Turtle', 'Mira'], teamB: ['Kaelgrym'], seed: 3 });
  const jay = toTurn('Jay'), mira = byName('Mira');
  mira.currentHp = 10;
  L.beginTurn(jay);
  assert.ok(mira.currentHp > 10, 'healed');
  assert.ok(logText().some(t => t.includes('Dragon Blessing')));

  await newFight({ teamA: ['Zhuqiao, Vermillion Bird', 'Black Turtle', 'Mira'], teamB: ['Kaelgrym'], seed: 3 });
  const zhu = toTurn('Zhuqiao'), m2 = byName('Mira');
  m2.statusEffects.push({ name: 'burn', turnsLeft: 3, dice: '1d4', damType: 'fire', notes: '' }, { name: 'bleed', turnsLeft: 3, dice: '1d4', damType: null, notes: '' });
  L.beginTurn(zhu);
  assert.equal(m2.statusEffects.filter(e => ['burn', 'bleed'].includes(e.name)).length, 1, 'exactly one debuff removed');
  assert.ok(logText().some(t => t.includes('Phoenix Grace')));
});

test('with no other Beast nothing heals at the start of the turn', async () => {
  await newFight({ teamA: ['Jay, Azure Dragon', 'Mira'], teamB: ['Kaelgrym'], seed: 3 });
  const jay = toTurn('Jay');
  byName('Mira').currentHp = 10;
  L.beginTurn(jay);
  assert.ok(!logText().some(t => t.includes('Dragon Blessing')));
});

// ── Relentless Warrior ─────────────────────────────────────────────────────

test('Relentless Warrior gains a stack for every ally that falls, keeps it for the whole fight, and stops at 10', async () => {
  await newFight({ teamA: ['Kay Climber', 'Mira', 'Jhin', 'Nate'], teamB: ['Kaelgrym'], seed: 4 });
  const kay = byName('Kay Climber'), mira = byName('Mira'), jhin = byName('Jhin');
  const stacks = () => kay.stacks?.['Relentless Warrior'] ?? 0;
  assert.equal(stacks(), 0);
  L.applyDamage(mira, 9999);
  assert.equal(stacks(), 1);
  mira.isKO = false; mira.currentHp = 10;               // revived: the stack stays
  assert.equal(stacks(), 1);
  L.applyDamage(jhin, 9999);
  assert.equal(stacks(), 2);
  for (let i = 0; i < 12; i++) { mira.isKO = false; mira.currentHp = 10; L.applyDamage(mira, 9999); }
  assert.equal(stacks(), 10, 'capped by maxStacks');
});

test('each Relentless Warrior stack adds its dice to the attack, and an enemy falling gives none', async () => {
  const stacksSeen = async (setup) => {
    for (let seed = 1; seed <= 30; seed++) {
      await newFight({ teamA: ['Kay Climber', 'Mira', 'Jhin'], teamB: ['Kaelgrym', 'Nate'], seed });
      const kay = byName('Kay Climber'), foe = byName('Kaelgrym');
      const cell = L.freeCellAdjacentTo(foe, kay, kay.id); place(kay, cell.x, cell.y);
      setup(kay);
      setRandom(mulberry32(seed));
      const r = L.resolveAttack(kay, foe, null);
      if (r.hit && !r.fumble) return (r.breakdown.match(/Relentless Warrior/g) ?? []).length;
    }
    return null;
  };
  assert.equal(await stacksSeen(() => {}), 0, 'no ally has fallen');
  assert.equal(await stacksSeen(() => { L.applyDamage(byName('Nate'), 9999); }), 0, 'a fallen enemy is no stack');
  assert.equal(await stacksSeen(() => { L.applyDamage(byName('Mira'), 9999); }), 1);
  assert.equal(await stacksSeen(() => { L.applyDamage(byName('Mira'), 9999); L.applyDamage(byName('Jhin'), 9999); }), 2);
});

// ── Opportunity attacks (dash moves) ───────────────────────────────────────

for (const [who, move, foe] of [['Kaelgrym', 'Fire Rush', 'Jhin'], ['Astrid Nightmare', 'Shadow Dash', 'Jhin']]) {
  test(`${move} dashes next to the target and takes a free attack on it`, async () => {
    assert.ok(moveOf(who, move).base.tags.includes('opportunity'));
    let hurt = 0;
    for (let seed = 1; seed <= 20; seed++) {
      await newFight({ teamA: [who], teamB: [foe], seed });
      const me = toTurn(who.split(' ')[0]), target = byName(foe);
      const run = freeRun(7);
      place(me, run.x, run.y); place(target, run.x + 5, run.y);
      me.spellSlots = 9;
      const hp = target.currentHp;
      assert.equal(cast(me, move, [target.id]).accepted, true);
      assert.equal(L.chebyshev(me, target), 1, 'dashed next to the target');
      const texts = logText();
      const at = texts.findIndex(t => t.includes('opportunity attack'));
      assert.ok(at >= 0, 'the free attack is announced');
      assert.ok(texts.slice(at).some(t => new RegExp(`${me.name} (hits|misses) ${target.name}|CRITICAL|FUMBLE|natural 20 — ${me.name} misses`).test(t)), 'and rolled');
      if (target.currentHp < hp) hurt++;
    }
    assert.ok(hurt > 0, 'it hurts when it lands');
  });
}

// ── Knockback and immovable ────────────────────────────────────────────────

// Moves a unit to a walkable free cell at least 5 cells away from `from`
function parkFar(c, from) {
  const { cols, rows } = S.currentMap.grid;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (L.chebyshev({ x, y }, from) >= 5 && isWalkableG(S.currentMap, x, y) && !L.isOccupied(x, y)) { place(c, x, y); return; }
  }
  throw new Error('nowhere to park');
}

// Oslo at the start of a free run, Kadgar 2 cells to his right, Black Turtle parked far away
async function shatter({ seed = 1, wallAt = null } = {}) {
  await newFight({ teamA: ['Oslo'], teamB: ['Kadgar', 'Black Turtle'], seed });
  const oslo = toTurn('Oslo'), kadgar = byName('Kadgar'), turtle = byName('Black Turtle');
  const run = freeRun(8);
  place(oslo, run.x, run.y); place(kadgar, run.x + 2, run.y);
  parkFar(turtle, oslo);
  kadgar.maxHp = kadgar.currentHp = 900;
  if (wallAt !== null) S.currentMap.grid.walkable[run.y][run.x + wallAt] = 0;
  return { oslo, kadgar, turtle, run };
}

test('Bone Shatter pushes a struck enemy 2 cells straight away from Oslo', async () => {
  let moved = null;
  for (let seed = 1; seed <= 30 && moved === null; seed++) {
    const { oslo, kadgar, run } = await shatter({ seed });
    const hp = kadgar.currentHp;
    cast(oslo, 'Bone Shatter', [kadgar.id]);
    if (kadgar.currentHp < hp) moved = { dx: kadgar.x - (run.x + 2), dy: kadgar.y - run.y };
  }
  assert.deepEqual(moved, { dx: 2, dy: 0 });
});

test('a knocked-back enemy stops before a wall and before another unit', async () => {
  let stoppedByWall = null, stoppedByUnit = null;
  for (let seed = 1; seed <= 30 && (stoppedByWall === null || stoppedByUnit === null); seed++) {
    const a = await shatter({ seed, wallAt: 4 });
    const hpA = a.kadgar.currentHp;
    cast(a.oslo, 'Bone Shatter', [a.kadgar.id]);
    if (a.kadgar.currentHp < hpA && stoppedByWall === null) stoppedByWall = a.kadgar.x - (a.run.x + 2);

    const b = await shatter({ seed });
    place(b.turtle, b.run.x + 3, b.run.y);   // a unit right behind Kadgar is in the way
    const hpB = b.kadgar.currentHp;
    cast(b.oslo, 'Bone Shatter', [b.kadgar.id]);
    if (b.kadgar.currentHp < hpB && stoppedByUnit === null) stoppedByUnit = b.kadgar.x - (b.run.x + 2);
  }
  assert.equal(stoppedByWall, 1, 'wall two cells behind the target: it moves 1');
  assert.equal(stoppedByUnit, 0, 'a unit right behind it: it does not move');
});

test('Black Turtle cannot be knocked back, pulled or grounded', async () => {
  assert.ok(chars.find(c => c.nom === 'Black Turtle').passif.find(p => p.nom === 'Northern Bastion').tags.includes('immovable'));
  let stayed = false;
  for (let seed = 1; seed <= 30 && !stayed; seed++) {
    const { oslo, kadgar, turtle, run } = await shatter({ seed });
    parkFar(kadgar, oslo); place(turtle, run.x + 2, run.y);
    turtle.maxHp = turtle.currentHp = 900;
    const hp = turtle.currentHp;
    cast(oslo, 'Bone Shatter', [turtle.id]);
    if (turtle.currentHp < hp) { assert.deepEqual([turtle.x, turtle.y], [run.x + 2, run.y]); stayed = true; }
  }
  assert.ok(stayed, 'the turtle was hit and stayed put');

  await newFight({ teamA: ['Vorrakan Duskbane'], teamB: ['Black Turtle'], seed: 5 });
  const vor = toTurn('Vorrakan'), turtle = byName('Black Turtle');
  const run = freeRun(8);
  place(vor, run.x, run.y); place(turtle, run.x + 7, run.y);
  vor.spellSlots = 9; vor.ki = 9;
  const before = [turtle.x, turtle.y];
  cast(vor, 'Force Grab/Pull', [turtle.id]);
  assert.deepEqual([turtle.x, turtle.y], before, 'pull does not move it');
});

test('Bone Shatter takes Oslo\'s Bone Armor for his next 2 turns', async () => {
  assert.ok(moveOf('Oslo', 'Bone Shatter').base.tags.includes('knockback'));
  await newFight({ teamA: ['Oslo'], teamB: ['Kadgar'], seed: 6 });
  const oslo = toTurn('Oslo'), kadgar = byName('Kadgar');
  const run = freeRun(5);
  place(oslo, run.x, run.y); place(kadgar, run.x + 2, run.y);
  assert.equal(L.defenseBonus(oslo, kadgar, null), 4);
  cast(oslo, 'Bone Shatter', [kadgar.id]);
  assert.equal(L.defenseBonus(oslo, kadgar, null), 0, 'lost');
  toTurn('Oslo');
  assert.equal(L.defenseBonus(oslo, kadgar, null), 0, 'lost on the first turn');
  L.handlePass();
  toTurn('Oslo');
  assert.equal(L.defenseBonus(oslo, kadgar, null), 0, 'lost on the second turn');
  L.handlePass();
  toTurn('Oslo');
  assert.equal(L.defenseBonus(oslo, kadgar, null), 4, 'regrown on the third');
});

// ── Guardbreak: Tiger's Leap ───────────────────────────────────────────────

test('Tiger\'s Leap is a guardbreak with a 6-cell range', () => {
  const m = moveOf('Jeagen', "Tiger's Leap");
  assert.equal(m.range, 6);
  assert.ok(m.base.tags.includes('guardbreak'));
});

test('guardbreak removes the block reacts and keeps the dodge ones', async () => {
  await newFight({ teamA: ['Jeagen, White Tiger'], teamB: ['Susano'], seed: 1 });
  const jeagen = byName('Jeagen'), susano = byName('Susano');
  susano.spellSlots = 9;
  const leap = jeagen.abilities.find(a => a.name === "Tiger's Leap");
  const names = abs => abs.map(a => a.name);
  assert.ok(names(L.getReacts(susano, null)).includes('Lightning Shield'), 'a normal attack can be blocked');
  assert.ok(!names(L.getReacts(susano, leap)).includes('Lightning Shield'), 'guardbreak cannot');

  await newFight({ teamA: ['Jeagen, White Tiger'], teamB: ['Kadgar', 'Rig'], seed: 1 });
  const j2 = byName('Jeagen'), kadgar = byName('Kadgar'), rig = byName('Rig');
  kadgar.spellSlots = 9; rig.ki = 9;
  const leap2 = j2.abilities.find(a => a.name === "Tiger's Leap");
  assert.ok(L.getReacts(kadgar, leap2).some(a => a.tags.includes('teleportation')), 'teleport still dodges');
  assert.ok(L.getReacts(rig, leap2).some(a => a.name === 'Turbo Boot'), 'a dash still dodges');
});

test('a pre-armed shield does not stop Tiger\'s Leap, but still stops an ordinary move', async () => {
  let landed = false;
  for (let seed = 1; seed <= 30 && !landed; seed++) {
    await newFight({ teamA: ['Jeagen, White Tiger'], teamB: ['Kadgar'], seed });
    const jeagen = toTurn('Jeagen'), kadgar = byName('Kadgar');
    kadgar.maxHp = kadgar.currentHp = 900; kadgar.spellSlots = 0;
    const run = freeRun(7);
    place(jeagen, run.x, run.y); place(kadgar, run.x + 5, run.y);
    jeagen.ki = 20;
    kadgar.statusEffects.push(status('water_shield', 2));
    const hp = kadgar.currentHp;
    cast(jeagen, "Tiger's Leap", [kadgar.id]);
    assert.ok(!logText().some(t => t.includes('pre-armed shield blocks')), 'the shield is ignored');
    if (kadgar.currentHp < hp) landed = true;
  }
  assert.ok(landed, 'the leap hit through the shield');

  await newFight({ teamA: ['Jeagen, White Tiger'], teamB: ['Kadgar'], seed: 1 });
  const j = toTurn('Jeagen'), k = byName('Kadgar');
  const run = freeRun(7);
  place(j, run.x, run.y); place(k, run.x + 1, run.y);
  k.statusEffects.push(status('water_shield', 2));
  j.ki = 20;
  cast(j, 'Steel Fang Barrage', [k.id]);
  assert.ok(logText().some(t => t.includes('pre-armed shield blocks')), 'an ordinary move is still stopped');
});

test('Tiger\'s Leap dashes next to a target within 6 cells and cannot be cast at 7', async () => {
  await newFight({ teamA: ['Jeagen, White Tiger'], teamB: ['Kadgar'], seed: 2 });
  const jeagen = toTurn('Jeagen'), kadgar = byName('Kadgar');
  const run = freeRun(8);
  place(jeagen, run.x, run.y); place(kadgar, run.x + 7, run.y);
  jeagen.ki = 20;
  const serial = S.turnSerial;
  assert.equal(cast(jeagen, "Tiger's Leap", [kadgar.id]).accepted, false, 'too far');
  assert.equal(S.turnSerial, serial);

  place(kadgar, run.x + 6, run.y);
  assert.equal(cast(jeagen, "Tiger's Leap", [kadgar.id]).accepted, true);
  assert.equal(L.chebyshev(jeagen, kadgar), 1, 'now adjacent');
});

// ── Passive advantage ──────────────────────────────────────────────────────

const advantageLogs = who => logText().filter(t => t.includes(`Advantage (${who}`)).length;

test('White always attacks with advantage, whatever he swings', async () => {
  await newFight({ teamA: ['White'], teamB: ['Kay Climber'], seed: 1 });
  const white = byName('White'), kay = byName('Kay Climber');
  for (let i = 0; i < 5; i++) L.resolveAttack(white, kay, null);
  assert.equal(advantageLogs('White'), 5);
  const flame = white.abilities.find(a => a.name === 'Flame of the Dead');
  L.resolveAttack(white, kay, '1d4', flame);
  assert.equal(advantageLogs('White'), 6);
});

test('Jeagen rolls his defense with advantage, and the description no longer promises dodging through walls', async () => {
  assert.ok(!/wall/i.test(chars.find(c => c.nom.startsWith('Jeagen')).passif.find(p => p.nom === 'Wind Step').description));
  await newFight({ teamA: ['Kay Climber'], teamB: ['Jeagen, White Tiger'], seed: 1 });
  const kay = byName('Kay Climber'), jeagen = byName('Jeagen');
  for (let i = 0; i < 4; i++) L.resolveAttack(kay, jeagen, null);
  assert.equal(advantageLogs('Jeagen'), 4);
  assert.equal(advantageLogs('Kay Climber'), 0, 'only the defender had the passive');
});

test('Jhin has advantage with the sword (basic attack and sword techniques) and nowhere else', async () => {
  await newFight({ teamA: ['Jhin'], teamB: ['Kay Climber'], seed: 1 });
  const jhin = byName('Jhin'), kay = byName('Kay Climber');
  const abil = n => jhin.abilities.find(a => a.name === n);
  L.resolveAttack(jhin, kay, null);
  assert.equal(advantageLogs('Jhin'), 1, 'basic sword attack');
  L.resolveAttack(jhin, kay, '1d4', abil('Vorpal Slash'));
  assert.equal(advantageLogs('Jhin'), 2, 'sword technique');
  L.resolveAttack(jhin, kay, '1d4', abil('Spinzutsu'));
  assert.equal(advantageLogs('Jhin'), 2, 'Spinzutsu is not a sword move');
});

// ── White: no range limit, no line of sight needed up close ───────────────

function cellsWhere(pred) {
  const { cols, rows } = S.currentMap.grid;
  const out = [];
  for (let ay = 1; ay < rows - 1; ay += 2) for (let ax = 1; ax < cols - 1; ax += 2)
    for (let by = 1; by < rows - 1; by += 3) for (let bx = 1; bx < cols - 1; bx += 3) {
      if (isWalkableG(S.currentMap, ax, ay) && isWalkableG(S.currentMap, bx, by) && pred(ax, ay, bx, by)) return { ax, ay, bx, by };
    }
  throw new Error('no such pair of cells');
}

test('White reaches any distance, and ignores walls within 10 cells but not beyond', async () => {
  await newFight({ teamA: ['White', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  for (const d of S.currentMap.doors) d.open = true;   // this is about White's range, not about the manor's locked door
  const white = byName('White'), foe = byName('Meï');
  const flame = white.abilities.find(a => a.name === 'Flame of the Dead');
  const far = cellsWhere((ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 12 && L.hasLos(ax, ay, bx, by));
  place(white, far.ax, far.ay); place(foe, far.bx, far.by);
  assert.equal(L.targetInRange(white, foe, null).inRange, true, 'basic attack at any distance');
  assert.equal(L.targetInRange(white, foe, flame).inRange, true, 'range 10 move at any distance');
  const near = cellsWhere((ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 10 && !L.hasLos(ax, ay, bx, by));
  place(white, near.ax, near.ay); place(foe, near.bx, near.by);
  assert.equal(L.targetInRange(white, foe, null).inRange, true, 'no line of sight needed within 10');
  const blocked = cellsWhere((ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 10 && !L.hasLos(ax, ay, bx, by));
  place(white, blocked.ax, blocked.ay); place(foe, blocked.bx, blocked.by);
  assert.equal(L.targetInRange(white, foe, null).inRange, false, 'beyond 10 a wall still blocks');
});

test('an ordinary fighter keeps the normal range and line of sight', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber'), foe = byName('Meï');
  const far = cellsWhere((ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 5 && L.hasLos(ax, ay, bx, by));
  place(kay, far.ax, far.ay); place(foe, far.bx, far.by);
  assert.equal(L.targetInRange(kay, foe, null).inRange, false);
});

test('Hela attacks and Sylvanas defends with advantage', async () => {
  await newFight({ teamA: ['Hela, Goddess of Death'], teamB: ['Sylvanas Nightmare'], seed: 1 });
  const hela = byName('Hela'), sylvanas = byName('Sylvanas');
  L.resolveAttack(hela, sylvanas, null);
  assert.equal(advantageLogs('Hela'), 1, 'True Weapon Goddess');
  assert.equal(advantageLogs('Sylvanas'), 1, 'Banshee');
});

test('Eragon and Kadgar roll spells with advantage, but not their staff', async () => {
  await newFight({ teamA: ['Eragon', 'Kadgar'], teamB: ['Kay Climber'], seed: 1 });
  const kay = byName('Kay Climber');
  for (const who of ['Eragon', 'Kadgar']) {
    const c = byName(who), tornado = c.abilities.find(a => a.tags.includes('magic') && a.source === 'spell');
    L.resolveAttack(c, kay, '1d4', tornado);
    assert.equal(advantageLogs(who), 1, `${who}: spell`);
    L.resolveAttack(c, kay, null);
    assert.equal(advantageLogs(who), 1, `${who}: staff stays flat`);
  }
});

// ── Hela's Death Presence ──────────────────────────────────────────────────

const disadvantageLogs = who => logText().filter(t => t.includes(`Disadvantage (${who}`)).length;

test('Death Presence: each foe of Hela attacks its first time at disadvantage, then normally', async () => {
  await newFight({ teamA: ['Hela, Goddess of Death'], teamB: ['Kay Climber', 'Meï'], seed: 1 });
  const hela = byName('Hela'), kay = byName('Kay Climber'), mei = byName('Meï');
  L.resolveAttack(kay, hela, null);
  assert.equal(disadvantageLogs('Kay Climber'), 1, 'first attack');
  L.resolveAttack(kay, hela, null);
  L.resolveAttack(kay, hela, null);
  assert.equal(disadvantageLogs('Kay Climber'), 1, 'later attacks are normal');
  L.resolveAttack(mei, hela, null);
  assert.equal(disadvantageLogs('Meï'), 1, 'every foe has its own first attack');
});

test('Death Presence only touches Hela\'s foes, and ends with her', async () => {
  await newFight({ teamA: ['Hela, Goddess of Death', 'Meï'], teamB: ['Kay Climber'], seed: 1 });
  const hela = byName('Hela'), mei = byName('Meï'), kay = byName('Kay Climber');
  L.resolveAttack(mei, kay, null);
  assert.equal(disadvantageLogs('Meï'), 0, 'her ally');
  L.resolveAttack(hela, kay, null);
  assert.equal(disadvantageLogs('Hela'), 0, 'Hela herself');
  hela.isKO = true;
  L.resolveAttack(kay, mei, null);
  assert.equal(disadvantageLogs('Kay Climber'), 0, 'a fallen Hela spreads no dread');
});

test('Death Presence and advantage cancel out on the first attack', async () => {
  await newFight({ teamA: ['Hela, Goddess of Death'], teamB: ['White'], seed: 1 });
  const hela = byName('Hela'), white = byName('White');
  L.resolveAttack(white, hela, null);
  assert.equal(disadvantageLogs('White') + advantageLogs('White'), 0, 'one die, no pick');
  L.resolveAttack(white, hela, null);
  assert.equal(advantageLogs('White'), 1, 'advantage is back from the second attack');
});

// ── Water on the map ───────────────────────────────────────────────────────

const waterCell = () => {
  const [x, y] = [...S.currentMap.water][0].split(',').map(Number);
  return { x, y };
};
const dryCell = () => freeRun(2);
const hpLost = (c, fn) => { const before = c.currentHp; fn(); return before - c.currentHp; };

test('the Manor map hands its water cells to combat', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  assert.equal(S.currentMap.water.size, 3);
  // JSON (5,9) and (6,9) are inside the room; (7,9) sits just past its wall, so units can only stand on two
  const floor = [...S.currentMap.water].filter(k => isWalkableG(S.currentMap, ...k.split(',').map(Number)));
  assert.deepEqual(floor.sort(), ['20,21', '21,21']);
});

test('standing on water makes a unit wet; flying over it or being immune does not', async () => {
  await newFight({ teamA: ['Kay Climber', 'Black Turtle'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber'), turtle = byName('Black Turtle');
  const w = waterCell(), d = dryCell();
  place(kay, d.x, d.y);
  assert.equal(L.isWet(kay), false);
  place(kay, w.x, w.y);
  assert.equal(L.isWet(kay), true);
  kay.statusEffects.push(status('fly', 999));
  assert.equal(L.isWet(kay), false, 'flying');
  place(turtle, w.x, w.y);
  assert.equal(L.isWet(turtle), false, 'Black Turtle is immune to wet');
});

test('a unit standing on water walks at 0.8 of its speed, rounded down', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber');
  const d = dryCell(), w = waterCell();
  place(kay, d.x, d.y);
  const dry = L.moveSpeed(kay);
  place(kay, w.x, w.y);
  assert.equal(L.moveSpeed(kay), Math.floor(dry * 0.8));
  assert.ok(L.moveSpeed(kay) < dry);
});

test('lightning hits a wet unit for half again as much, other damage is unchanged', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber'), mei = byName('Meï');
  const d = dryCell(), w = waterCell();
  place(kay, d.x, d.y);
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'lightning', ['lightning'], true)), 10);
  place(kay, w.x, w.y);
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'lightning', ['lightning'], true)), 15);
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'fire', ['fire'], true)), 10);
  place(mei, d.x, d.y);
  assert.equal(hpLost(mei, () => L.applyDamage(mei, 10, 'lightning', ['lightning'], true)), 10);
});

test('ice on a wet target: a 1d2 freeze becomes certain, a plain ice move gets a 1d2 freeze', async () => {
  await newFight({ teamA: ['Future Zane', 'Susano'], teamB: ['Meï'], seed: 1 });
  const zane = byName('Future Zane'), susano = byName('Susano'), mei = byName('Meï');
  const ab = (c, n) => c.abilities.find(a => a.name === n);
  const cryo = ab(zane, 'Cryo Beam'), cone = ab(zane, 'Ice Cone'), coffin = ab(susano, 'Ice Coffin');
  const d = dryCell(), w = waterCell();
  place(mei, d.x, d.y);
  assert.equal(L.effectFor(cryo, mei), cryo.effect, 'dry: as written');
  assert.equal(L.effectFor(cone, mei), cone.effect, 'dry: nothing added');
  place(mei, w.x, w.y);
  assert.match(L.effectFor(cryo, mei), /^(gel|freeze)$/i, 'wet: the chance is now certain');
  assert.match(L.effectFor(cone, mei), /^1d2 (gel|freeze)$/i, 'wet: a 1d2 chance appears');
  assert.equal(L.effectFor(coffin, mei), coffin.effect, 'a move that already freezes is unchanged');
  const fire = byName('Susano').abilities.find(a => !a.tags.includes('ice') && a.dice);
  assert.equal(L.effectFor(fire, mei), fire.effect, 'only ice damage');
});

// ── Wet from water spells: lasts two turns, fire dries it, lightning and ice spend it ──

const hasWet = c => c.statusEffects.some(e => e.name === 'wet');

test('Water Dragon and Abyssal Current soak their targets for two of its turns', async () => {
  await newFight({ teamA: ['Eragon', 'Black Turtle'], teamB: ['Kay Climber', 'Kaelgrym'], seed: 1 });
  const eragon = byName('Eragon'), turtle = byName('Black Turtle'), kay = byName('Kay Climber'), kael = byName('Kaelgrym');
  assert.match(eragon.abilities.find(a => a.name === 'Water Dragon').effect, /wet/);
  assert.match(turtle.abilities.find(a => a.name === 'Abyssal Current').effect, /wet/);
  L.applyStatus(kay, 'wet');
  assert.equal(hasWet(kay), true);
  assert.equal(L.isWet(kay), true, 'off the water, the status is enough');
  L.tickTurn(kay); assert.equal(hasWet(kay), true, 'still wet on its first turn');
  L.tickTurn(kay); assert.equal(hasWet(kay), true, 'and on its second');
  L.tickTurn(kay); assert.equal(hasWet(kay), false, 'dry on the third');
  L.applyStatus(kael, 'wet');
  assert.equal(hasWet(kael), false, 'Kaelgrym is immune to wet');
});

test('fire dries a soaked unit, but not the water it stands in', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber');
  L.applyStatus(kay, 'wet');
  L.applyDamage(kay, 5, 'fire', ['fire'], true);
  assert.equal(hasWet(kay), false);
  assert.equal(L.isWet(kay), false);
  const w = waterCell();
  place(kay, w.x, w.y);
  L.applyStatus(kay, 'wet');
  L.applyDamage(kay, 5, 'fire', ['fire'], true);
  assert.equal(hasWet(kay), false);
  assert.equal(L.isWet(kay), true, 'still standing in water');
});

test('lightning bites a soaked unit once and spends the wet', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber');
  L.applyStatus(kay, 'wet');
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'lightning', ['lightning'], true)), 15);
  assert.equal(hasWet(kay), false);
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'lightning', ['lightning'], true)), 10);
});

test('lightning does not spend the water a unit stands in', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber'), w = waterCell();
  place(kay, w.x, w.y);
  L.applyDamage(kay, 10, 'lightning', ['lightning'], true);
  assert.equal(hpLost(kay, () => L.applyDamage(kay, 10, 'lightning', ['lightning'], true)), 15);
});

test('ice freezes a soaked unit for sure and spends the wet', async () => {
  await newFight({ teamA: ['Future Zane'], teamB: ['Meï'], seed: 1 });
  const zane = byName('Future Zane'), mei = byName('Meï');
  const cryo = zane.abilities.find(a => a.name === 'Cryo Beam');
  L.applyStatus(mei, 'wet');
  L.applyMoveEffect(cryo, mei);
  assert.ok(mei.statusEffects.some(e => e.name.toLowerCase() === 'gel'), 'frozen');
  assert.equal(hasWet(mei), false, 'the wet is spent');
});

// ── Nine Lives ─────────────────────────────────────────────────────────────

test('Nine Lives: Heracles gets back up at 1 HP nine times, the tenth blow kills', async () => {
  await newFight({ teamA: ['Heracles'], teamB: ['Meï'], seed: 1 });
  const heracles = byName('Heracles');
  for (let i = 1; i <= 9; i++) {
    L.applyDamage(heracles, 9999, 'physical', ['physical'], true);
    assert.equal(heracles.isKO, false, `life ${i}`);
    assert.equal(heracles.currentHp, 1);
  }
  L.applyDamage(heracles, 9999, 'physical', ['physical'], true);
  assert.equal(heracles.isKO, true);
});

test('Nine Lives is only Heracles\'s: anyone else dies at once', async () => {
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  const kay = byName('Kay Climber');
  L.applyDamage(kay, 9999, 'physical', ['physical'], true);
  assert.equal(kay.isKO, true);
});

// ── Battle Tactician: Give Orders ──────────────────────────────────────────

test('Future Zane can Give Orders to an ally: the turn ends and the ally attacks with +2 until its next turn is over', async () => {
  await newFight({ teamA: ['Future Zane', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  const zane = toTurn('Future Zane'), kay = byName('Kay Climber');
  const orders = zane.abilities.find(a => a.name === 'Give Orders');
  assert.ok(orders, 'Future Zane has the action');
  assert.equal(orders.targetKind, 'ally');
  const serial = S.turnSerial;
  assert.equal(cast(zane, 'Give Orders', [kay.id]).accepted, true);
  assert.notEqual(S.turnSerial, serial, 'the turn ended');
  assert.ok(kay.statusEffects.some(e => e.name === 'orders'));
  kay.statusEffects.push(status('sure_hit'));
  const swing = L.resolveAttack(kay, byName('Meï'), null);
  assert.ok(swing.hit && swing.breakdown.includes('Orders[+2'), `the +2 is added to the blow: ${swing.breakdown}`);
  L.tickTurn(kay);
  assert.ok(kay.statusEffects.some(e => e.name === 'orders'), 'still there for its next turn');
  L.tickTurn(kay);
  assert.ok(!kay.statusEffects.some(e => e.name === 'orders'), 'gone after it');
});

test('the bot can plan Give Orders on an ally', async () => {
  const { enumeratePlans } = await import('../js/ai/candidates.js');
  await newFight({ teamA: ['Future Zane', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  const zane = toTurn('Future Zane');
  assert.ok(enumeratePlans(zane).some(p => p.action.ability === 'Give Orders' && p.action.targetIds[0] === byName('Kay Climber').id));
});

// ── Spell slot restoration ─────────────────────────────────────────────────

test('Vorpal Slash gives Vorrakan back 5 spell slots with its lifesteal', async () => {
  let restored = 0;
  for (let seed = 1; seed <= 12; seed++) {
    await newFight({ teamA: ['Vorrakan Duskbane'], teamB: ['Kay Climber'], seed });
    const vor = toTurn('Vorrakan'), kay = byName('Kay Climber');
    place(kay, vor.x + 1, vor.y);
    vor.spellSlots = 2; vor.maxSpellSlots = Math.max(vor.maxSpellSlots, 10);
    vor.statusEffects.push(status('sure_hit'));
    const hp = kay.currentHp;
    cast(vor, 'Vorpal Slash', [kay.id]);
    if (kay.currentHp < hp) { restored++; assert.equal(vor.spellSlots, 7, `seed ${seed}`); }
  }
  assert.ok(restored > 0, 'the slash landed at least once');
});

test('Kaelgrym absorbs fire into spell slots instead of taking it', async () => {
  await newFight({ teamA: ['Kaelgrym'], teamB: ['Meï'], seed: 1 });
  const kael = byName('Kaelgrym');
  kael.spellSlots = 3;
  assert.equal(hpLost(kael, () => L.applyDamage(kael, 20, 'fire', ['fire'], true)), 0);
  assert.equal(kael.spellSlots, 4);
  assert.equal(hpLost(kael, () => L.applyDamage(kael, 20, 'physical', ['physical'], true)), 20);
  assert.equal(kael.spellSlots, 4, 'only fire feeds him');
  kael.spellSlots = kael.maxSpellSlots;
  L.applyDamage(kael, 20, 'fire', ['fire'], true);
  assert.equal(kael.spellSlots, kael.maxSpellSlots, 'never past the maximum');
});

// ── Cleanse riders ─────────────────────────────────────────────────────────

test('Bénédiction of the Moon lifts a debuff and shields the ally from new ones for 2 turns', async () => {
  await newFight({ teamA: ['Nya Léviathan', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  const nya = toTurn('Nya'), kay = byName('Kay Climber');
  place(kay, nya.x + 1, nya.y);
  L.applyStatus(kay, 'burn');
  assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === 'burn'));
  cast(nya, 'Bénédiction of the Moon', [kay.id]);
  assert.ok(!kay.statusEffects.some(e => e.name.toLowerCase() === 'burn'), 'burn lifted');
  L.applyStatus(kay, 'burn');
  assert.ok(!kay.statusEffects.some(e => e.name.toLowerCase() === 'burn'), 'new debuff refused');
  L.tickTurn(kay);
  L.applyStatus(kay, 'toxic');
  assert.ok(!kay.statusEffects.some(e => e.name.toLowerCase() === 'toxic'), 'shielded on its first turn');
  L.tickTurn(kay);
  L.applyStatus(kay, 'toxic');
  assert.ok(!kay.statusEffects.some(e => e.name.toLowerCase() === 'toxic'), 'and on its second');
  L.tickTurn(kay);
  L.applyStatus(kay, 'toxic');
  assert.ok(kay.statusEffects.some(e => e.name.toLowerCase() === 'toxic'), 'the ward is over');
});

test('Fire Tornado dries the allies in its area and takes the disadvantage off them', async () => {
  await newFight({ teamA: ['Eragon', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  const eragon = toTurn('Eragon'), kay = byName('Kay Climber'), mei = byName('Meï');
  place(kay, eragon.x + 1, eragon.y);
  place(mei, eragon.x + 3, eragon.y);
  L.applyStatus(kay, 'wet');
  kay.statusEffects.push(status('disadvantage'), status('smoke_screen', 3));
  cast(eragon, 'Fire Tornado', [mei.id]);
  assert.ok(!kay.statusEffects.some(e => ['wet', 'disadvantage', 'smoke_screen'].includes(e.name)), 'dried and clear-eyed');
});

// ── Loki's Blessing: Alicia's death save ───────────────────────────────────

test('Alicia gets one death save per fight, rolled twice (10+ on either keeps her up at 1 HP)', async () => {
  let kept = 0, fell = 0;
  for (let seed = 1; seed <= 40; seed++) {
    await newFight({ teamA: ['Alicia'], teamB: ['Meï'], seed });
    const alicia = byName('Alicia');
    L.applyDamage(alicia, 9999, 'physical', ['physical'], true);
    if (alicia.isKO) { fell++; continue; }
    kept++;
    assert.equal(alicia.currentHp, 1);
    L.applyDamage(alicia, 9999, 'physical', ['physical'], true);
    assert.equal(alicia.isKO, true, `seed ${seed}: the save is spent`);
  }
  assert.ok(kept > fell && fell > 0, `kept ${kept}, fell ${fell}: two rolls at 10+ is about 80%`);
});

test('nobody but Alicia gets a death save', async () => {
  for (let seed = 1; seed <= 10; seed++) {
    await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed });
    L.applyDamage(byName('Kay Climber'), 9999, 'physical', ['physical'], true);
    assert.equal(byName('Kay Climber').isKO, true);
  }
});

// ── Ifrit's Bane: Sleeping absorbs fire, the first Awake strike wakes it for good ──

test('Ifrit\'s Bane starts asleep, and striking with the Awake form wakes it for the rest of the fight', async () => {
  await newFight({ teamA: ['Kaelgrym'], teamB: ['Meï'], seed: 1 });
  const kael = toTurn('Kaelgrym'), mei = byName('Meï');
  place(mei, kael.x + 1, kael.y);
  const sleeping = kael.abilities.find(a => a.name === "Ifrit's Bane (Sleeping)");
  const awake = kael.abilities.find(a => a.name === "Ifrit's Bane (Awake)");
  kael.spellSlots = 3;
  assert.equal(hpLost(kael, () => L.applyDamage(kael, 20, 'fire', ['fire'], true)), 0, 'asleep: absorbed');
  assert.equal(L.abilityAvailable(kael, sleeping), true);
  kael.statusEffects.push(status('sure_hit'));
  cast(kael, "Ifrit's Bane (Awake)", [mei.id]);
  assert.ok(kael.statusEffects.some(e => e.name === 'relic_awake'), 'awake');
  assert.equal(hpLost(kael, () => L.applyDamage(kael, 20, 'fire', ['fire'], true)), 20, 'awake: fire hurts');
  assert.equal(L.abilityAvailable(kael, sleeping), false, 'the Sleeping form is gone');
  assert.equal(L.abilityAvailable(kael, awake), true);
});

// ── Wyldfire's Convert: freeze or evaporate the water in an area ───────────

async function convertFight() {
  await newFight({ teamA: ['Wyldfire', 'Kay Climber'], teamB: ['Meï'], seed: 1 });
  const wyld = toTurn('Wyldfire'), kay = byName('Kay Climber'), mei = byName('Meï');
  const centre = waterCell();
  const far = freeRun(8);
  place(wyld, far.x, far.y);
  place(kay, centre.x - 2, centre.y + 1);    // in the room, within 4 of the water
  place(mei, far.x + 6, far.y);              // well outside the blast
  assert.ok(L.chebyshev(mei, centre) > 4, 'fixture: the far unit is outside the area');
  return { wyld, kay, mei, centre };
}
const hasStatus = (c, n) => c.statusEffects.some(e => e.name.toLowerCase() === n);

test('Convert is two spells: one freezes water, one evaporates it', async () => {
  const wyld = chars.find(c => c.nom === 'Wyldfire');
  assert.ok(!wyld.moveSet.some(m => m.base.nom === 'Convert'));
  for (const n of ['Convert (Freeze)', 'Convert (Evaporate)']) {
    const m = wyld.moveSet.find(x => x.base.nom === n);
    assert.ok(m, n);
    assert.equal(m.target, 'aoe'); assert.equal(m.spellCost, 1);
  }
});

test('Convert (Freeze) turns the water cells in the area to ice and freezes the wet', async () => {
  const { wyld, kay, mei, centre } = await convertFight();
  const standing = byName('Wyldfire');
  L.applyStatus(kay, 'wet');
  L.applyStatus(mei, 'wet');
  place(standing, centre.x + 1, centre.y);        // a unit in the water itself
  assert.equal(L.isWet(standing), true);
  const serial = S.turnSerial, slots = wyld.spellSlots;
  L.handleCastAbility(wyld.id, 'Convert (Freeze)', [], { x: centre.x, y: centre.y });
  if (S.awaitingReact) settleReacts(() => null);
  assert.notEqual(S.turnSerial, serial, 'the turn ended');
  assert.equal(wyld.spellSlots, slots - 1);
  assert.ok(S.iceCells.has(`${centre.x},${centre.y}`), 'the cell is ice');
  assert.equal(hasStatus(kay, 'gel'), true, 'the soaked ally is frozen');
  assert.equal(hasStatus(kay, 'wet'), false);
  assert.equal(hasStatus(wyld, 'gel'), true, 'so is whoever stood in the water');
  assert.equal(L.isWet(wyld), false, 'ice is plain floor: no longer wet');
  assert.equal(hasStatus(mei, 'gel'), false, 'outside the area: untouched');
  assert.equal(hasStatus(mei, 'wet'), true);
});

test('Convert (Evaporate) dries the cells and the soaked in the area, freezing nobody', async () => {
  const { wyld, kay, mei, centre } = await convertFight();
  L.applyStatus(kay, 'wet');
  L.applyStatus(mei, 'wet');
  L.handleCastAbility(wyld.id, 'Convert (Evaporate)', [], { x: centre.x, y: centre.y });
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(S.driedCells.has(`${centre.x},${centre.y}`));
  assert.equal(hasStatus(kay, 'wet'), false);
  assert.equal(hasStatus(kay, 'gel'), false);
  place(kay, centre.x, centre.y);
  assert.equal(L.isWet(kay), false, 'the water is gone');
  assert.equal(hasStatus(mei, 'wet'), true, 'outside the area: still wet');
});

test('terrain changes are part of the state the bot rewinds, and a new fight starts with the water back', async () => {
  const { snapshot, restore } = await import('../js/ai/snapshot.js');
  const { wyld, centre } = await convertFight();
  const snap = snapshot();
  L.handleCastAbility(wyld.id, 'Convert (Freeze)', [], { x: centre.x, y: centre.y });
  if (S.awaitingReact) settleReacts(() => null);
  assert.ok(S.iceCells.size > 0);
  restore(snap);
  assert.equal(S.iceCells.size, 0, 'rewound');
  L.handleCastAbility(wyld.id, 'Convert (Evaporate)', [], { x: centre.x, y: centre.y });
  if (S.awaitingReact) settleReacts(() => null);
  await newFight({ teamA: ['Kay Climber'], teamB: ['Meï'], seed: 1 });
  assert.equal(S.iceCells.size + S.driedCells.size, 0, 'fresh map');
});

// ── Passives gated on a context tag ────────────────────────────────────────

test('Zed adds Close Quarters Expert to melee blows only', async () => {
  await newFight({ teamA: ['Zed'], teamB: ['Kay Climber'], seed: 1 });
  const zed = byName('Zed'), kay = byName('Kay Climber');
  const far = freeRun(8);
  place(zed, far.x, far.y); place(kay, far.x + 1, far.y);
  zed.statusEffects.push(status('sure_hit'));
  assert.ok(L.resolveAttack(zed, kay, null).breakdown.includes('Close Quarters Expert['), 'adjacent');
  place(kay, far.x + 5, far.y);
  zed.statusEffects.push(status('sure_hit'));
  assert.ok(!L.resolveAttack(zed, kay, '1d4', { name: 'Throw', tags: ['ranged'] }).breakdown.includes('Close Quarters Expert['), 'five cells away');
});

test('Black Turtle adds Sunken Colossus while standing in water, and not on dry floor', async () => {
  await newFight({ teamA: ['Black Turtle'], teamB: ['Kay Climber'], seed: 1 });
  const turtle = byName('Black Turtle'), kay = byName('Kay Climber');
  const w = waterCell(), d = dryCell();
  place(kay, d.x + 1, d.y);
  place(turtle, d.x, d.y);
  turtle.statusEffects.push(status('sure_hit'));
  assert.ok(!L.resolveAttack(turtle, kay, null).breakdown.includes('Sunken Colossus['), 'dry');
  place(turtle, w.x, w.y); place(kay, w.x - 1, w.y);
  turtle.statusEffects.push(status('sure_hit'));
  assert.ok(L.resolveAttack(turtle, kay, null).breakdown.includes('Sunken Colossus['), 'in water');
});

// ── Dodge reacts against area moves ────────────────────────────────────────

// Fire Tornado, sure to land, on `reactor`; returns the HP the reactor lost
async function tornadoOn(reactor, react, seed = 3) {
  await newFight({ teamA: ['Eragon'], teamB: [reactor], seed });
  const eragon = byName('Eragon'), target = S.combatants.find(c => c.teamIndex === 1);
  const far = freeRun(8);
  place(eragon, far.x, far.y); place(target, far.x + 3, far.y);
  eragon.statusEffects.push(status('sure_hit'));
  toTurn('Eragon');
  const before = target.currentHp;
  applyPlan({ move: null, action: { type: 'cast', ability: 'Fire Tornado', targetIds: [target.id] } });
  settleReacts(() => react ? { combatantId: target.id, abilityName: react } : null);
  return before - target.currentHp;
}

for (const [who, react] of [['Dream Hunter', 'Hat Form'], ['Vayl-Soran', 'Lightning Flicker'], ['Zed', 'Shadow Dash'], ['Sun', 'Bunshin']]) {
  test(`${react} halves the area damage its owner takes`, async () => {
    const without = await tornadoOn(who, null);
    const withReact = await tornadoOn(who, react);
    assert.ok(without > 1, `fixture: ${who} takes ${without} without the react`);
    assert.equal(withReact, Math.floor(without / 2));
  });
}

test('a dodge react still avoids a single-target blow completely', async () => {
  await newFight({ teamA: ['Eragon'], teamB: ['Dream Hunter'], seed: 1 });
  const eragon = toTurn('Eragon'), hunter = byName('Dream Hunter');
  place(hunter, eragon.x + 1, eragon.y);
  eragon.statusEffects.push(status('sure_hit'));
  const before = hunter.currentHp;
  applyPlan({ move: null, action: { type: 'attack', targetId: hunter.id } });
  settleReacts(() => ({ combatantId: hunter.id, abilityName: 'Hat Form' }));
  assert.equal(hunter.currentHp, before);
});

test('pure dodge reactions are reactions only: they are not offered as moves for the turn', async () => {
  await newFight({ teamA: ['Dream Hunter', 'Zed', 'Vayl-Soran'], teamB: ['Meï'], seed: 1 });
  for (const [who, n] of [['Dream Hunter', 'Hat Form'], ['Zed', 'Shadow Dash'], ['Vayl-Soran', 'Lightning Flicker']]) {
    assert.equal(byName(who).abilities.find(a => a.name === n).reactOnly, true, n);
  }
});

// ── Mecha tag, Force Lightning, Ice Coffin vs wet, Anti-magic Slash ────────

test('Zane, Pixal and Future Zane are mechas, and Zane stops being one in Dragon Form', async () => {
  await newFight({ teamA: ['Zane Climber', 'Pixal', 'Future Zane'], teamB: ['Kay Climber'], seed: 1 });
  const zane = byName('Zane Climber');
  for (const n of ['Zane Climber', 'Pixal', 'Future Zane']) assert.equal(L.unitHasTag(byName(n), 'mecha'), true, n);
  assert.equal(L.unitHasTag(byName('Kay Climber'), 'mecha'), false);
  toTurn('Zane Climber');
  L.handleTransform(zane.id);
  assert.equal(zane.isTransformed, true);
  assert.equal(L.unitHasTag(zane, 'mecha'), false, 'the dragon is flesh');
});

test('Force Lightning adds 2d12 against a mecha, not against anyone else', async () => {
  await newFight({ teamA: ['Vorrakan Duskbane'], teamB: ['Pixal', 'Kay Climber'], seed: 1 });
  const vor = byName('Vorrakan'), pixal = byName('Pixal'), kay = byName('Kay Climber');
  const fl = vor.abilities.find(a => a.name === 'Force Lightning');
  vor.statusEffects.push(status('sure_hit'));
  assert.ok(L.resolveAttack(vor, pixal, fl.dice, fl).breakdown.includes('mecha['), 'against Pixal');
  vor.statusEffects.push(status('sure_hit'));
  assert.ok(!L.resolveAttack(vor, kay, fl.dice, fl).breakdown.includes('mecha['), 'against Kay');
});

test('Ice Coffin hits a wet target for 2d10 more', async () => {
  const lost = async wet => {
    await newFight({ teamA: ['Eragon'], teamB: ['Kay Climber'], seed: 4 });
    const eragon = byName('Eragon'), kay = byName('Kay Climber');
    const far = freeRun(8);
    place(eragon, far.x, far.y); place(kay, far.x + 3, far.y);
    eragon.statusEffects.push(status('sure_hit'));
    if (wet) L.applyStatus(kay, 'wet');
    toTurn('Eragon');
    const before = kay.currentHp;
    applyPlan({ move: null, action: { type: 'cast', ability: 'Ice Coffin', targetIds: [kay.id] } });
    settleReacts(() => null);
    return before - kay.currentHp;
  };
  const dry = await lost(false), soaked = await lost(true);
  assert.ok(soaked - dry >= 2 && soaked - dry <= 20, `dry ${dry}, wet ${soaked}`);
});

test('Anti-magic Slash switches the passives of those it hits off for 1 turn', async () => {
  await newFight({ teamA: ['Hela, Goddess of Death'], teamB: ['Kay Climber'], seed: 1 });
  const hela = toTurn('Hela'), kay = byName('Kay Climber');
  const far = freeRun(8);
  place(hela, far.x, far.y); place(kay, far.x + 2, far.y);
  hela.statusEffects.push(status('sure_hit'));
  const armoured = L.defenseBonus(kay, hela, null);
  assert.ok(armoured > 0, 'fixture: Kay has armour');
  applyPlan({ move: null, action: { type: 'cast', ability: 'Anti-magic Slash', targetIds: [kay.id] } });
  settleReacts(() => null);
  assert.ok(kay.statusEffects.some(e => e.name === 'passives_off'));
  assert.equal(L.defenseBonus(kay, hela, null), 0, "armour is off (Kay's turn is under way)");
  L.tickTurn(kay);
  assert.equal(L.defenseBonus(kay, hela, null), armoured, 'back once that turn is over');
});
