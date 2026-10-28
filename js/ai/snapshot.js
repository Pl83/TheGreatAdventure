// Snapshot / restore of the whole fight state, in place, so a search can rewind thousands of times.
// The live S and combatant objects keep their identity; only their contents are swapped back.
import { S } from '../combat-logic.js';

// Data that is never mutated mid-fight: held by reference, not cloned
const REF_KEYS = new Set(['sourceChar', 'abilities', 'currentMap', 'ability', 'domain',
  'aimAbility', 'teleportGroup', 'pendingTeleportReact']);

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out;
  }
  if (v instanceof Map) {
    const out = new Map();
    for (const [k, x] of v) out.set(k, clone(x));
    return out;
  }
  if (v instanceof Set) return new Set([...v].map(clone));
  const out = {};
  for (const k in v) out[k] = REF_KEYS.has(k) ? v[k] : clone(v[k]);
  return out;
}

// Replace obj's contents with a fresh copy of data, keeping obj itself
function overwrite(obj, data) {
  for (const k in obj) if (!(k in data)) delete obj[k];
  for (const k in data) obj[k] = REF_KEYS.has(k) ? data[k] : clone(data[k]);
}

export function snapshot() {
  const state = {};
  for (const k in S) if (k !== 'combatants' && k !== 'log') state[k] = REF_KEYS.has(k) ? S[k] : clone(S[k]);
  return { state, combatants: S.combatants.map(c => ({ c, data: clone(c) })), logLen: S.log.length };
}

export function restore(snap) {
  const { state, combatants, logLen } = snap;
  for (const k in S) if (k !== 'combatants' && k !== 'log' && !(k in state)) delete S[k];
  for (const k in state) S[k] = REF_KEYS.has(k) ? state[k] : clone(state[k]);
  S.log.length = logLen;
  for (const { c, data } of combatants) overwrite(c, data);
}
