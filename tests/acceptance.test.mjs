import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ACCEPTANCE = fileURLToPath(new URL('../tools/acceptance.mjs', import.meta.url));

test('acceptance --quick runs the five stages and passes', () => {
  // execFileSync throws on a non-zero exit, with the output attached
  let out;
  try {
    out = execFileSync(process.execPath, [ACCEPTANCE, '--quick'], { encoding: 'utf8' });
  } catch (err) {
    assert.fail(`exit ${err.status}\n${err.stdout}\n${err.stderr}`);
  }
  for (const stage of ['strength', 'violations', 'determinism', 'time', 'demonstrations']) {
    assert.match(out, new RegExp(`^PASS  ${stage}: `, 'm'));
  }
  assert.match(out, /5 of 5 stages passed/);
});
