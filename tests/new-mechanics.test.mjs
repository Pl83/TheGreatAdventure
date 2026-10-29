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
      assert.ok(texts.slice(at).some(t => new RegExp(`${me.name} (hits|misses) ${target.name}|CRITICAL|FUMBLE`).test(t)), 'and rolled');
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
