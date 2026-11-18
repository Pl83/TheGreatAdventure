import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrame, clearFrame, createFx } from '../js/vendor/pixelfx/core/index.js';
import { FX_DEFS, hitKind, playFx } from '../js/vfx.js';

test('hitKind: element first, weight second', () => {
  assert.equal(hitKind('fire', [], 5, 100), 'fire');
  assert.equal(hitKind('necro', [], 5, 100), 'dark');
  assert.equal(hitKind('holy', [], 5, 100), 'radiant');
  assert.equal(hitKind(null, ['magic', 'lightning'], 5, 100), 'lightning');
  assert.equal(hitKind('physical', [], 5, 100), 'physical');
  assert.equal(hitKind('physical', [], 30, 100), 'heavy');
  assert.equal(hitKind(null, [], 50, 100), 'critical');
});

test('every effect draws something and ends once told to', () => {
  for (const [kind, def] of Object.entries(FX_DEFS)) {
    const fx = createFx(def.mod, { seed: 3, ...(def.palette ? { palette: def.palette } : {}) });
    const frame = createFrame(320, 260, 0, 0);
    fx.options.x = 160; fx.options.y = 140;
    let drew = false;
    for (let t = 0; t < def.cap; t += 1 / 60) {
      fx.update(1 / 60);
      clearFrame(frame); fx.draw(frame, 'back'); fx.draw(frame, 'front');
      if (frame.color.some(Boolean) || frame.light.some(Boolean)) drew = true;
    }
    assert.ok(drew, `${kind} drew nothing`);
    fx.stop();
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    assert.ok(fx.done(), `${kind} did not end`);
  }
});

test('playFx is a no-op without a DOM (headless)', () => {
  assert.doesNotThrow(() => playFx('fire', { x: 1, y: 1 }, 70));
});
