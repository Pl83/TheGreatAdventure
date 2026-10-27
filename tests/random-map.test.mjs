import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRandomMapOrManor, RANDOM_MAX_ATTEMPTS } from '../js/random-map.js';

// A 12x5 room plus a 12x5 room far to the right: aligns and gives 5v5 starts.
const goodJson = {
  title: 'Good Dungeon', story: 's',
  rects: [{ x: 0, y: 0, w: 6, h: 4 }, { x: 14, y: 0, w: 6, h: 4 }],
  doors: [],
};
// cols = 20 + 2, rows = 4 + 2
const goodImage = { naturalWidth: 22 * 70, naturalHeight: 6 * 70 };
const badImage  = { naturalWidth: 23 * 70, naturalHeight: 6 * 70 };
// Two tiny rooms side by side: too few start cells and too close.
const crampedJson = { title: 'Cramped', rects: [{ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 0, w: 2, h: 2 }], doors: [] };

const FALLBACK = { slug: 'manor_of_nadargath', name: 'Manor' };
const loadFallback = async () => FALLBACK;

// Each call to run() takes the next scripted outcome: { json, image } or an Error.
function scripted(outcomes) {
  const seeds = [];
  const run = async seed => {
    seeds.push(seed);
    const o = outcomes[seeds.length - 1];
    if (o instanceof Error) throw o;
    return { json: o.json, png: o.image };
  };
  return { run, decode: async png => png, seeds };
}

test('returns the generated map when the first attempt is valid', async () => {
  const s = scripted([{ json: goodJson, image: goodImage }]);
  const map = await loadRandomMapOrManor({ ...s, loadFallback });
  assert.equal(map.name, 'Good Dungeon');
  assert.equal(map.starts[0].length, 5);
  assert.equal(s.seeds.length, 1);
});

test('retries with a new seed when the first attempt fails alignment, and uses the second', async () => {
  const s = scripted([{ json: goodJson, image: badImage }, { json: { ...goodJson, title: 'Second' }, image: goodImage }]);
  const map = await loadRandomMapOrManor({ ...s, loadFallback });
  assert.equal(map.name, 'Second');
  assert.equal(s.seeds.length, 2);
  assert.notEqual(s.seeds[0], s.seeds[1]);
});

test('retries when startsOk is false', async () => {
  const s = scripted([{ json: crampedJson, image: { naturalWidth: 7 * 70, naturalHeight: 4 * 70 } },
                      { json: goodJson, image: goodImage }]);
  const map = await loadRandomMapOrManor({ ...s, loadFallback });
  assert.equal(map.name, 'Good Dungeon');
});

test('gives up after 3 attempts and returns the fallback', async () => {
  const s = scripted(Array(5).fill({ json: goodJson, image: badImage }));
  const map = await loadRandomMapOrManor({ ...s, loadFallback });
  assert.equal(map, FALLBACK);
  assert.equal(s.seeds.length, RANDOM_MAX_ATTEMPTS);
});

test('returns the fallback when the total budget expires, and a late result is discarded', async () => {
  let release, signalSeen;
  const run = (seed, signal) => {
    signalSeen = signal;
    return new Promise(r => { release = () => r({ json: goodJson, png: goodImage }); });
  };
  const map = await loadRandomMapOrManor({ run, decode: async p => p, loadFallback, budgetMs: 30 });
  assert.equal(map, FALLBACK);
  assert.equal(signalSeen.aborted, true);
  release();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(map, FALLBACK);
});

test('never rejects when run throws', async () => {
  const s = scripted([new Error('boom'), new Error('boom'), new Error('boom')]);
  const map = await loadRandomMapOrManor({ ...s, loadFallback });
  assert.equal(map, FALLBACK);
});
