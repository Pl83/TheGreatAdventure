// Development-only: runs the real combat engine in Node, without a browser.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT_URL = new URL('../', import.meta.url);
const ROOT = fileURLToPath(ROOT_URL);

export function installShims() {
  globalThis.document ??= {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null }),
  };
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async path => {
    const text = await readFile(new URL(String(path), ROOT_URL), 'utf8');
    return { ok: true, json: async () => JSON.parse(text), text: async () => text };
  };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function checkNames(names, known) {
  for (const name of names) {
    if (known.includes(name)) continue;
    const close = [...known].sort((a, b) => editDistance(name.toLowerCase(), a.toLowerCase())
                                          - editDistance(name.toLowerCase(), b.toLowerCase())).slice(0, 3);
    throw new Error(`Unknown character "${name}". Closest: ${close.join(' | ')}`);
  }
}

export async function newFight({ teamA, teamB, seed, map = 'manor_of_nadargath' }) {
  installShims();
  const L = await import('../js/combat-logic.js');
  const { buildMap } = await import('../js/dungeon-loader.js');
  const { setRandom, mulberry32 } = await import('../js/rng.js');

  L.setHeadless(true);
  await L.loadChars();
  checkNames([...teamA, ...teamB], L.allChars.map(c => c.nom));

  const data = JSON.parse(await readFile(`${ROOT}maps/${map}/${map}.json`, 'utf8'));
  const perTeam = Math.max(4, teamA.length, teamB.length);
  const first = buildMap({ slug: map, data, image: { naturalWidth: 70, naturalHeight: 70 }, perTeam });
  const { cols, rows } = first.grid;
  const built = buildMap({ slug: map, data, image: { naturalWidth: cols * 70, naturalHeight: rows * 70 }, perTeam });

  setRandom(mulberry32(seed));
  Object.assign(L.S, {
    teamNames: [[...teamA], [...teamB]], currentMap: built, phase: 'selection',
    combatants: [], initiativeOrder: [], pendingAction: null, awaitingReact: false, reactOptions: [],
    activeDomains: [], log: [], winnerTeam: null, roundNumber: 1,
  });
  L.clearAimState();
  L.exitTeleportMode();
  L.S.pendingTeleportReact = null;
  L.S.lastTeleportedIds = null;
  await L.startInitiative();
  L.startCombat();
}
