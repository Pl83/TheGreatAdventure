/* ═══════════════════════════════════════════════════════════════════════════
   js/combat.js — Turn-Based DnD Combat Simulator
   ═══════════════════════════════════════════════════════════════════════════ */

// ── §1  Imports ────────────────────────────────────────────────────────────
import { personnageSheet, EFFECTS } from './main.js';

// ── §2  State ──────────────────────────────────────────────────────────────
const S = {
  phase: 'selection',   // 'selection' | 'initiative' | 'combat' | 'victory'
  teamNames: [[], []],  // up to 4 character names per team
  combatants: [],
  initiativeOrder: [],  // ordered list of combatant ids (desc initiative)
  currentTurnIndex: 0,
  roundNumber: 1,
  pendingAction: null,  // { type, attackerId?, defenderId?, casterId?, targetIds?, result, ability? }
  awaitingReact: false,
  reactOptions: [],     // [{ combatantId, ability }]
  log: [],              // [{ text, flavor }]
  winnerTeam: null,
};

const root = document.getElementById('combat-root');

// ── §3  Data Helpers ───────────────────────────────────────────────────────

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollD20() {
  const v = rollDie(20);
  return { value: v, isNat20: v === 20, isNat1: v === 1 };
}

/**
 * Roll a dice expression like "2d8+4", "1d12+1d6+2", "6*1d6 fire", "1d8 aoe".
 * Returns { total, breakdown }.
 */
function parseDice(expr) {
  if (!expr || expr === '—' || expr === '-') return { total: 0, breakdown: '—' };
  let s = String(expr);

  // Normalise N*MdY → (N*M)dY  e.g. "6*1d6" → "6d6"
  s = s.replace(/(\d+)\s*\*\s*(\d+)d(\d+)/gi, (_, mult, cnt, sides) =>
    `${parseInt(mult) * parseInt(cnt)}d${sides}`
  );

  const parts = [];
  let total = 0;

  // Roll all XdY dice terms
  const diceRe = /(\d+)d(\d+)/gi;
  let m;
  while ((m = diceRe.exec(s)) !== null) {
    const count = parseInt(m[1]);
    const sides = parseInt(m[2]);
    const rolls = [];
    let sub = 0;
    for (let i = 0; i < count; i++) {
      const r = rollDie(sides);
      rolls.push(r);
      sub += r;
    }
    total += sub;
    parts.push(`${count}d${sides}[${rolls.join('+')}]=${sub}`);
  }

  // Extract +N / -N bonuses that are NOT followed by % (to skip "50% missing hp")
  const stripped = s.replace(/\d+d\d+/gi, '');
  const bonusRe = /([+-]\s*\d+)(?!\s*%)/g;
  while ((m = bonusRe.exec(stripped)) !== null) {
    const val = parseInt(m[1].replace(/\s/g, ''));
    if (!isNaN(val) && val !== 0) {
      total += val;
      parts.push(val > 0 ? `+${val}` : `${val}`);
    }
  }

  // Fallback: plain number
  if (parts.length === 0) {
    const numM = s.match(/^(\d+)/);
    if (numM) { total = parseInt(numM[1]); parts.push(String(total)); }
  }

  return { total: Math.max(0, total), breakdown: parts.join(' ') || '0' };
}

function findEffect(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  return EFFECTS.find(e => e.name.toLowerCase() === n) ?? null;
}

function parseResourceCost(costStr) {
  if (!costStr) return null;
  const s = String(costStr).toLowerCase().replace(/\s/g, '');
  // Ki first (avoid clash with "s" in "souls")
  const kiM = s.match(/(\d+)ki/);
  if (kiM) return { type: 'ki', amount: parseInt(kiM[1]) };
  // Spell slots: digits followed by 's' NOT 'souls'
  const slotM = s.match(/^(\d+)s$/);
  if (slotM) return { type: 'slots', amount: parseInt(slotM[1]) };
  // Souls: "10s", "100s", "1000s" (already caught by slotM if pure "Xs")
  // Try "Xs" broadly where s is the whole suffix
  const soulM = s.match(/(\d+)s/);
  if (soulM) return { type: 'souls', amount: parseInt(soulM[1]) };
  return null;
}

function parseCooldown(cdStr) {
  if (!cdStr) return 0;
  const m = String(cdStr).match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function parseTypes(typeStr) {
  if (!typeStr) return {};
  const t = String(typeStr).toLowerCase();
  return {
    isReact:    t.includes('react'),
    isInstant:  t.includes('instant') || t.includes('insta'),
    isBlock:    t.includes('block'),
    isAoe:      t.includes('aoe') || t.includes('cone'),
    isCone:     t.includes('cone'),
    isHeal:     t.includes('heal') || t.includes('sustain') || t.includes('regen'),
    isTransform:t.includes('transformation') || t.includes('transform'),
  };
}

/**
 * Flatten char.spells, char.abilities, char.relics into a normalised list.
 */
function resolveAbilities(char) {
  const list = [];
  const addGroup = (entries, source) => {
    if (!entries) return;
    for (const e of entries) {
      if (!e || !e.name) continue;
      const types = parseTypes(e.type);
      const cost = parseResourceCost(e.cost);
      list.push({
        name: e.name,
        source,
        dice: e.dice || null,
        cooldownTurns: parseCooldown(e.cooldown),
        cost,
        effect: e.effect || null,
        limit: e.limit || null,
        isOncePerFight: !!(e.limit && String(e.limit).toLowerCase().includes('fight')),
        desc: e.desc || '',
        ...types,
      });
    }
  };
  addGroup(char.spells,    'spell');
  addGroup(char.abilities, 'ability');
  addGroup(char.relics,    'relic');
  return list;
}

// ── §4  Factory ────────────────────────────────────────────────────────────

function buildCombatant(char, teamIndex, id) {
  const maxKi = char.ki ?? 0;
  return {
    id,
    teamIndex,
    name: char.name,
    sourceChar: char,
    maxHp: char.hp,
    currentHp: char.hp,
    spellSlots:    char.spellSlots ?? 0,
    maxSpellSlots: char.spellSlots ?? 0,
    ki: maxKi,
    maxKi,
    kiRegen: char.kiRegen ?? 0,
    souls: char.souls ?? 0,
    abilities: resolveAbilities(char),
    initiativeRoll: 0,
    isKO: false,
    cooldowns:     {},   // { abilityName: turnsLeft }
    usedThisFight: [],   // ability names used for 1/fight
    statusEffects: [],   // { name, turnsLeft, dice, damType, notes }
    hasCounterAttack: false,
  };
}

// ── §5  Lookups ────────────────────────────────────────────────────────────

function getCombatant(id) { return S.combatants.find(c => c.id === id); }
function livingCombatants(teamIndex) {
  return S.combatants.filter(c => c.teamIndex === teamIndex && !c.isKO);
}
function activeCombatant() {
  return getCombatant(S.initiativeOrder[S.currentTurnIndex]);
}
function enemies(c) {
  return livingCombatants(c.teamIndex === 0 ? 1 : 0);
}

function abilityAvailable(c, ab) {
  if ((c.cooldowns[ab.name] ?? 0) > 0) return false;
  if (ab.isOncePerFight && c.usedThisFight.includes(ab.name)) return false;
  if (ab.cost) {
    if (ab.cost.type === 'ki'    && c.ki < ab.cost.amount)    return false;
    if (ab.cost.type === 'slots' && c.spellSlots < ab.cost.amount) return false;
    if (ab.cost.type === 'souls' && c.souls < ab.cost.amount) return false;
  }
  return true;
}

function hasSilence(c) {
  return c.statusEffects.some(e => e.name.toLowerCase() === 'silence');
}

function hasControlEffect(c) {
  const controls = ['para', 'gel', 'stun', 'cocoon', 'fear', 'root'];
  return c.statusEffects.find(e => controls.includes(e.name.toLowerCase())) ?? null;
}

// ── §6  Log ────────────────────────────────────────────────────────────────

function addLog(text, flavor = 'info') {
  S.log.push({ text, flavor });
  const panel = document.getElementById('combat-log');
  if (!panel) return;
  const div = document.createElement('div');
  div.className = flavor === 'divider' ? 'log-round-divider' : `log-entry log-${flavor}`;
  div.textContent = text;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

function addRoundDivider() {
  addLog(`─── Round ${S.roundNumber} ───`, 'divider');
}

// ── §7  Combat Logic ───────────────────────────────────────────────────────

function applyDamage(combatant, amount) {
  const dmg = Math.max(0, amount);
  combatant.currentHp = Math.max(0, combatant.currentHp - dmg);
  if (combatant.currentHp <= 0 && !combatant.isKO) {
    combatant.isKO = true;
    addLog(`💀 ${combatant.name} is KO!`, 'death');
  }
  updateCombatantCardDOM(combatant);
}

/**
 * Apply one or more status effects from a raw string like "1d2 burn" or "burn, 1d2 para".
 * Parses a "XdY effectName" prefix to roll duration.
 */
function applyStatus(combatant, effectStr, defaultTurns = 2) {
  if (!effectStr) return;
  for (const part of String(effectStr).split(',')) {
    const p = part.trim();
    if (!p) continue;
    // "1d2 burn" → duration rolled, "burn" → defaultTurns
    const durMatch = p.match(/^(\d+d\d+)\s+(.+)$/i);
    const effName = durMatch ? durMatch[2].trim() : p;
    const turns = durMatch ? Math.max(1, parseDice(durMatch[1]).total) : defaultTurns;
    const eff = findEffect(effName);
    const existing = combatant.statusEffects.find(
      e => e.name.toLowerCase() === effName.toLowerCase()
    );
    if (existing) {
      existing.turnsLeft = Math.max(existing.turnsLeft, turns);
    } else {
      combatant.statusEffects.push({
        name:     eff ? eff.name : effName,
        turnsLeft: turns,
        dice:     eff?.dice ?? null,
        damType:  eff?.type ?? '—',
        notes:    eff?.notes ?? '',
      });
      addLog(`${combatant.name} is now affected by ${eff ? eff.name : effName} (${turns}t)!`, 'status');
    }
  }
}

/**
 * Tick DoT effects, ki regen, cooldowns at turn start.
 * Returns true if the combatant survived (false if DoT killed them).
 */
function tickTurn(c) {
  const dotNames = ['burn', 'toxic', 'toxic shock', 'bleed', 'hemoragie'];
  const expired = [];

  for (const eff of c.statusEffects) {
    const n = eff.name.toLowerCase();
    if (dotNames.includes(n) && eff.dice && eff.dice !== '—') {
      const r = parseDice(eff.dice);
      applyDamage(c, r.total);
      addLog(`${c.name} takes ${r.total} ${eff.damType} from ${eff.name}. (${r.breakdown})`, 'status');
      if (c.isKO) return false;
    }
    eff.turnsLeft--;
    if (eff.turnsLeft <= 0) expired.push(eff.name);
  }
  c.statusEffects = c.statusEffects.filter(e => !expired.includes(e.name));
  for (const n of expired) addLog(`${c.name}'s ${n} wears off.`, 'info');

  // Ki regen
  if (c.kiRegen > 0 && c.ki < c.maxKi) {
    c.ki = Math.min(c.maxKi, c.ki + c.kiRegen);
  }

  // Cooldowns
  for (const key of Object.keys(c.cooldowns)) {
    c.cooldowns[key] = Math.max(0, c.cooldowns[key] - 1);
  }
  return true;
}

/**
 * Resolve an attack roll (d20 vs d20).
 * Returns { hit, crit, fumble, damage, atkRoll, defRoll, breakdown }.
 */
function resolveAttack(attacker, defender, diceExpr) {
  const atkRoll = rollD20();
  const defRoll = rollD20();
  const hit    = atkRoll.isNat20 || (!atkRoll.isNat1 && atkRoll.value >= defRoll.value);
  const crit   = atkRoll.isNat20;
  const fumble = atkRoll.isNat1;

  let damage = 0, breakdown = '—';

  if (hit && !fumble) {
    // Extract dice from attack string, stripping weapon name prefix
    const raw = diceExpr || attacker.sourceChar.attack || '1d4';
    const diceOnly = raw.split(',')[0].replace(/^[a-zA-Z\s''-]+(?=\d)/i, '').trim();
    const rolled = parseDice(diceOnly || '1d4');
    damage    = crit ? rolled.total * 2 : rolled.total;
    breakdown = crit ? `CRIT ×2: ${rolled.breakdown} = ${damage}` : `${rolled.breakdown} = ${damage}`;
  }

  return { hit, crit, fumble, damage, atkRoll: atkRoll.value, defRoll: defRoll.value, breakdown };
}

function logAttackResult(atk, def, r) {
  if (r.crit) {
    addLog(`⚔ CRITICAL! ${atk.name} rolls 20 vs ${def.name}'s ${r.defRoll}. ${r.breakdown}`, 'crit');
  } else if (r.fumble) {
    addLog(`💥 FUMBLE! ${atk.name} rolls 1 — ${def.name} gets a free counter-attack!`, 'miss');
  } else if (r.hit) {
    addLog(`${atk.name} hits ${def.name}! (${r.atkRoll} ≥ ${r.defRoll}) ${r.breakdown}`, 'hit');
  } else {
    addLog(`${atk.name} misses ${def.name}. (${r.atkRoll} < ${r.defRoll})`, 'miss');
  }
}

function checkVictory() {
  if (livingCombatants(0).length === 0) return 0;
  if (livingCombatants(1).length === 0) return 1;
  return null;
}

/**
 * Returns available react/instant/block abilities of a combatant.
 */
function getReacts(target) {
  return target.abilities.filter(ab => {
    if (!ab.isReact && !ab.isInstant && !ab.isBlock) return false;
    if (ab.isTransform) return false;
    return abilityAvailable(target, ab);
  });
}

function spendResource(c, ab) {
  if (!ab.cost) return;
  if (ab.cost.type === 'ki')    c.ki    = Math.max(0, c.ki    - ab.cost.amount);
  if (ab.cost.type === 'slots') c.spellSlots = Math.max(0, c.spellSlots - ab.cost.amount);
  if (ab.cost.type === 'souls') c.souls = Math.max(0, c.souls - ab.cost.amount);
}

// ── §8  Action Handlers ────────────────────────────────────────────────────

function handlePass() {
  addLog(`${activeCombatant().name} passes.`, 'info');
  advanceTurn();
}

function handleAttack(attackerId, defenderId) {
  const atk = getCombatant(attackerId);
  const def = getCombatant(defenderId);
  if (!atk || !def || def.isKO) return;

  const result = resolveAttack(atk, def, null);
  S.pendingAction = { type: 'attack', attackerId, defenderId, result };

  const reacts = getReacts(def);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: def.id, ability: ab }));
    renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

function handleCastAbility(casterId, abilityName, targetIds) {
  const caster  = getCombatant(casterId);
  const ability = caster?.abilities.find(a => a.name === abilityName);
  if (!ability || !abilityAvailable(caster, ability)) return;

  // Spend resources immediately
  spendResource(caster, ability);
  if (ability.cooldownTurns > 0) caster.cooldowns[ability.name] = ability.cooldownTurns;
  if (ability.isOncePerFight) caster.usedThisFight.push(ability.name);

  addLog(`${caster.name} uses ${ability.name}!`, ability.source === 'spell' ? 'spell' : 'tech');

  const targets = targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);

  // AoE: apply to all targets without attack roll (hits automatically)
  if (ability.isAoe) {
    S.pendingAction = { type: 'aoe', casterId, abilityName, targetIds, ability };
    resumePendingAction(null);
    return;
  }

  // Single-target: roll attack
  const target = targets[0];
  if (!target) { advanceTurn(); return; }

  const result = ability.dice
    ? resolveAttack(caster, target, ability.dice)
    : { hit: true, crit: false, fumble: false, damage: 0, atkRoll: '—', defRoll: '—', breakdown: '—' };

  S.pendingAction = { type: 'ability', casterId, abilityName, targetIds: [target.id], result, ability };

  const reacts = getReacts(target);
  if (reacts.length > 0) {
    S.awaitingReact = true;
    S.reactOptions  = reacts.map(ab => ({ combatantId: target.id, ability: ab }));
    renderReactOverlay();
    return;
  }
  resumePendingAction(null);
}

function handleReactYes() {
  const selectedName = document.querySelector('.react-ability-option.is-selected')?.dataset.abilityName
    ?? S.reactOptions[0]?.ability.name;
  const option = S.reactOptions.find(o => o.ability.name === selectedName) ?? S.reactOptions[0];
  document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];
  resumePendingAction(option?.ability ?? null);
}

function handleReactNo() {
  document.getElementById('react-overlay')?.remove();
  S.awaitingReact = false;
  S.reactOptions  = [];
  resumePendingAction(null);
}

/**
 * Resolve the pending action, optionally applying a react ability first.
 * reactAbility = null → no react chosen.
 */
function resumePendingAction(reactAbility) {
  const action = S.pendingAction;
  S.pendingAction = null;

  if (!action) { advanceTurn(); return; }

  let blocked = false;

  // ── React resolution ──────────────────────────────────────────────────
  if (reactAbility) {
    const reactorId = action.defenderId ?? action.targetIds?.[0];
    const reactor   = getCombatant(reactorId);
    if (reactor) {
      spendResource(reactor, reactAbility);
      if (reactAbility.cooldownTurns > 0) reactor.cooldowns[reactAbility.name] = reactAbility.cooldownTurns;
      if (reactAbility.isOncePerFight) reactor.usedThisFight.push(reactAbility.name);

      if (reactAbility.isBlock) {
        addLog(`🛡 ${reactor.name} blocks with ${reactAbility.name}! Attack negated!`, 'spell');
        blocked = true;
      } else {
        // Dodge or counter-react
        addLog(`⚡ ${reactor.name} reacts: ${reactAbility.name}! ${reactAbility.desc}`, 'spell');
        if (reactAbility.dice) {
          const attackerId = action.attackerId ?? action.casterId;
          const attacker   = getCombatant(attackerId);
          if (attacker) {
            const r = parseDice(reactAbility.dice);
            addLog(`${reactor.name}'s react deals ${r.total} to ${attacker.name}! (${r.breakdown})`, 'hit');
            applyDamage(attacker, r.total);
          }
        }
        blocked = true; // dodged / counter negates original
      }
    }
  }

  // ── Apply original action ─────────────────────────────────────────────
  if (!blocked) {
    if (action.type === 'attack') {
      const atk = getCombatant(action.attackerId);
      const def = getCombatant(action.defenderId);
      if (atk && def) {
        logAttackResult(atk, def, action.result);
        if (action.result.hit && !action.result.fumble) {
          addLog(`${def.name}: ${def.currentHp + action.result.damage} → ${Math.max(0, def.currentHp)}`, 'hit');
          applyDamage(def, action.result.damage);
        }
        if (action.result.fumble) def.hasCounterAttack = true;
      }
    } else if (action.type === 'aoe') {
      const caster  = getCombatant(action.casterId);
      const ability = action.ability;
      const allTargets = action.targetIds.map(id => getCombatant(id)).filter(t => t && !t.isKO);
      addLog(`${caster.name}'s ${ability.name} strikes all enemies!`, 'spell');
      for (const target of allTargets) {
        if (ability.dice) {
          const rd = parseDice(ability.dice);
          addLog(`  ${target.name}: ${target.currentHp} → ${Math.max(0, target.currentHp - rd.total)} (${rd.total} dmg, ${rd.breakdown})`, 'hit');
          applyDamage(target, rd.total);
        }
        if (ability.effect) applyStatus(target, ability.effect);
      }
    } else if (action.type === 'ability') {
      const caster  = getCombatant(action.casterId);
      const target  = getCombatant(action.targetIds[0]);
      const ability = action.ability;
      if (caster && target) {
        logAttackResult(caster, target, action.result);
        if (action.result.hit && !action.result.fumble) {
          if (ability.dice && action.result.damage > 0) {
            addLog(`${target.name}: ${target.currentHp + action.result.damage} → ${Math.max(0, target.currentHp)} (${action.result.breakdown})`, 'hit');
            applyDamage(target, action.result.damage);
          }
          if (ability.effect) applyStatus(target, ability.effect);
        }
        if (action.result.fumble) target.hasCounterAttack = true;
      }
    }
  }

  // ── Victory check ─────────────────────────────────────────────────────
  const winner = checkVictory();
  if (winner !== null) {
    endCombat(winner);
    return;
  }

  // ── Counter-attack from fumble ─────────────────────────────────────────
  const prevActive = activeCombatant();
  const counter = S.combatants.find(c => c.hasCounterAttack && !c.isKO);
  if (counter) {
    counter.hasCounterAttack = false;
    addLog(`⚡ ${counter.name} gets a free counter-attack!`, 'crit');
    const counterTarget = prevActive;
    if (counterTarget && !counterTarget.isKO) {
      const cr = resolveAttack(counter, counterTarget, null);
      logAttackResult(counter, counterTarget, cr);
      if (cr.hit && !cr.fumble) {
        addLog(`${counterTarget.name}: ${counterTarget.currentHp + cr.damage} → ${Math.max(0, counterTarget.currentHp)} (${cr.breakdown})`, 'hit');
        applyDamage(counterTarget, cr.damage);
      }
    }
    const winner2 = checkVictory();
    if (winner2 !== null) {
      endCombat(winner2);
      return;
    }
  }

  advanceTurn();
}

// ── §9  Turn Flow ──────────────────────────────────────────────────────────

function endCombat(winner) {
  S.winnerTeam = winner;
  S.phase = 'victory';
  renderCombatScreen(); // Show final state
  setTimeout(() => renderVictoryScreen(), 1200);
}

function startInitiative() {
  S.combatants = [];
  let id = 0;
  for (const teamIdx of [0, 1]) {
    for (const name of S.teamNames[teamIdx]) {
      const char = personnageSheet.find(c => c.name === name);
      if (char) S.combatants.push(buildCombatant(char, teamIdx, id++));
    }
  }
  for (const c of S.combatants) c.initiativeRoll = rollDie(20);
  S.initiativeOrder = [...S.combatants]
    .sort((a, b) => b.initiativeRoll - a.initiativeRoll)
    .map(c => c.id);
  S.phase = 'initiative';
  render();
}

function startCombat() {
  S.phase = 'combat';
  S.currentTurnIndex = 0;
  S.roundNumber = 1;
  S.log = [];
  addRoundDivider();
  render();
  beginTurn(activeCombatant());
}

function advanceTurn() {
  const total = S.initiativeOrder.length;
  let curr = S.currentTurnIndex;
  let loops = 0;
  let passedZero = false;

  do {
    curr = (curr + 1) % total;
    if (curr === 0) passedZero = true;
    loops++;
    if (loops > total) return; // all KO'd
  } while (getCombatant(S.initiativeOrder[curr])?.isKO);

  S.currentTurnIndex = curr;
  if (passedZero) {
    S.roundNumber++;
    addRoundDivider();
  }

  beginTurn(activeCombatant());
}

function beginTurn(c) {
  if (!c) return;

  // Tick DoT, regen, cooldowns
  const survived = tickTurn(c);

  // Victory after DoT
  if (!survived) {
    const w = checkVictory();
    if (w !== null) { endCombat(w); return; }
  }

  addLog(`— ${c.name}'s turn —`, 'info');

  // Control effects: auto-pass
  const ctrl = hasControlEffect(c);
  if (ctrl && c.statusEffects.includes(ctrl)) {
    addLog(`${c.name} is ${ctrl.name} and cannot act!`, 'status');
    renderCombatScreen();
    setTimeout(() => {
      ctrl.turnsLeft--;
      if (ctrl.turnsLeft <= 0) {
        c.statusEffects = c.statusEffects.filter(e => e !== ctrl);
        addLog(`${c.name}'s ${ctrl.name} fades.`, 'info');
      }
      advanceTurn();
    }, 1000);
    return;
  }

  renderCombatScreen();
}

// ── §10  Render ────────────────────────────────────────────────────────────

function render() {
  if (S.phase === 'selection')  renderSelectionScreen();
  else if (S.phase === 'initiative') renderInitiativeScreen();
  else if (S.phase === 'combat')     renderCombatScreen();
  else if (S.phase === 'victory')    renderVictoryScreen();
}

// ── Emoji for status effect ──────────────────────────────────────────────
function statusEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('burn'))                             return '🔥';
  if (n.includes('toxic') || n.includes('poison'))   return '🧪';
  if (n.includes('bleed') || n.includes('hemo'))     return '🩸';
  if (['para','stun','cocoon','fear'].some(k => n.includes(k))) return '⚡';
  if (n.includes('gel') || n.includes('freeze'))     return '❄️';
  if (n.includes('silence'))                         return '🔇';
  if (n.includes('root'))                            return '🌿';
  if (n.includes('blind'))                           return '🙈';
  return '◈';
}

function statusCssClass(damType) {
  const t = (damType || '').toLowerCase();
  if (t === 'fire')    return 'status-fire';
  if (t === 'poison')  return 'status-poison';
  if (t === 'ice')     return 'status-ice';
  if (t === 'physical') return 'status-phys';
  if (t === 'holy')    return 'status-holy';
  if (t === 'psy')     return 'status-psy';
  return 'status-neutral';
}

// ── Partial DOM update for a single card ─────────────────────────────────
function updateCombatantCardDOM(c) {
  const card = document.querySelector(`.combat-char-card[data-id="${c.id}"]`);
  if (!card) return;
  // Update HP bar
  const pct  = Math.max(0, (c.currentHp / c.maxHp) * 100);
  const bar  = card.querySelector('.hp-bar');
  const text = card.querySelector('.hp-text');
  if (bar)  bar.style.width = `${pct.toFixed(1)}%`;
  if (bar)  bar.className = `hp-bar${pct < 25 ? ' low' : pct < 50 ? ' mid' : ''}`;
  if (text) text.textContent = `${c.currentHp} / ${c.maxHp} HP`;
  if (c.isKO) card.classList.add('is-ko');
}

function hpBarHTML(c) {
  const pct = Math.max(0, (c.currentHp / c.maxHp) * 100);
  const cls = pct < 25 ? ' low' : pct < 50 ? ' mid' : '';
  return `<div class="hp-bar-wrap"><div class="hp-bar${cls}" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="hp-text">${c.currentHp} / ${c.maxHp} HP</span>`;
}

function resourceHTML(c) {
  let out = '';
  if (c.maxSpellSlots > 0) {
    // Cap display to 12 pips max to avoid overflow
    const showMax = Math.min(c.maxSpellSlots, 12);
    const pips = Array.from({ length: showMax }, (_, i) =>
      `<span class="spell-pip ${i < c.spellSlots ? 'filled' : 'empty'}" title="Slot ${i + 1}"></span>`
    ).join('');
    const extra = c.maxSpellSlots > 12 ? `<span class="pip-overflow">+${c.maxSpellSlots - 12}</span>` : '';
    out += `<div class="spell-pips">${pips}${extra}</div>`;
  }
  if (c.maxKi > 0) {
    out += `<div class="ki-counter">Ki: ${c.ki}/${c.maxKi}</div>`;
  }
  if (c.souls > 0 || c.sourceChar.souls) {
    out += `<div class="ki-counter souls-counter">Souls: ${c.souls}</div>`;
  }
  return out;
}

function statusBadgesHTML(c) {
  if (!c.statusEffects.length) return '';
  const badges = c.statusEffects.map(e =>
    `<span class="status-badge ${statusCssClass(e.damType)}" title="${e.notes}">
       ${statusEmoji(e.name)} ${e.name} (${e.turnsLeft}t)
     </span>`
  ).join('');
  return `<div class="status-badge-row">${badges}</div>`;
}

function combatantCardHTML(c, isActive) {
  const koClass     = c.isKO     ? ' is-ko'      : '';
  const activeClass = isActive   ? ' active-turn' : '';
  const teamClass   = c.teamIndex === 0 ? ' team-a' : ' team-b';
  const passivesHTML = c.sourceChar.passives?.length
    ? `<div class="char-passives-mini">${c.sourceChar.passives.slice(0, 2).map(p =>
        `<span class="passive-mini" title="${p}">${p.length > 40 ? p.slice(0, 40) + '…' : p}</span>`
      ).join('')}</div>`
    : '';
  return `
    <div class="combat-char-card${koClass}${activeClass}${teamClass}" data-id="${c.id}">
      <div class="combat-char-name">${isActive ? '★ ' : ''}${c.name}${c.isKO ? ' [KO]' : ''}</div>
      ${hpBarHTML(c)}
      ${resourceHTML(c)}
      ${statusBadgesHTML(c)}
      ${passivesHTML}
    </div>`;
}

function initiativeStripHTML() {
  const chips = S.initiativeOrder.map((id, idx) => {
    const c         = getCombatant(id);
    const isActive  = idx === S.currentTurnIndex;
    const koClass   = c.isKO    ? ' is-ko'  : '';
    const actClass  = isActive  ? ' active' : '';
    const teamClass = c.teamIndex === 0 ? ' team-a' : ' team-b';
    return `<div class="init-chip${koClass}${actClass}${teamClass}" title="${c.name} — init ${c.initiativeRoll}">
              ${c.name}<br><small>${c.initiativeRoll}</small>
            </div>`;
  }).join('');
  return `<div class="initiative-strip">${chips}</div>`;
}

function abilityPreviewHTML(ability) {
  if (!ability) return '';
  const tags = [];
  if (ability.isAoe)     tags.push('AoE');
  if (ability.isCone)    tags.push('Cone');
  if (ability.isReact)   tags.push('React');
  if (ability.isInstant) tags.push('Instant');
  if (ability.isBlock)   tags.push('Block');
  if (ability.isHeal)    tags.push('Heal');
  const tagHTML  = tags.map(t => `<span class="ab-tag">${t}</span>`).join('');
  const diceHTML = ability.dice   ? `<span class="ab-dice">${ability.dice}</span>` : '';
  const fxHTML   = ability.effect ? `<span class="ab-effect">✦ ${ability.effect}</span>` : '';
  const descHTML = ability.desc   ? `<span class="ab-desc">${ability.desc}</span>` : '';
  const costHTML = ability.cost   ? `<span class="ab-cost">${ability.cost.amount} ${ability.cost.type}</span>` : '';
  return `<div class="ability-preview">${diceHTML}${fxHTML}${costHTML}${tagHTML}${descHTML}</div>`;
}

function actionPanelHTML(c) {
  const enemyTeam  = c.teamIndex === 0 ? 1 : 0;
  const enemyAlive = livingCombatants(enemyTeam);
  const silence    = hasSilence(c);

  const targetOpts = enemyAlive.map(t =>
    `<option value="${t.id}">${t.name} (${t.currentHp}/${t.maxHp} HP)</option>`
  ).join('');
  const noTargets = enemyAlive.length === 0;

  // Spells: spells array
  const spellList = c.abilities.filter(ab =>
    ab.source === 'spell' &&
    !ab.isTransform &&
    abilityAvailable(c, ab) &&
    !(silence && ab.cost?.type === 'slots')
  );

  // Techniques + relics
  const techList = c.abilities.filter(ab =>
    (ab.source === 'ability' || ab.source === 'relic') &&
    !ab.isTransform &&
    abilityAvailable(c, ab)
  );

  const abOpt = (ab) => {
    const cdLeft = c.cooldowns[ab.name] ?? 0;
    const cdTxt  = cdLeft > 0 ? ` [${cdLeft}T CD]` : ab.cooldownTurns > 0 ? ` [${ab.cooldownTurns}T CD]` : '';
    const costTxt = ab.cost ? ` (${ab.cost.amount} ${ab.cost.type})` : '';
    const aoeTxt  = ab.isAoe ? ' — AoE' : '';
    const healTxt = ab.isHeal ? ' — Heal' : '';
    return `<option value="${ab.name}">${ab.name}${costTxt}${cdTxt}${aoeTxt}${healTxt}</option>`;
  };

  const spellSection = spellList.length > 0 ? `
    <div class="action-section">
      <label class="action-label">Spell ${silence ? '⚠ Silenced' : `(${c.spellSlots} slots)`}</label>
      <select id="spell-select" class="target-select">${spellList.map(abOpt).join('')}</select>
      <div id="spell-preview" class="ability-preview-wrap"></div>
      <select id="spell-target" class="target-select"${noTargets ? ' disabled' : ''}>
        ${noTargets ? '<option>No targets</option>' : targetOpts}
      </select>
      <button class="action-btn confirm-action-btn" id="btn-spell" data-caster="${c.id}"${noTargets ? ' disabled' : ''}>
        ✨ Cast Spell
      </button>
    </div>` : '';

  const techSection = techList.length > 0 ? `
    <div class="action-section">
      <label class="action-label">Technique / Relic</label>
      <select id="tech-select" class="target-select">${techList.map(abOpt).join('')}</select>
      <div id="tech-preview" class="ability-preview-wrap"></div>
      <select id="tech-target" class="target-select"${noTargets ? ' disabled' : ''}>
        ${noTargets ? '<option>No targets</option>' : targetOpts}
      </select>
      <button class="action-btn confirm-action-btn" id="btn-tech" data-caster="${c.id}"${noTargets ? ' disabled' : ''}>
        🔥 Use Technique
      </button>
    </div>` : '';

  return `
    <div class="action-panel">
      <div class="action-panel-title">⚔ ${c.name}'s Turn</div>
      <div class="action-section">
        <button class="action-btn" id="btn-pass">⏭ Pass</button>
      </div>
      <div class="action-section">
        <label class="action-label">Basic Attack</label>
        <select id="atk-target" class="target-select"${noTargets ? ' disabled' : ''}>
          ${noTargets ? '<option>No targets</option>' : targetOpts}
        </select>
        <button class="action-btn confirm-action-btn" id="btn-attack" data-attacker="${c.id}"${noTargets ? ' disabled' : ''}>
          ⚔ Attack <span class="atk-dice">(${c.sourceChar.attack || '1d6'})</span>
        </button>
      </div>
      ${spellSection}
      ${techSection}
    </div>`;
}

function reactPromptHTML() {
  if (!S.awaitingReact || !S.reactOptions.length) return '';
  const reactor    = getCombatant(S.reactOptions[0].combatantId);
  const action     = S.pendingAction;
  const attacker   = getCombatant(action?.attackerId ?? action?.casterId);
  const abilityOpts = S.reactOptions.map((opt, i) => `
    <div class="react-ability-option ${i === 0 ? 'is-selected' : ''}" data-ability-name="${opt.ability.name}">
      <strong>${opt.ability.name}</strong>
      <span class="react-option-desc">${opt.ability.desc || (opt.ability.isBlock ? 'Block' : 'React')}</span>
    </div>`).join('');

  return `
    <div id="react-overlay" class="react-overlay">
      <div class="react-dialog">
        <div class="react-title">⚡ React Opportunity</div>
        <p class="react-desc-text">${attacker ? attacker.name : 'Enemy'} targets ${reactor.name}!</p>
        <p class="react-sub">${reactor.name} can react with:</p>
        <div class="react-ability-list">${abilityOpts}</div>
        <div class="react-buttons">
          <button class="react-yes-btn" id="btn-react-yes">✓ React</button>
          <button class="react-no-btn"  id="btn-react-no">✗ Take the hit</button>
        </div>
      </div>
    </div>`;
}

function logPanelHTML() {
  const entries = S.log.slice(-80).map(e => {
    if (e.flavor === 'divider')
      return `<div class="log-round-divider">${e.text}</div>`;
    return `<div class="log-entry log-${e.flavor}">${e.text}</div>`;
  }).join('');
  return `<div class="combat-log" id="combat-log">${entries}</div>`;
}

// ── Screen renders ────────────────────────────────────────────────────────

function renderSelectionScreen() {
  const allChars = personnageSheet;

  const charGrid = (teamIdx) => allChars.map(c => {
    const inThis  = S.teamNames[teamIdx].includes(c.name);
    const inOther = S.teamNames[1 - teamIdx].includes(c.name);
    const full    = S.teamNames[teamIdx].length >= 4;
    const locked  = !inThis && (inOther || full);
    const abilCount = (c.spells?.length ?? 0) + (c.abilities?.length ?? 0) + (c.relics?.length ?? 0);
    return `
      <div class="char-select-card${inThis ? ' is-selected' : ''}${locked ? ' is-disabled' : ''}">
        <div class="select-card-name">${c.name}</div>
        <div class="select-card-stats">${c.hp} HP · ${c.spellSlots ?? 0} slots · ${c.ki ?? 0} ki</div>
        <div class="select-card-count">${abilCount} abilities</div>
        ${inThis
          ? `<button class="select-btn remove-btn" data-name="${c.name}" data-team="${teamIdx}">✕ Remove</button>`
          : `<button class="select-btn add-btn" data-name="${c.name}" data-team="${teamIdx}" ${locked ? 'disabled' : ''}>+ Team ${teamIdx + 1}</button>`
        }
      </div>`;
  }).join('');

  const roster = (teamIdx) => {
    if (!S.teamNames[teamIdx].length)
      return '<span class="no-selection">None selected</span>';
    return S.teamNames[teamIdx].map(n =>
      `<span class="selected-chip">● ${n}
         <button class="chip-remove" data-name="${n}" data-team="${teamIdx}">×</button>
       </span>`
    ).join('');
  };

  const canStart = S.teamNames[0].length > 0 && S.teamNames[1].length > 0;

  root.innerHTML = `
    <div class="selection-layout">
      <div class="selection-header">
        <h3 class="selection-title">⚔ Choose Your Fighters</h3>
        <p class="selection-sub">Pick 1–4 characters per team, then roll for initiative.</p>
      </div>
      <div class="selection-teams">
        <div class="selection-team">
          <div class="team-header team-a-header">⚔ Team 1</div>
          <div class="selected-roster">${roster(0)}</div>
          <div class="char-select-grid">${charGrid(0)}</div>
        </div>
        <div class="selection-team">
          <div class="team-header team-b-header">⚔ Team 2</div>
          <div class="selected-roster">${roster(1)}</div>
          <div class="char-select-grid">${charGrid(1)}</div>
        </div>
      </div>
      <div class="selection-footer">
        <button class="combat-start-btn" id="btn-start" ${canStart ? '' : 'disabled'}>
          ⚔ Roll for Initiative
        </button>
      </div>
    </div>`;

  bindSelectionEvents();
}

function renderInitiativeScreen() {
  const rows = S.initiativeOrder.map(id => {
    const c       = getCombatant(id);
    const pct     = ((c.initiativeRoll / 20) * 100).toFixed(1);
    const tcls    = c.teamIndex === 0 ? 'team-a' : 'team-b';
    return `
      <div class="init-roll-row">
        <span class="init-name ${tcls}">${c.name}</span>
        <div class="init-bar-track">
          <div class="init-bar-fill ${tcls}" style="width:0%" data-target="${pct}"></div>
        </div>
        <span class="init-value">${c.initiativeRoll}</span>
      </div>`;
  }).join('');

  const order = S.initiativeOrder.map(id => getCombatant(id).name).join(' → ');

  root.innerHTML = `
    <div class="initiative-screen">
      <h3 class="init-screen-title">⚔ Initiative Rolls</h3>
      <div class="init-rows">${rows}</div>
      <p class="init-order-display">Turn order: <strong>${order}</strong></p>
      <button class="combat-start-btn" id="btn-begin">▶ Begin Combat</button>
    </div>`;

  // Animate bars after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      root.querySelectorAll('.init-bar-fill').forEach(el => {
        el.style.transition = 'width 0.8s ease';
        el.style.width = el.dataset.target + '%';
      });
    }, 60);
  });

  document.getElementById('btn-begin')?.addEventListener('click', startCombat);
}

function renderCombatScreen() {
  const active = activeCombatant();

  const teamColHTML = (teamIdx) =>
    S.combatants
      .filter(c => c.teamIndex === teamIdx)
      .map(c => combatantCardHTML(c, active?.id === c.id))
      .join('');

  root.innerHTML = `
    <div class="combat-layout">
      <div class="team-column" id="team-col-0">
        <div class="team-label team-a-header">⚔ Team 1</div>
        ${teamColHTML(0)}
      </div>
      <div class="combat-center">
        <div class="combat-header">
          <span class="round-badge">Round ${S.roundNumber}</span>
          ${initiativeStripHTML()}
        </div>
        ${active && S.phase === 'combat' ? actionPanelHTML(active) : '<div class="action-panel"><p style="color:var(--tga-gold-bright)">Combat ended.</p></div>'}
        ${logPanelHTML()}
      </div>
      <div class="team-column" id="team-col-1">
        <div class="team-label team-b-header">⚔ Team 2</div>
        ${teamColHTML(1)}
      </div>
    </div>
    ${S.awaitingReact ? reactPromptHTML() : ''}`;

  // Scroll log to bottom
  const log = root.querySelector('#combat-log');
  if (log) log.scrollTop = log.scrollHeight;

  bindCombatEvents();
}

function renderReactOverlay() {
  // Remove any existing overlay
  document.getElementById('react-overlay')?.remove();
  // Append overlay to body (above everything)
  const wrapper = document.createElement('div');
  wrapper.innerHTML = reactPromptHTML();
  document.body.appendChild(wrapper.firstElementChild);
  bindReactEvents();
}

function renderVictoryScreen() {
  const winner    = S.winnerTeam;
  const survivors = S.combatants.filter(c => c.teamIndex === winner && !c.isKO);

  const survivorCards = survivors.map(c => `
    <div class="survivor-chip">
      <div class="survivor-name">${c.name}</div>
      <div class="hp-text">${c.currentHp} / ${c.maxHp} HP</div>
    </div>`).join('');

  root.innerHTML = `
    <div class="victory-screen">
      <div class="victory-title">⚔ Victory!</div>
      <div class="victory-subtitle">Team ${winner + 1} wins the battle!</div>
      <div class="survivor-label">Survivors</div>
      <div class="survivor-list">${survivorCards || '<p>No survivors.</p>'}</div>
      <div class="rematch-actions">
        <button class="combat-start-btn" id="btn-rematch">⚔ Rematch</button>
        <button class="combat-start-btn secondary-btn" id="btn-new-teams">↩ New Teams</button>
      </div>
    </div>`;

  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    // Reset and re-use same teams
    S.combatants = [];
    S.initiativeOrder = [];
    S.log = [];
    S.winnerTeam = null;
    S.awaitingReact = false;
    S.pendingAction = null;
    S.reactOptions = [];
    startInitiative();
  });

  document.getElementById('btn-new-teams')?.addEventListener('click', () => {
    Object.assign(S, {
      phase: 'selection', teamNames: [[], []], combatants: [],
      initiativeOrder: [], log: [], winnerTeam: null,
      awaitingReact: false, pendingAction: null, reactOptions: [],
    });
    render();
  });
}

// ── §11  Event Binding ─────────────────────────────────────────────────────

function bindSelectionEvents() {
  root.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const name = e.currentTarget.dataset.name;
      const team = parseInt(e.currentTarget.dataset.team);
      if (!S.teamNames[team].includes(name) && S.teamNames[team].length < 4) {
        S.teamNames[team].push(name);
        renderSelectionScreen();
      }
    });
  });

  root.querySelectorAll('.remove-btn, .chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const name = e.currentTarget.dataset.name;
      const team = parseInt(e.currentTarget.dataset.team);
      S.teamNames[team] = S.teamNames[team].filter(n => n !== name);
      renderSelectionScreen();
    });
  });

  document.getElementById('btn-start')?.addEventListener('click', startInitiative);
}

function bindCombatEvents() {
  if (!activeCombatant() || S.phase !== 'combat') return;
  const active = activeCombatant();

  document.getElementById('btn-pass')?.addEventListener('click', handlePass);

  document.getElementById('btn-attack')?.addEventListener('click', () => {
    const targetId = parseInt(document.getElementById('atk-target')?.value);
    if (!isNaN(targetId)) handleAttack(active.id, targetId);
  });

  document.getElementById('btn-spell')?.addEventListener('click', () => {
    const abilityName = document.getElementById('spell-select')?.value;
    const ability = active.abilities.find(a => a.name === abilityName);
    if (!ability) return;
    const targetIds = ability.isAoe
      ? enemies(active).map(t => t.id)
      : [parseInt(document.getElementById('spell-target')?.value)].filter(n => !isNaN(n));
    handleCastAbility(active.id, abilityName, targetIds);
  });

  document.getElementById('btn-tech')?.addEventListener('click', () => {
    const abilityName = document.getElementById('tech-select')?.value;
    const ability = active.abilities.find(a => a.name === abilityName);
    if (!ability) return;
    const targetIds = ability.isAoe
      ? enemies(active).map(t => t.id)
      : [parseInt(document.getElementById('tech-target')?.value)].filter(n => !isNaN(n));
    handleCastAbility(active.id, abilityName, targetIds);
  });

  // ── Ability preview on select ──────────────────────────────────────────
  function updatePreview(selectId, previewId) {
    const sel = document.getElementById(selectId);
    const box = document.getElementById(previewId);
    if (!sel || !box) return;
    const ab = active.abilities.find(a => a.name === sel.value);
    box.innerHTML = abilityPreviewHTML(ab);
  }

  updatePreview('spell-select', 'spell-preview');
  updatePreview('tech-select',  'tech-preview');
  document.getElementById('spell-select')?.addEventListener('change', () => updatePreview('spell-select', 'spell-preview'));
  document.getElementById('tech-select')?.addEventListener('change',  () => updatePreview('tech-select',  'tech-preview'));
}

function bindReactEvents() {
  root.querySelectorAll?.('.react-ability-option')?.forEach?.(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.react-ability-option').forEach(o => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
    });
  });

  // Overlay is appended to body, not root
  document.querySelectorAll('.react-ability-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.react-ability-option').forEach(o => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
    });
  });
  document.getElementById('btn-react-yes')?.addEventListener('click', handleReactYes);
  document.getElementById('btn-react-no')?.addEventListener('click', handleReactNo);
}

// ── §12  Boot ──────────────────────────────────────────────────────────────
render();
