// Team synergies. Pure data and rules, no engine state: combat-logic.js feeds in the living members of a team.
//
// A synergy gives either a BUFF (read as extra effects on a unit's rolls, speed, initiative or damage taken) or a
// TECHNIQUE (a once-per-fight move shared by the whole team). Never both.

export const FACTION_NINJAS = 'Ninjas';

const CLIMBERS = ['Kay Climber', 'Jay Climber', 'Zane Climber', 'Cole Climber'];

// ── Buffs ───────────────────────────────────────────────────────────────────

// The element a ninja fights with, read from the sheets (Wyldfire holds two; Susano and the rest hold none)
export const NINJA_ELEMENTS = {
  fire:      ['Kay Climber', 'Kay Demon', 'Ray', 'Wyldfire'],
  ice:       ['Zane Climber', 'Future Zane', 'Ivo', 'Wyldfire'],
  lightning: ['Jay Climber', 'Sensei Lloyd', 'Ronin Lloyd', 'Mira', 'Libber'],
  earth:     ['Cole Climber', 'Nate', 'Bentei'],
  water:     ['Nya Léviathan', 'Maya'],
};

const MECHA_PARTNERS = ['Zane Climber', 'Future Zane'];
const STORM_PAIR = ['Mira', 'Libber', 'Jay Climber'];
const SENSEI = 'Sensei Lloyd';
const SENSEI_RADIUS = 6;
const SIBLINGS = ['Kay Climber', 'Nya Léviathan'];

const isNinja = c => [].concat(c.sourceChar.faction ?? []).includes(FACTION_NINJAS);
const has = (team, name) => team.some(u => u.name === name);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Is `c` one of two named fighters that both stand? Returns the partner or null. */
export function siblingOf(c, team) {
  if (!SIBLINGS.includes(c.name)) return null;
  return team.find(u => u.id !== c.id && SIBLINGS.includes(u.name) && u.name !== c.name) ?? null;
}

export const mechaLinked = (c, team) =>
  (c.name === 'Pixal' && team.some(u => MECHA_PARTNERS.includes(u.name)))
  || (MECHA_PARTNERS.includes(c.name) && has(team, 'Pixal'));

export const stormPaired = (c, team) => STORM_PAIR.includes(c.name) && team.some(u => u.id !== c.id && STORM_PAIR.includes(u.name));

/**
 * The synergy effects that reach `c`, given the living members of its team (c included).
 * Each effect: { nom, dices, applyOn: [...], ifTag? }. `applyOn` uses the engine's roll names; 'allRolls' stands for
 * the attack, defense and magic rolls, as it does for passives. `ifTag` restricts an effect to moves with that tag.
 */
export function buffEffects(c, team) {
  const out = [];

  // 1. Ninja Teamwork: the more ninjas stand together, the better they move and fight (highest tier only)
  if (isNinja(c)) {
    const n = team.filter(isNinja).length;
    if (n >= 2) out.push({ nom: 'Ninja Teamwork', dices: '+2', applyOn: ['initRoll'] }, { nom: 'Ninja Teamwork', dices: '+1', applyOn: ['speed'] });
    if (n === 3) out.push({ nom: 'Ninja Teamwork', dices: '+1', applyOn: ['allRolls'] });
    else if (n >= 4) out.push({ nom: 'Ninja Teamwork', dices: '+2', applyOn: ['allRolls'] });
  }

  // 2. Elemental Kin: two ninjas of one element add 1d4 to the moves of that element
  for (const [element, names] of Object.entries(NINJA_ELEMENTS)) {
    if (names.includes(c.name) && team.filter(u => names.includes(u.name)).length >= 2) {
      out.push({ nom: 'Elemental Kin', dices: '+1d4', applyOn: ['atkRoll'], ifTag: element });
    }
  }

  // 5. Mecha Link: Pixal and a Zane stand together
  if (mechaLinked(c, team)) out.push({ nom: 'Mecha Link', dices: '+3', applyOn: ['allRolls'] });

  // 6. Siblings: Kay and Nya each take 1d4 less while the other stands (the guard after a hit lives in the engine)
  if (siblingOf(c, team)) out.push({ nom: 'Siblings', dices: '-1d4', applyOn: ['incomingDam'] });

  // 7. Sensei's Guidance: Lloyd with two more ninjas steadies every ally within reach
  const sensei = team.find(u => u.name === SENSEI);
  if (sensei && team.filter(u => u.id !== sensei.id && isNinja(u)).length >= 2 && cheb(sensei, c) <= SENSEI_RADIUS) {
    out.push({ nom: "Sensei's Guidance", dices: '+1d4', applyOn: ['defRoll'] });
  }

  // 9. Storm Pair: lightning moves of the pair add 1d6 (and may paralyse, see combat-logic applyMoveEffect)
  if (stormPaired(c, team)) out.push({ nom: 'Storm Pair', dices: '+1d6', applyOn: ['atkRoll'], ifTag: 'lightning' });

  return out;
}

// ── Techniques ──────────────────────────────────────────────────────────────

/**
 * A technique is a move every member carries, tagged with its key. It is usable only by a team that FIELDED the
 * required members, only while `min` of its members still stand, once per fight for the whole team. Its dice grow
 * with the members standing. A twist adds to the strike depending on who fires it:
 *   tags / effect: extra damage types and the status it lays on every foe it reaches
 *   after:         something the strike also does ('orders' gives the team Clay's Orders, 'mend' heals the allies)
 */
export const TECHNIQUES = {
  // Nexo Knights: all five fielded
  nexoCombined: {
    members: ['Alicia', 'Aron', 'Lance', 'Axel', 'Clay'], fielded: ['Alicia', 'Aron', 'Lance', 'Axel', 'Clay'], min: 2,
    dice: n => `${n}d12`,
    twists: {
      Alicia: { tags: ['fire'], effect: 'burn' },
      Aron:   { tags: ['unreactable'] },
      Axel:   { tags: ['root'], effect: 'root' },
      Clay:   { after: 'orders' },
    },
  },
  // 3. Climber Spinjitzu: the four Climbers fielded, Nya Léviathan joins if she is there
  climberSpinjitzu: {
    members: [...CLIMBERS, 'Nya Léviathan'], fielded: CLIMBERS, min: 2,
    dice: n => `${n}d12`,
    twists: {
      'Kay Climber':   { tags: ['fire'], effect: 'burn' },
      'Jay Climber':   { tags: ['lightning'], effect: '1d2 para' },
      'Zane Climber':  { tags: ['ice'], effect: '1d2 freeze' },
      'Cole Climber':  { tags: ['earth'], effect: 'prone' },
      'Nya Léviathan': { tags: ['water'], effect: 'wet' },
    },
  },
  // 4. Dragon Masters: any two Climbers fielded, the breath takes the element of whoever fires it
  dragonMasters: {
    members: CLIMBERS, fielded: null, fieldedAtLeast: 2, min: 2,
    dice: n => `${2 * n}d10`,
    twists: {
      'Kay Climber':  { tags: ['fire'] },
      'Jay Climber':  { tags: ['lightning'] },
      'Zane Climber': { tags: ['ice'] },
      'Cole Climber': { tags: ['earth'] },
    },
  },
  // 8. Imperium Trio: Sora, Arin and Wyldfire fielded
  imperiumStrike: {
    members: ['Sora', 'Arin', 'Wyldfire'], fielded: ['Sora', 'Arin', 'Wyldfire'], min: 2,
    dice: n => `${n}d12`,
    twists: {
      Sora:     { after: 'mend' },
      Arin:     { effect: 'prone' },
      Wyldfire: { tags: ['fire', 'ice'], effect: '1d2 freeze' },
    },
  },
};

export const TECHNIQUE_KEYS = Object.keys(TECHNIQUES);

/** The key of the technique an ability carries, or undefined */
export const techniqueOf = ab => (ab?.tags?.length ? TECHNIQUE_KEYS.find(k => ab.tags.includes(k)) : undefined);

/** May this team (every combatant it fielded, fallen ones included) hold the technique? */
export function techniqueFielded(tech, fielded) {
  const names = new Set(fielded.map(u => u.name));
  if (tech.fielded) return tech.fielded.every(n => names.has(n));
  return tech.members.filter(n => names.has(n)).length >= (tech.fieldedAtLeast ?? 1);
}

/** How many of the technique's members still stand */
export const techniqueStanding = (tech, living) => tech.members.filter(n => living.some(u => u.name === n)).length;
