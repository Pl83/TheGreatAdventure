# Google Doc import: notes (to settle case by case)

Source: the Google Doc, tabs 2 to 13 (the "orcs" tab is ignored). 51 sheets were added at the end of
`js/characters.json`. No existing sheet was modified.

## 1. Already on the site: untouched, waiting for instructions

Susano, Sensei Lloyd (SETTLED), Kay / Zane / Jay / Cole Climber, Nya Léviathan, Kay Demon, Pixal, Sora, Arin, Wyldfire,
Ronin Lloyd, Mira, Nate, Jhin, Future Zane, Sun, Meï, Krilin, Baal, Jay Azure Dragon, Zhuqiao, Vayl-Soran,
Alicia (appears in two tabs), Oslo, Kadgar, Eragon, Heracles, Huītzilōpōchtli, Rig, Glysain, Zed, Morrow,
Anti-magic Squelettes, Hela, Astrid (SETTLED), Sylvanas (SETTLED), Dave (SETTLED), Spheras Nightmare (SETTLED), Dream Hunter (SETTLED), Astrid Nightmare (SETTLED),
Sylvanas Nightmare (SETTLED), Thormak (SETTLED), Ras (SETTLED), General of the Wolf Clan (SETTLED), Cinder (SETTLED), Kaelgrym (SETTLED), Vorrakan Duskbane, White.

- **Jaegen** (doc) is **"Jeagen, White Tiger"** on the site: spelling differs, same character.
- I did not compare the contents of these sheets with the doc; say which ones you want diffed.

## 2. Forms

Oni Lloyd, the four Dragon forms, Blood General and Blood Cinder ALREADY exist as `transformation` blocks on
their owners (an earlier version of this note said otherwise: that was wrong). Only the Left and Right Chain of
Vorrakan (150 HP each) are missing as units. All of this is in `js/todo.json` (ids `decide-*`).

## 2b. Differences between the doc and the existing sheets (nothing changed)

Some may be deliberate balance patches (Zhuqiao was nerfed on purpose, for instance). "Doc" is the Google Doc.

**Susano — SETTLED** (doc applied for the numbers; Divinity added to Nirvana and to Hela and Chronos as the sheet tag `divinity`; flight is permanent in Nirvana; the base form keeps its four spells). Original differences: slots doc 15 / site 9. Fire Ball 1d12+10 / 1d10+10. Golden Beam 2d20+25 / 2d20+20. Nirvana cleaver
2d10+10 / 2d8+8. Each stone gives 1d8 (doc) / 1d6 (`main.js`). Nirvana: "two different actions a turn" is missing.
The base form has no spells in the doc, the site gives it Fire Ball, Lightning Shield, Ice Coffin, Earth Spike.
True Power is "[fly, instant, 5t]" in the doc; the site has no fly move.

**Pixal, Arin, Wyldfire — SETTLED** (see `decide-pixal-arin-wyldfire-doc`; traps and lock picking wait on `mech-map-traps`).

**Kadgar — SETTLED** (see `decide-kadgar-doc` in the todo; Arcane Copy stays open as `mech-arcane-copy`). Original differences: missing on the site: Greater Invisibility, Greater Levitation (5 turns), Mana Wall, Binding (1d2 stun),
Meteor Shower 4d10, Dispel Magic, Arcane Copy. The Great Staff should also allow two spells a turn. The site has
an Ice Tomb the doc does not list, and a Great Staff basic attack 1d6+2 the doc does not give.

**Hela — SETTLED** (see `decide-hela-doc`). Original differences: slots doc 20 / site 15. Anti-Magic below Authority 9 (doc) / 8 (site). Undying Queen heals 30 HP a turn
(doc) / 20 (site). Final Reckoning: +1d10 HP a turn and +2 actions (doc) / act twice and +2d12 damage (site).
"Divinity: two different actions a turn" is missing. Anti-magic Slash 2d12+4, 4T, seals magic for 1 turn (doc) /
2d12, 1 slot, disables passives (site). Death Gaze: disadvantage on attack and defense plus a 1d2 stun chance,
2T (doc) / 2-turn stun plus fear (site). Perfect Reflection just redirects the spell (doc) / doubles it (site).
The site also has Weapon Wall, Living Blade Armor and Balmung, which the doc does not list.

**Others (hard numbers)**:
- Meï, Krilin, Baal, Eragon, Sun, Oslo — SETTLED (`decide-ki-sun-oslo-eragon-doc`).
- Krilin: starting ki doc 5 / site 0 (his Banquet costs 5, so he cannot cast it at the start).
- Baal: ki doc 10 / site 6 (Spirit of the Wild Boar costs 10).
- Ronin Lloyd, Mira, Nate, Jhin, Future Zane — CHECKED, identical to the doc (nothing to change).
- Sensei Lloyd, Nya, Kay Demon — SETTLED (`decide-lloyd-nya-demon-doc`): HP 70; Nya already matched; Demon takes -15 on magic, no Volcana miss.
- Eragon: HP doc 55 / site 50. Fire Tornado 3d12 / 2d12. Water Dragon 3d12+1d8 / 2d12+1d8. Ice Coffin 2d12 / 1d12.
  Missing: Arcane Missile, Mana Wall, Dragon Breath, Meteor Shower. Shield 30 temp HP (doc) / 20.
- Jay, Azure Dragon: spell slots doc 8 / site 6. Verdant Surge 1d20 / 1d20+6.
- Sun: basic attack 1d12+6 (doc) / 2d8+1d12+6 (site).
- **Climbers — SETTLED** (see `decide-climbers-doc`). Cole: Heavy Power Hammer 2d8+2 and 1d2 stun (doc) / 1d12+6 (site). Forms: duration, Lose Armored, Jay's slots and advantage, flight.
- Oslo: Marrow Spear 1d8 mono + 1d6 aoe (doc) / 1d20 (site).
- Vorrakan: sword attack 2d8+6 (doc) / 2d6+8 (site). Kaelgrym: SETTLED. "ssd20+10" reads as spell slots d20+10 (Final Brasero spends them all).
- White: HP doc 350 / site 250. Every attack is one die size bigger in the doc (Flame of the Dead 1d10+3,
  Phantom Sword 2d8+4, Rise 3d8+9, Wake 3d10+4, Seven Blood 1d10+8, Diverging Sword 12d12+20).
- Zhuqiao: Solar Flare 2d10+6 in the doc. Her site numbers were reduced on purpose in the last commits.
- Alicia: 5 slots in the doc, 14 on the site (5 plus 9 from Odin's Blessing): same thing.

The comparison was done by a script on HP, slots, ki and dice, then read by hand for the ones above; sheets not
listed matched on those fields, but a missing passive could still slip through.

## 3. Not added

- **Yangshi** (Murim tab): the doc only says "60hp :" with nothing else. Needs a sheet.

## 4. Summons (engine done)

Fire Spirit (Irina), Golem (Leonidas) and Floating Head (Sorcerer Master) are sheets with the tag `summon`, kept off the
team selection grid and the tuner roster. Rules, as decided:

- Called by a move (`summon: {unit, count}`): Flaming Bird (1 ki, one Fire Spirit), Golem Creation (1d4 Golems). They
  appear on free cells beside the caster and act right after the caster's turn. No cap on the engine side; the AI
  keeps at most 3 of a kind. Living Bomb bursts every Fire Spirit on its own spot (radius 3) and spends it.
- Companion (`companion` on the sheet): the Sorcerer Master's Floating Head is in the fight from round 1, beside him,
  acting right after him with its own move and action.
- A summon never counts toward victory (a team with only summons left is beaten) and falls with its caster.
- Flaming Bird is a normal action, not the instant the doc names, so the greedy policy can cast it.
- Still descriptions only: Summoning Portal's time remnant, Sacrifice Mark's demons.

## 5. Uncertainties

Doc symbols read as: `( )` passive, `{ }` spell, `[ ]` technique, `<< >>` relic, `" "` basic attack.

- **Stray numbers** after some sheets (Ray "129 | 4", Maya "119| 4", Libber "115", Bentei "151 | 3", Hero orc "94"):
  meaning unknown (power score? level?). Ignored.
- **Weapon names**: when the doc gives only dice, I used a generic name ("Weapon", "Sword").
  Real names are needed for Ray, Maya, Libber, Bentei, Ivo, Stormer, Leonidas, Libra, Argo, Aron, Lance, Axel,
  Clay, Atila, Nokt (Anchor Swipe is given), the Ghouls, Amalgame.
- **Mechanics with no engine equivalent**, written as descriptions only (no effect in combat):
  Irina (Flaming Bird summons, combustion stacks), Leonidas (Golem and Weapon Creation), Maya (High-Pressure
  Mastery, Fluid Parry counter), Ray (Master Blacksmith), Libber (Static Charge, Thunder Step multiplier),
  Libra (Reequip, Arrow Dancer, Battle Medic heal bonus), Ouroboros (Stance Switch), Starburst (Star Link table),
  Graviton (flight removal, Black Hole vs ranged), Ivy (Acid Armor thorns), Electro (Lightning Rod),
  Arthur (Holy Duel: +2× target max HP), Emeraud (Petrify stacks), Rubis (hit count), Amethyst (psy save to attack
  allies), Aron (Dead Eye), Lance (Faster halves damage), Axel (Sturdy 1d4), Clay (Leader), Kyros (Destiny's Fire
  and The End Slash thresholds), Krux & Acronix (Geminy, portal, Pause/Play/Forward/Backward), Annastasia (Demon
  Pact, Sacrifice Mark, Taboo), Vampire Sienna and Sienna (hunter mark, Blood Magic, SteamGun), Atila, Rox
  (Aura of Terror, Psychic Link), Zarkt (Tides of Misfortune, Curse Reflect, Entropy Field), Drix (Hive Mind),
  Kur (Life Siphon bonus), Phoenix King/Prince (feathers, grow spurt: modelled as a once-per-fight relic and a
  transformation).
- **Specific doubts**:
  - Ray: "Heat Haze" is an aoe react giving allies +4 defense: modelled as a react aoe spell with a description.
  - Escanor: "deal 1d4 dam around him" and the +5 per calcinated stack are descriptions only.
  - Kyros: "10 spells" read as 10 spell slots; the Motion Channel / Motion Guard cooldowns (4T, 8T) read as turns.
  - Krux & Acronix: "180hp | 25 spell slot" read as one unit.
  - Sword Master / Sorcerer Master / Ghouls: "Anti-Magic -20 magic dam flat" read as −20 on incoming magic
    damage; "Magic resist −10" the same with 10. Not given the `magic` immunity, except the two Masters.
  - Gems (Diamant, Rubis, Emeraud, Saphir, Amethyst): shared kit copied to each; the weapon is a generic
    "Sword". Saphir's Prismatic Guard (reflect) has cooldown 0 as the doc says "0T".
  - Phoenix King's "Phoenix feathers 4/4": a relic with 4 charges; Phoenix Prince has 1.
  - Stormer's Storm End listed as a relic (`<< >>`), range 0 taunt, duration 2.
  - Drix: "5d4 + 1d2 poison + 1d2 para" keeps only the poison as `effect`.
  - Arya: "Elfes, +3init, +5perception" split in two passives.
- Ranges, radii and cooldown conversions ("3t" = cooldown 3) follow the conventions of existing sheets; ranges
  were guessed where the doc gives none.
- The new sheets are not balanced or tuned: they have not been through `tools/acceptance.mjs`.

## 6. Verification

`node --test` on every test file except `acceptance` (417 tests) passes. All 51 sheets were played in simulated
5v5 fights with no violation.
