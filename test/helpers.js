/* Shared test helpers: seeded RNG + combatant factory. */
import { buildCombatant, S } from '../js/combat-logic.js';

// Deterministic PRNG (mulberry32) so seeded fights are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RNG that yields the given fractions in order (loops when exhausted).
// Lets a test force specific d20 / damage rolls.
export function seqRng(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

// Fraction that makes rollDie(sides) return `n` (1..sides).
export function frac(n, sides) {
  return (n - 0.5) / sides;
}

// Minimal valid character used by unit tests.
export function makeChar(overrides = {}) {
  return {
    nom: 'Test',
    hp: 50,
    spellSlot: 0,
    ki: 0,
    kiRegen: 0,
    speed: 6,
    autority: 0,
    immunities: [],
    baseAtk: { nom: 'Punch', dices: '1d6+2', tags: ['physical'] },
    passif: [],
    moveSet: [],
    ...overrides,
  };
}

// Reset global combat state and register two fresh combatants.
export function resetState(charA = makeChar(), charB = makeChar({ nom: 'Foe' })) {
  S.combatants = [
    buildCombatant(charA, 0, 0),
    buildCombatant(charB, 1, 1),
  ];
  S.initiativeOrder = [0, 1];
  S.currentTurnIndex = 0;
  S.roundNumber = 1;
  S.log = [];
  S.pendingAction = null;
  S.awaitingReact = false;
  S.reactOptions = [];
  S.activeDomains = [];
  S.winnerTeam = null;
  S.hasActed = false;
  S.currentMap = null;
  return S.combatants;
}
