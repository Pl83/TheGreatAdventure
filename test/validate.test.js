import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateChars } from '../js/combat-logic.js';

test('validateChars: real characters.json is clean', () => {
  const chars = JSON.parse(readFileSync(new URL('../js/characters.json', import.meta.url)));
  assert.deepEqual(validateChars(chars), []);
});

test('validateChars: flags missing fields and bad types', () => {
  const w = validateChars([
    { nom: 'Good', hp: 10, baseAtk: { nom: 'X', dices: '1d6' }, moveSet: [] },
    { hp: -1, baseAtk: {}, moveSet: [{ category: 'spell', base: {}, target: 'wat' }] },
    { nom: 'Good' },   // duplicate name + missing hp/baseAtk
  ]);
  assert.ok(w.some(x => x.includes('missing/invalid "nom"')));
  assert.ok(w.some(x => x.includes('hp must be a positive number')));
  assert.ok(w.some(x => x.includes('baseAtk needs nom + dices')));
  assert.ok(w.some(x => x.includes('missing base.nom')));
  assert.ok(w.some(x => x.includes('duplicate character name')));
});

test('validateChars: non-array input', () => {
  assert.deepEqual(validateChars({}), ['characters.json is not an array']);
});
