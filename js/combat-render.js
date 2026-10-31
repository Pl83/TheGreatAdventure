/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-render.js — HTML generation and screen rendering
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  _R, S, SPELL_RANGE, allChars,
  activeCombatant, livingCombatants, koAllies, getCombatant,
  enemies, targetPool, abilityAvailable, hasSilence, hasValidTarget, hasControlEffect,
  chebyshev, targetInRange, moveSpeed, isWet, freeActionOptions, doorsInReach, doorLabel,
  drawMap, setupCanvasClickHandler,
  clearAimState, startCombat, goToMapChoice, confirmMap, activeAllyDomain,
} from './combat-logic.js';

import { loadManifest, loadMapMeta } from './dungeon-loader.js';
import { fieldStripHTML } from './field-strip.js';
import { bindSelectionEvents, bindCombatEvents, bindReactEvents, bindFreeActionEvents } from './combat-events.js';
import { scheduleAI, controlledByAi, pendingAiDecision, aiStatusHTML } from './combat-ai-driver.js';

export const root = document.getElementById('combat-root');

// ── §12  Render helpers ────────────────────────────────────────────────────

export function statusEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('burn') || n.includes('calcin'))                                      return '🔥';
  if (n.includes('toxic') || n.includes('poison'))               return '🧪';
  if (n.includes('bleed') || n.includes('hemo'))                 return '🩸';
  if (['para','stun','cocoon','fear'].some(k => n.includes(k)))  return '⚡';
  if (n.includes('gel') || n.includes('freeze'))                 return '❄️';
  if (n.includes('silence'))                                      return '🔇';
  if (n.includes('root'))                                         return '🌿';
  if (n.includes('blind'))                                        return '🙈';
  if (n.includes('regen') || n.includes('regenerat'))            return '💚';
  if (n === 'fly')                                               return '🦅';
  if (n === 'sure_hit')                                          return '🎯';
  if (n.startsWith('lost:'))                                     return '🦴';
  if (n === 'chains_of_apophis')                                 return '⛓';
  if (n === 'living_blade_armor')                                return '⚔';
  if (n === 'final_reckoning')                                   return '💀';
  if (n === 'runik_precast')                                     return '✦';
  if (n === 'damage_reduction')                                  return '🪨';
  if (n === 'ranged_guard')                                      return '🌬';
  if (n === 'destiny_crit')                                      return '🌟';
  if (n === 'gamble_bonus')                                      return '✨';
  if (n === 'hindered' || n === 'hindered_atk' || n === 'hindered_def') return '⬇';
  if (n.includes('damage_shield'))                               return '🛡';
  if (n.includes('water_shield') || n.includes('shield'))       return '🛡';
  return '◈';
}

export function statusCssClass(damType) {
  const t = (damType || '').toLowerCase();
  if (t === 'fire')     return 'status-fire';
  if (t === 'poison')   return 'status-poison';
  if (t === 'ice')      return 'status-ice';
  if (t === 'physical') return 'status-phys';
  if (t === 'holy')     return 'status-holy';
  if (t === 'psy')      return 'status-psy';
  return 'status-neutral';
}

export function hpBarHTML(c) {
  const pct = Math.max(0, (c.currentHp / c.maxHp) * 100);
  const cls = pct < 25 ? ' low' : pct < 50 ? ' mid' : '';
  // The number carries the meaning; the bar is a visual echo of it
  return `<div class="hp-bar-wrap" aria-hidden="true"><div class="hp-bar${cls}" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="hp-text">${c.currentHp} / ${c.maxHp} HP</span>`;
}

export function resourceHTML(c) {
  const chips = [];
  if (c.maxSpellSlots > 0) {
    const showMax = Math.min(c.maxSpellSlots, 12);
    const pips = Array.from({ length: showMax }, (_, i) =>
      `<span class="spell-pip ${i < c.spellSlots ? 'filled' : 'empty'}"></span>`
    ).join('');
    chips.push(`<span class="res-slots"><span class="spell-pips" aria-hidden="true">${pips}</span>`
      + `<span class="res-count">${c.spellSlots} / ${c.maxSpellSlots} slots</span></span>`);
  }
  if (c.maxKi > 0) chips.push(`<span class="res-chip res-ki">Ki ${c.ki} / ${c.maxKi}</span>`);
  if (c.souls > 0 || c.sourceChar.souls) chips.push(`<span class="res-chip res-souls">Souls ${c.souls}</span>`);
  return chips.length ? `<div class="res-row">${chips.join('')}</div>` : '';
}

const STATUS_NAMES = {
  damage_shield: 'Shield', living_blade_armor: 'Blade armor', chains_of_apophis: 'Chains of Apophis',
  runik_precast: 'Runic precast', final_reckoning: 'Final reckoning', smoke_screen: 'Smoke screen',
  para: 'Paralysed', gel: 'Frozen', adv: 'Advantage', sure_hit: 'Sure hit', orders: 'Orders', ward: 'Moon ward', relic_awake: 'Ifrit awake', passives_off: 'Passives off',
  damage_reduction: 'Damage reduction', ranged_guard: 'Ranged guard', destiny_crit: 'Destiny strikes', gamble_bonus: 'Fortune +2d8',
  hindered: 'Disadvantage', hindered_atk: 'Attacks at disadvantage', hindered_def: 'Next defense at disadvantage',
};
// "lost:Bone Armor" is a passive switched off for a while
export const statusName = n => STATUS_NAMES[n] ?? (n.startsWith('lost:') ? `${n.slice(5)} lost` : n.replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase()));

export function statusBadgesHTML(c) {
  const wet = isWet(c) && !c.statusEffects.some(e => e.name === 'wet') ? '<li class="status-badge status-water" title="Standing in water: slower, lightning hits harder, ice freezes">Wet</li>' : '';
  if (!c.statusEffects.length && !wet) return '';
  const badges = wet + c.statusEffects.map(e => {
    const dur = e.name === 'damage_shield' ? `${e.shieldHp} HP`
      : e.turnsLeft === 999 ? 'lasting'
      : `${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'}`;
    const notes = e.notes ? ` title="${e.notes}"` : '';
    const cls = e.name === 'wet' ? 'status-water' : statusCssClass(e.damType);
    return `<li class="status-badge ${cls}"${notes}>${e.label ?? statusName(e.name)} <span class="status-dur">${dur}</span></li>`;
  }).join('');
  return `<ul class="status-badge-row" aria-label="Effects">${badges}</ul>`;
}

export function combatantCardHTML(c, isActive) {
  const koClass      = c.isKO        ? ' is-ko'      : '';
  const activeClass  = isActive      ? ' active-turn' : '';
  const teamClass    = c.teamIndex === 0 ? ' team-a' : ' team-b';
  const flag = c.isKO ? '<span class="card-flag card-flag--ko">Fallen</span>'
    : isActive ? '<span class="card-flag card-flag--turn">Acting</span>' : '';
  const tfBadge      = c.isTransformed
    ? `<span class="transform-active-badge">${c.sourceChar.transformation?.base.nom ?? 'Transformed'}</span>`
    : '';
  const domainBadge  = c.domainActive
    ? `<span class="domain-active-badge">${c.sourceChar.domain?.name ?? 'Domain'}</span>`
    : '';
  const passivesHTML = c.sourceChar.passif?.length
    ? `<ul class="char-passives-mini" aria-label="Passives">${c.sourceChar.passif.slice(0, 2).map(p =>
        `<li class="passive-mini" title="${p.nom}">${p.nom}</li>`
      ).join('')}</ul>`
    : '';
  return `
    <article class="combat-char-card${koClass}${activeClass}${teamClass}" data-id="${c.id}" aria-labelledby="card-name-${c.id}">
      <div class="combat-char-head">
        <h4 class="combat-char-name" id="card-name-${c.id}">${c.name}</h4>
        ${flag}
      </div>
      ${hpBarHTML(c)}
      ${resourceHTML(c)}
      ${statusBadgesHTML(c)}
      ${tfBadge || domainBadge ? `<div class="card-badges">${tfBadge}${domainBadge}</div>` : ''}
      ${passivesHTML}
    </article>`;
}

// Turn order as an ordered list: current turn marked "Now", the next living fighter "Next"
export function initiativeStripHTML() {
  const order  = S.initiativeOrder.map(getCombatant);
  const n      = order.length;
  const nextIx = [...Array(n).keys()].map(k => (S.currentTurnIndex + 1 + k) % n)
    .find(i => i !== S.currentTurnIndex && !order[i].isKO);
  const chips = order.map((c, idx) => {
    const isActive = idx === S.currentTurnIndex;
    const flag = isActive ? '<span class="init-flag">Now</span>'
      : idx === nextIx ? '<span class="init-flag init-flag--next">Next</span>'
      : c.isKO ? '<span class="init-flag init-flag--ko">Fallen</span>' : '';
    return `
      <li class="init-chip${c.isKO ? ' is-ko' : ''}${isActive ? ' active' : ''} ${c.teamIndex === 0 ? 'team-a' : 'team-b'}"${isActive ? ' aria-current="step"' : ''}>
        <span class="init-name" title="${c.name}">${c.name}</span>
        <span class="init-meta"><span class="init-team">Team ${c.teamIndex === 0 ? 'I' : 'II'}</span> · Init ${c.initiativeRoll}</span>
        ${flag}
      </li>`;
  }).join('');
  return `<ol class="initiative-strip" aria-label="Turn order">${chips}</ol>`;
}

const COST_UNIT = { slots: ['slot', 'slots'], ki: ['ki', 'ki'], souls: ['soul', 'souls'] };
const costText  = cost => cost ? `${cost.amount} ${COST_UNIT[cost.type]?.[cost.amount === 1 ? 0 : 1] ?? cost.type}` : 'Free';

// Shape / targeting words shared by the ability list and the preview
function abilityTraits(ability) {
  const t = [];
  if (ability.isAoe)     t.push(`Area${ability.radius > 0 ? ` (radius ${ability.radius})` : ''}`);
  if (ability.isCone)    t.push('Cone');
  if (ability.isSplash)  t.push(`Splash${ability.radius > 0 ? ` (radius ${ability.radius})` : ''}`);
  if (ability.maxBounce) t.push(`Bounces ×${ability.maxBounce}`);
  if (ability.targetKind === 'ally') t.push(ability.isRevive ? 'Revives an ally' : 'Ally');
  if (ability.targetKind === 'self') t.push('Self');
  if (ability.isInstant) t.push('Free action');
  if (ability.isReact || ability.isBlock) t.push('Also a react');
  return t;
}

export function abilityPreviewHTML(ability) {
  if (!ability) return '';
  const tags = abilityTraits(ability);
  if (ability.range && ability.range !== SPELL_RANGE) tags.push(`Range ${ability.range}`);
  const tagHTML  = tags.map(t => `<span class="ab-tag">${t}</span>`).join('');
  const diceHTML = ability.dice   ? `<span class="ab-dice">${ability.dice}</span>` : '';
  const fxHTML   = ability.effect ? `<span class="ab-effect">Applies ${statusName(ability.effect)}</span>` : '';
  const descHTML = ability.desc   ? `<p class="ab-desc">${ability.desc}</p>` : '';
  return `<div class="ability-preview">${diceHTML}${fxHTML}${tagHTML}${descHTML}</div>`;
}

export function abilityFireLabel(ab) {
  if (!ab) return 'Aim';
  if (ab.tags?.includes('teleportation')) return `Teleport — ${ab.name}`;
  if (ab.targetKind === 'self') return `Use ${ab.name}`;
  return `Aim ${ab.name}`;
}

// The ability picked in the list survives re-renders for as long as it is that combatant's turn
let pickedAbility = null;
export function pickAbility(c, name) { pickedAbility = { id: c.id, name }; }

// Why an ability can't be chosen right now, or '' when it can
function abilityBlockedReason(c, ab, silence) {
  const cdLeft = c.cooldowns[ab.name] ?? 0;
  if (silence && ab.cost?.type === 'slots') return 'Silenced';
  if (abilityAvailable(c, ab)) return '';
  if (cdLeft > 0) return `Cooldown: ${cdLeft} turn${cdLeft === 1 ? '' : 's'}`;
  if (ab.isOncePerFight && c.usedThisFight.includes(ab.name)) return 'Already used this fight';
  if (ab.maxCharges > 0) return 'No uses left';
  if (ab.cost) return `Needs ${costText(ab.cost)}`;
  return 'Unavailable';
}

const SOURCE_LABEL = { spell: 'Spell', technoSpell: 'Techno-spell', technique: 'Technique', Art: 'Art', relic: 'Relic' };

export function actionPanelHTML(c) {
  const enemyAlive = targetPool(c);
  const allyAlive  = livingCombatants(c.teamIndex);
  const silence    = hasSilence(c);
  const hasMap     = !!S.currentMap;
  const acted      = S.hasActed;

  const targetOptsForAbility = (ability) => {
    if (ability?.targetKind === 'self') return `<option value="${c.id}">Self</option>`;
    if (ability?.targetKind === 'ally') {
      const allyPool = ability.isRevive ? koAllies(c.teamIndex) : allyAlive;
      return allyPool.map(t =>
        `<option value="${t.id}">${t.name} · ${t.currentHp}/${t.maxHp} HP${t.isKO ? ' · fallen' : ''}</option>`
      ).join('');
    }
    if (enemyAlive.length === 0) return '<option>No targets</option>';
    return enemyAlive.map(t => {
      const range   = hasMap ? targetInRange(c, t, ability) : { inRange: true, reason: '' };
      const distTxt = hasMap ? ` · ${chebyshev(c, t)} sq` : '';
      const whyTxt  = hasMap && !range.inRange ? ` · ${range.reason.toLowerCase()}` : '';
      const disabled = (hasMap && !range.inRange && !ability?.isAoe) ? ' disabled' : '';
      return `<option value="${t.id}"${disabled}>${t.name} · ${t.currentHp} HP${distTxt}${whyTxt}</option>`;
    }).join('');
  };

  const atkTargetOpts = targetOptsForAbility(null);
  const noEnemies     = enemyAlive.length === 0;

  const isRooted = c.statusEffects.some(e => e.name.toLowerCase() === 'root');
  const moveState = S.hasMoved ? 'Moved' : isRooted ? 'Rooted' : 'Move ready';
  const budget = `
    <ul class="turn-budget" aria-label="This turn">
      <li class="budget-chip${acted ? ' is-spent' : ''}">${acted ? 'Action used' : 'Action ready'}</li>
      <li class="budget-chip${S.hasMoved || isRooted ? ' is-spent' : ''}">${moveState}</li>
    </ul>`;
  const moveSection = S.hasMoved || isRooted ? '' : `
    <div class="action-section move-section">
      ${S.moveMode
        ? `<button class="action-btn map-cancel-move-btn" id="btn-cancel-move">Cancel move</button>
           <span class="move-hint">Click a highlighted cell on the map</span>`
        : `<button class="action-btn map-move-btn" id="btn-move">Move <span class="btn-aside">up to ${moveSpeed(c)} cells</span></button>`}
    </div>`;

  // Every move the panel can fire, unavailable ones included (greyed, with the reason)
  const abilityList = c.abilities.filter(ab => !ab.isTransform && !ab.reactOnly);
  const usable = ab => !abilityBlockedReason(c, ab, silence);
  const picked = pickedAbility?.id === c.id && abilityList.find(ab => ab.name === pickedAbility.name && usable(ab));
  const firstAbility = picked || abilityList.find(usable);

  const abOption = (ab) => {
    const why    = abilityBlockedReason(c, ab, silence);
    const cdBase = ab.cooldownTurns > 0 && !why ? `${ab.cooldownTurns}-turn cooldown` : '';
    const uses   = ab.maxCharges > 0 ? `${c.remainingCharges[ab.name] ?? ab.maxCharges}/${ab.maxCharges} uses` : '';
    const meta = [SOURCE_LABEL[ab.source], costText(ab.cost), ...abilityTraits(ab), cdBase, uses].filter(Boolean);
    return `
      <label class="ability-option${why ? ' is-disabled' : ''}">
        <input type="radio" name="ability" value="${ab.name}"${ab === firstAbility ? ' checked' : ''}${why ? ' disabled' : ''}>
        <span class="ability-option-body">
          <span class="ability-option-name">${ab.name}</span>
          <span class="ability-option-meta">${meta.map(m => `<span>${m}</span>`).join('')}</span>
          ${why ? `<span class="ability-option-why">${why}</span>` : ''}
        </span>
      </label>`;
  };

  const atkNoTarget  = !hasValidTarget(c, null);
  const abNoTarget   = !firstAbility || !hasValidTarget(c, firstAbility);

  const nomapTargetOpts = () => {
    if (!firstAbility || firstAbility.isAoe || firstAbility.isCone || firstAbility.targetKind === 'self') return '';
    const pool = firstAbility.targetKind === 'ally'
      ? (firstAbility.isRevive ? koAllies(c.teamIndex) : allyAlive)
      : enemyAlive;
    if (!pool.length) return '<option>No targets</option>';
    return pool.map(t => `<option value="${t.id}">${t.name} · ${t.currentHp} HP</option>`).join('');
  };

  const resources = [c.maxSpellSlots > 0 && `${c.spellSlots} slots`, c.maxKi > 0 && `${c.ki} ki`, (c.souls > 0 || c.sourceChar.souls) && `${c.souls} souls`]
    .filter(Boolean).join(' · ');
  const abilitySection = abilityList.length > 0 ? `
    <fieldset class="action-section ability-section">
      <legend class="action-label">Abilities <span class="label-aside">${silence ? '<span class="range-warn">Silenced</span>' : resources}</span></legend>
      <div class="ability-list" id="ability-list">${abilityList.map(abOption).join('')}</div>
      <div id="ability-preview" class="ability-preview-wrap"></div>
      ${!hasMap && nomapTargetOpts() ? `<label class="sr-only" for="ability-target-nomap">Ability target</label><select id="ability-target-nomap" class="target-select nomap-target">${nomapTargetOpts()}</select>` : ''}
      <div class="aim-row">
        <button class="action-btn aim-btn" id="btn-ability-fire" ${abNoTarget || (acted && !firstAbility?.isInstant) ? 'disabled' : ''}>
          ${abilityFireLabel(firstAbility)}
        </button>
        <span id="aim-hint-ability" class="aim-hint" style="display:none">Click a target on the map — Esc or right-click cancels</span>
      </div>
    </fieldset>` : '';

  const tf = c.sourceChar.transformation;
  const tfAbility = c.abilities.find(a => a.isTransform);
  const transformSection = tf && tfAbility && !c.isTransformed ? `
    <div class="action-section">
      <span class="action-label">Transformation</span>
      <button class="action-btn transform-btn" id="btn-transform" data-caster="${c.id}"
              ${(acted || c.usedThisFight.includes(tf.base.nom) || !abilityAvailable(c, tfAbility)) ? 'disabled' : ''}>
        ${tf.base.nom} <span class="btn-aside">${costText(tfAbility.cost)}</span>
      </button>
    </div>` : '';

  const domain = c.sourceChar.domain;
  const chargesLeft = c.domainCharges ?? 0;
  const allyDomain  = domain && !c.domainActive ? activeAllyDomain(c) : null;
  const maxCharges  = Math.max(1, Math.floor((domain?.rafinement ?? 0) / 3));
  const domainSection = domain ? (c.domainActive
    ? `<div class="action-section"><span class="domain-active-badge">${domain.name} — active · ${chargesLeft} charge${chargesLeft !== 1 ? 's' : ''} left</span></div>`
    : chargesLeft > 0
      ? `<div class="action-section">
          <span class="action-label">Domain expansion</span>
          <span class="domain-cost-label">${domain.name} · ${domain.type} · refinement ${domain.rafinement ?? '—'}</span>
          <button class="action-btn domain-btn" id="btn-domain" data-caster="${c.id}"
                  ${(c.spellSlots < domain.spellCost || acted || allyDomain) ? 'disabled' : ''}>
            Activate domain <span class="btn-aside">${domain.spellCost} slots · ${chargesLeft}/${maxCharges} charges</span>
          </button>
          ${allyDomain ? `<span class="range-warn">Blocked — ${getCombatant(allyDomain.casterId).name}'s domain is active (one per team)</span>` : ''}
        </div>`
      : `<div class="action-section"><span class="domain-active-badge is-spent">${domain.name} — no charges left</span></div>`) : '';

  const fieldStrip = fieldStripHTML();
  const activeDomainStrip = S.activeDomains.length > 0
    ? `<ul class="active-domain-strip" aria-label="Active domains">${S.activeDomains.map(d => {
        const owner = getCombatant(d.casterId);
        if (!owner) return '';
        const teamClass = owner.teamIndex === 0 ? 'team0' : 'team1';
        return `<li class="domain-strip-entry ${teamClass}">${owner.name}: ${d.domain.name} · ${d.domain.type}</li>`;
      }).join('')}</ul>`
    : '';

  const ctrl = hasControlEffect(c);
  if (ctrl) {
    return `
    ${activeDomainStrip}
    ${fieldStrip}
    <section class="action-panel" aria-labelledby="action-title">
      <h3 class="action-panel-title" id="action-title">${c.name}'s turn</h3>
      <p class="action-blocked">${statusName(ctrl.name)} — cannot act this turn.</p>
    </section>`;
  }

  // Closed doors within arm's reach can be opened with the action, or worn down by the basic attack
  const atkDice = c.transformedBaseAtk?.dices ?? c.sourceChar.baseAtk?.dices ?? '1d4';
  const doorSection = hasMap ? doorsInReach(c).map(d => `
      <div class="action-section door-section">
        <span class="action-label">🚪 ${doorLabel(d)} · ${d.hp}/${d.maxHp} HP</span>
        <button class="action-btn confirm-action-btn" data-door-open="${d.x},${d.y}" ${acted ? 'disabled' : ''}>Open</button>
        <button class="action-btn confirm-action-btn" data-door-hit="${d.x},${d.y}" ${acted ? 'disabled' : ''}>Break <span class="btn-aside atk-dice">${atkDice}</span></button>
      </div>`).join('') : '';

  const atkNote = hasMap && atkNoTarget && !noEnemies
    ? '<span class="range-warn">No enemy in reach — move closer</span>' : '';

  return `
    ${activeDomainStrip}
    ${fieldStrip}
    <section class="action-panel" aria-labelledby="action-title">
      <h3 class="action-panel-title" id="action-title">${c.name}'s turn</h3>
      ${budget}
      <div class="action-section finish-turn-section">
        <button class="action-btn finish-turn-btn" id="btn-pass">Finish turn</button>
      </div>
      ${moveSection}
      <div class="action-section">
        <label class="action-label" for="atk-target">Basic attack</label>
        <select id="atk-target" class="target-select" ${noEnemies ? 'disabled' : ''}>
          ${noEnemies ? '<option>No targets</option>'
            : atkNoTarget ? `<option value="" selected disabled>No enemy in reach</option>${atkTargetOpts}` : atkTargetOpts}
        </select>
        ${atkNote}
        <button class="action-btn confirm-action-btn" id="btn-attack" data-attacker="${c.id}"
                ${atkNoTarget || noEnemies || acted ? 'disabled' : ''}>
          Attack <span class="btn-aside atk-dice">${c.transformedBaseAtk?.dices ?? c.sourceChar.baseAtk?.dices ?? '1d6'}</span>
        </button>
      </div>
      ${doorSection}
      ${abilitySection}
      ${transformSection}
      ${domainSection}
    </section>`;
}

export function reactPromptHTML() {
  if (!S.awaitingReact || !S.reactOptions.length || pendingAiDecision() === 'react') return '';
  const reactor  = getCombatant(S.reactOptions[0].combatantId);
  const action   = S.pendingAction;
  const attacker = getCombatant(action?.attackerId ?? action?.casterId);
  const incoming = action?.ability;
  const atkDice  = incoming ? incoming.dice : (attacker?.transformedBaseAtk?.dices ?? attacker?.sourceChar.baseAtk?.dices);
  const moveName = incoming ? incoming.name : 'a basic attack';
  const moveInfo = [atkDice, incoming && abilityTraits(incoming)[0], incoming?.effect && `applies ${statusName(incoming.effect)}`]
    .filter(Boolean).join(' · ');
  const areaNote = action?.type === 'aoe' || action?.type === 'cone'
    ? `<p class="react-note">Area move: it also hits ${action.targetIds.length - 1} other fighter${action.targetIds.length === 2 ? '' : 's'}.</p>` : '';
  const options = S.reactOptions.map((opt, i) => {
    const ab   = opt.ability;
    const meta = [costText(ab.cost), ...abilityTraits(ab).filter(t => t !== 'Also a react')].join(' · ');
    return `
      <label class="react-ability-option">
        <input type="radio" name="react" value="${ab.name}"${i === 0 ? ' checked' : ''}>
        <span class="react-option-body">
          <span class="react-option-name">${ab.name}</span>
          <span class="react-option-meta">${meta}</span>
          ${ab.desc ? `<span class="react-option-desc">${ab.desc}</span>` : ''}
        </span>
      </label>`;
  }).join('');
  return `
    <div id="react-overlay" class="react-overlay">
      <div class="react-dialog ${reactor.teamIndex === 0 ? 'team-a' : 'team-b'}" role="alertdialog" aria-modal="true"
           aria-labelledby="react-title" aria-describedby="react-desc">
        <span class="react-eyebrow">Reaction · Team ${reactor.teamIndex === 0 ? 'I' : 'II'}</span>
        <h2 class="react-title" id="react-title">${reactor.name} can react</h2>
        <div id="react-desc">
          <p class="react-desc-text"><strong>${attacker ? attacker.name : 'An enemy'}</strong> uses <strong>${moveName}</strong> on ${reactor.name}.</p>
          ${moveInfo ? `<p class="react-move-info">${moveInfo}</p>` : ''}
          ${areaNote}
        </div>
        <fieldset class="react-ability-list">
          <legend class="react-sub">Choose a reaction</legend>
          ${options}
        </fieldset>
        <div class="react-buttons">
          <button class="react-yes-btn" id="btn-react-yes">React with ${S.reactOptions[0].ability.name}</button>
          <button class="react-no-btn"  id="btn-react-no">Take the hit</button>
        </div>
      </div>
    </div>`;
}

// A fumbling foe or a natural 20 defense leaves this unit a free action against the attacker
export function freeActionPromptHTML() {
  const pending = S.awaitingFree;
  if (!pending) return '';
  const actor = getCombatant(pending.actorId), foe = getCombatant(pending.targetId);
  if (!actor || !foe) return '';
  const options = freeActionOptions(actor, foe).map(o => {
    if (o.type === 'attack') {
      return `<button class="react-yes-btn" data-free="attack"${o.ok ? '' : ' disabled'}>${o.ok ? 'Dash in and strike' : 'Out of reach'}</button>`;
    }
    if (o.type === 'spell') {
      const meta = [costText(o.ability.cost), ...abilityTraits(o.ability)].filter(Boolean).join(' · ');
      return `<button class="react-no-btn free-spell-btn" data-free="spell" data-ability="${o.ability.name}">${o.ability.name}<span class="react-option-meta">${meta}</span></button>`;
    }
    return `<button class="react-no-btn" data-free="none">Do nothing</button>`;
  }).join('');
  return `
    <div id="free-overlay" class="react-overlay">
      <div class="react-dialog ${actor.teamIndex === 0 ? 'team-a' : 'team-b'}" role="alertdialog" aria-modal="true"
           aria-labelledby="free-title">
        <span class="react-eyebrow">Free action · Team ${actor.teamIndex === 0 ? 'I' : 'II'}</span>
        <h2 class="react-title" id="free-title">${actor.name} has an opening</h2>
        <p class="react-desc-text"><strong>${foe.name}</strong> left themself open. Strike back, cast a spell at them, or let it pass.</p>
        <div class="react-buttons free-options">${options}</div>
      </div>
    </div>`;
}

// ── Battle log ─────────────────────────────────────────────────────────────
// Rounds are headings, each turn is a section headed by the acting combatant, and every
// line inside it belongs to that turn. Indented lines ("  …") are details of the line above.

const LOG_KEEP  = 200;
const LOG_SIZES = ['s', 'm', 'l', 'xl'];
let logSize = (() => { try { return LOG_SIZES.indexOf(localStorage.getItem('combatLogSize')); } catch { return -1; } })();
if (logSize < 0) logSize = 1;

const escapeHTML = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
// Icons are decoration (the words already say what happened), so screen readers skip them
const LOG_ICON = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
const logText  = t => escapeHTML(t.trim()).replace(LOG_ICON, '<span class="log-icon" aria-hidden="true">$&</span>');

const turnOpenHTML = e => `
  <section class="log-turn log-turn--${e.team ?? 0}">
    <h5 class="log-turn-head"><span class="log-turn-name">${escapeHTML(e.text)}</span><span class="log-turn-team">Team ${e.team === 1 ? 'II' : 'I'}</span></h5>`;

function logEntryHTML(e) {
  if (e.flavor === 'turn')    return `${turnOpenHTML(e)}</section>`;
  if (e.flavor === 'divider') return `<h4 class="log-round">${escapeHTML(e.text)}</h4>`;
  const sub = /^\s/.test(e.text) ? ' log-sub' : '';
  return `<p class="log-entry log-${e.flavor}${sub}">${logText(e.text)}</p>`;
}

export function logPanelHTML() {
  let body = '', inTurn = false;
  for (const e of S.log.slice(-LOG_KEEP)) {
    const opens = e.flavor === 'turn' || e.flavor === 'divider';
    if (opens && inTurn) { body += '</section>'; inTurn = false; }
    if (e.flavor === 'turn') { body += turnOpenHTML(e); inTurn = true; }
    else body += logEntryHTML(e);
  }
  if (inTurn) body += '</section>';
  return `
    <section class="log-panel" aria-labelledby="log-title">
      <div class="log-panel-head">
        <h3 class="log-title" id="log-title">Battle Chronicle</h3>
        <div class="log-size" role="group" aria-label="Log text size">
          <button class="log-size-btn" data-log-size="-1" aria-label="Smaller text" ${logSize === 0 ? 'disabled' : ''}>A−</button>
          <button class="log-size-btn" data-log-size="1"  aria-label="Larger text"  ${logSize === LOG_SIZES.length - 1 ? 'disabled' : ''}>A+</button>
        </div>
      </div>
      <div class="combat-log" id="combat-log" data-size="${LOG_SIZES[logSize]}"
           role="log" aria-live="polite" aria-relevant="additions" aria-labelledby="log-title" tabindex="0">${body}</div>
    </section>`;
}

// New lines land in the open turn; the view follows them only if the reader was already at the bottom
function appendLog(e) {
  const log = document.getElementById('combat-log');
  if (!log) return;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const tpl = document.createElement('template');
  tpl.innerHTML = logEntryHTML(e).trim();
  const last = log.lastElementChild;
  const into = e.flavor !== 'turn' && e.flavor !== 'divider' && last?.classList.contains('log-turn') ? last : log;
  into.appendChild(tpl.content.firstElementChild);
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function bindLogControls() {
  root.querySelectorAll('[data-log-size]').forEach(btn => btn.addEventListener('click', () => {
    logSize = Math.min(LOG_SIZES.length - 1, Math.max(0, logSize + Number(btn.dataset.logSize)));
    try { localStorage.setItem('combatLogSize', LOG_SIZES[logSize]); } catch {}
    const log = document.getElementById('combat-log');
    if (log) { log.dataset.size = LOG_SIZES[logSize]; log.scrollTop = log.scrollHeight; }
    root.querySelectorAll('[data-log-size]').forEach(b => {
      b.disabled = b.dataset.logSize === '-1' ? logSize === 0 : logSize === LOG_SIZES.length - 1;
    });
  }));
}

export function renderMapToggleHTML() {
  const opts = [
    { val: 'both',  label: 'Both' },
    { val: 'team0', label: 'Team 1' },
    { val: 'team1', label: 'Team 2' },
  ];
  const btns = opts.map(o =>
    `<button class="map-toggle-btn${S.mapViewFilter === o.val ? ' active' : ''}" data-filter="${o.val}">${o.label}</button>`
  ).join('');
  const mapName = S.currentMap ? `<span class="map-name-badge">📍 ${S.currentMap.name}</span>` : '';
  return `<div class="map-toggle-row">${btns}${mapName}</div>`;
}


// ── Screen renders ─────────────────────────────────────────────────────────

export function render() {
  if (S.phase === 'selection')       renderSelectionScreen();
  else if (S.phase === 'mapchoice')  renderMapChoiceScreen();
  else if (S.phase === 'initiative') renderInitiativeScreen();
  else if (S.phase === 'combat')     renderCombatScreen();
  else if (S.phase === 'victory')    renderVictoryScreen();
}

// Name filter typed into the champion search; survives the re-render after each pick
let charFilter = '';
const TEAM_NUM = ['I', 'II'];

/**
 * opts.focus    : { name, team } — after a pick, keyboard focus returns to that card's button
 * opts.announce : short sentence for screen readers ("Susano added to Team I.")
 */
export function renderSelectionScreen(opts = {}) {
  const charGrid = (teamIdx) => allChars.map(c => {
      const inThis  = S.teamNames[teamIdx].includes(c.nom);
      const inOther = S.teamNames[1 - teamIdx].includes(c.nom);
      const full    = S.teamNames[teamIdx].length >= 5;
      const locked  = !inThis && (inOther || full);
      const why     = inOther ? `In Team ${TEAM_NUM[1 - teamIdx]}` : 'Team full';
      const stats = [['HP', c.hp], ['Slots', c.spellSlot ?? 0], c.ki ? ['Ki', c.ki] : null, ['Speed', c.speed ?? 6], ['Moves', c.moveSet?.length ?? 0]]
        .filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
      return `
        <li class="char-select-card${inThis ? ' is-selected' : ''}${locked ? ' is-disabled' : ''}" data-search="${c.nom.toLowerCase()}">
          <span class="crest-initial" aria-hidden="true">${(c.nom[0] ?? '?').toUpperCase()}</span>
          <h5 class="select-card-name">${c.nom}</h5>
          <dl class="select-card-stats">${stats}</dl>
          ${inThis
            ? `<button class="select-btn remove-btn" data-name="${c.nom}" data-team="${teamIdx}" aria-label="Remove ${c.nom} from Team ${TEAM_NUM[teamIdx]}">Remove</button>`
            : `<button class="select-btn add-btn" data-name="${c.nom}" data-team="${teamIdx}" aria-label="${locked ? `${c.nom}: ${why.toLowerCase()}` : `Add ${c.nom} to Team ${TEAM_NUM[teamIdx]}`}" ${locked ? 'disabled' : ''}>${locked ? why : `Add to Team ${TEAM_NUM[teamIdx]}`}</button>`
          }
        </li>`;
  }).join('');

  const roster = (teamIdx) => {
    if (!S.teamNames[teamIdx].length) return '<li class="no-selection">No champions yet</li>';
    return S.teamNames[teamIdx].map(n =>
      `<li class="selected-chip">${n}
         <button class="chip-remove" data-name="${n}" data-team="${teamIdx}" aria-label="Remove ${n} from Team ${TEAM_NUM[teamIdx]}">×</button>
       </li>`
    ).join('');
  };

  const team = (teamIdx) => `
    <section class="selection-team" aria-labelledby="team-head-${teamIdx}">
      <h4 class="team-header ${teamIdx === 0 ? 'team-a-header' : 'team-b-header'}" id="team-head-${teamIdx}">
        Team ${TEAM_NUM[teamIdx]} <span class="team-count">${S.teamNames[teamIdx].length} / 5</span>
      </h4>
      <ul class="selected-roster" aria-label="Team ${TEAM_NUM[teamIdx]} roster">${roster(teamIdx)}</ul>
      <ul class="char-select-grid" aria-label="Champions for Team ${TEAM_NUM[teamIdx]}">${charGrid(teamIdx)}</ul>
      <p class="no-match" hidden>No champion matches “<span></span>”.</p>
    </section>`;

  const canStart = S.teamNames[0].length > 0 && S.teamNames[1].length > 0;

  root.innerHTML = `
    <div class="selection-layout">
      <div class="selection-header">
        <span class="cx-eyebrow">War Council</span>
        <h3 class="selection-title">Choose Your Champions</h3>
        <p class="selection-sub">Pick 1–5 champions per team, then choose the battlefield.</p>
      </div>
      <div class="selection-search">
        <label for="char-search">Find a champion</label>
        <input type="search" id="char-search" placeholder="Type a name…" autocomplete="off" value="${charFilter.replace(/"/g, '&quot;')}">
      </div>
      <div class="selection-teams">${team(0)}${team(1)}</div>
      <div class="selection-footer">
        <fieldset class="opponent-picker">
          <legend>Opponent</legend>
          ${[[null, 'Two players'], [1, 'Bot plays Team II'], [0, 'Bot plays Team I']].map(([v, label]) => `
          <label><input type="radio" name="ai-team" value="${v ?? ''}"${S.aiTeam === v ? ' checked' : ''}> ${label}</label>`).join('')}
        </fieldset>
        <button class="combat-start-btn" id="btn-start" ${canStart ? '' : 'disabled aria-describedby="start-hint"'}>
          Next: choose the battlefield
        </button>
        ${canStart ? '' : '<p class="start-hint" id="start-hint">Pick at least one champion for each team.</p>'}
      </div>
      <p class="sr-only" role="status">${opts.announce ?? ''}</p>
    </div>`;

  const applyFilter = () => {
    const q = charFilter.trim().toLowerCase();
    root.querySelectorAll('.selection-team').forEach(sec => {
      let shown = 0;
      sec.querySelectorAll('.char-select-card').forEach(card => {
        const hit = !q || card.dataset.search.includes(q);
        card.hidden = !hit;
        if (hit) shown++;
      });
      const none = sec.querySelector('.no-match');
      none.hidden = shown > 0;
      none.querySelector('span').textContent = charFilter.trim();
    });
  };
  applyFilter();
  root.querySelector('#char-search').addEventListener('input', e => { charFilter = e.target.value; applyFilter(); });

  bindSelectionEvents();

  if (opts.focus) {
    const sel = `.char-select-grid [data-name="${CSS.escape(opts.focus.name)}"][data-team="${opts.focus.team}"]`;
    (root.querySelector(sel) ?? root.querySelector('#char-search'))?.focus({ preventScroll: true });
  }
}

// Manifest titles + thumbnails, fetched once per page load
let mapMetas = null;
function permanentMaps() {
  mapMetas ??= loadManifest()
    .then(slugs => Promise.all(slugs.map(loadMapMeta)))
    .catch(() => { mapMetas = null; return []; });
  return mapMetas;
}

export async function renderMapChoiceScreen() {
  const metas = await permanentMaps();
  if (S.phase !== 'mapchoice') return; // moved on while the manifest loaded

  const row = (choice, thumb, title, sub) => `
    <button class="map-choice-row${S.mapChoice === choice ? ' is-selected' : ''}"
            data-choice="${choice}" aria-pressed="${S.mapChoice === choice}">
      ${thumb}
      <span class="map-choice-text">
        <span class="map-choice-title">${title}</span>
        ${sub ? `<span class="map-choice-sub">${sub}</span>` : ''}
      </span>
    </button>`;
  const rows = metas.map(m => row(m.slug,
      `<img class="map-choice-thumb" src="${m.thumb}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`,
      m.name, '')).join('')
    + row('random', '<span class="map-choice-thumb map-choice-die" aria-hidden="true">🎲</span>',
      'Random dungeon', 'Freshly generated each time');

  root.innerHTML = `
    <div class="map-choice-screen">
      <div class="selection-header">
        <span class="cx-eyebrow">The Field of Battle</span>
        <h3 class="selection-title">Choose Your Battlefield</h3>
      </div>
      ${S.mapLoading
        ? `<div class="map-loading" role="status">
             <span class="map-loading-die" aria-hidden="true">🎲</span>
             <span class="map-loading-text">${S.mapChoice === 'random' ? 'Drawing the dungeon…' : 'Unrolling the map…'}</span>
           </div>`
        : `<div class="map-choice-list">${rows}</div>
           <div class="rematch-actions">
             <button class="combat-start-btn secondary-btn" id="btn-map-back">↩ Back</button>
             <button class="combat-start-btn" id="btn-map-confirm">Confirm map</button>
           </div>`}
    </div>`;

  root.querySelectorAll('.map-choice-row').forEach(btn => {
    btn.addEventListener('click', () => {
      S.mapChoice = btn.dataset.choice;
      root.querySelectorAll('.map-choice-row').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', on);
      });
    });
  });
  document.getElementById('btn-map-back')?.addEventListener('click', () => {
    if (S.mapLoading) return;
    S.phase = 'selection';
    render();
  });
  document.getElementById('btn-map-confirm')?.addEventListener('click', () => confirmMap(S.mapChoice));
}

export function renderInitiativeScreen() {
  const initMax = Math.max(26, ...S.initiativeOrder.map(id => getCombatant(id).initiativeRoll)); // 20 + speed bonus, but never clip a bigger roll
  const rows = S.initiativeOrder.map(id => {
    const c    = getCombatant(id);
    const pct  = ((c.initiativeRoll / initMax) * 100).toFixed(1);
    const tcls = c.teamIndex === 0 ? 'team-a' : 'team-b';
    return `
      <div class="init-roll-row">
        <span class="init-name ${tcls}">${c.name}</span>
        <div class="init-bar-track">
          <div class="init-bar-fill ${tcls}" style="width:0%" data-target="${Math.min(pct, 100)}"></div>
        </div>
        <span class="init-value">${c.initiativeRoll}</span>
      </div>`;
  }).join('');
  const order = S.initiativeOrder.map(id => getCombatant(id).name).join(' → ');
  root.innerHTML = `
    <div class="initiative-screen">
      <span class="cx-eyebrow">The Dice Decide</span>
      <h3 class="init-screen-title">Initiative Rolls</h3>
      <div class="init-rows">${rows}</div>
      <p class="init-order-display">Turn order: <strong>${order}</strong></p>
      <button class="combat-start-btn" id="btn-begin">Begin Combat</button>
    </div>`;
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

export function renderCombatScreen() {
  const active = activeCombatant();

  const teamColHTML = (teamIdx) => {
    const isActiveTeam = active?.teamIndex === teamIdx;
    const inactiveClass = isActiveTeam ? '' : ' team-inactive';
    const labelClass = teamIdx === 0 ? 'team-a-header' : 'team-b-header';
    const cards = S.combatants
      .filter(c => c.teamIndex === teamIdx)
      .map(c => combatantCardHTML(c, active?.id === c.id))
      .join('');
    const panel = (active && isActiveTeam && S.phase === 'combat' && !controlledByAi(active))
      ? actionPanelHTML(active)
      : '';
    return `
      <div class="combat-team-col combat-team-col--${teamIdx}${inactiveClass}">
        <div class="team-label ${labelClass}">Team ${teamIdx + 1}</div>
        ${cards}
        ${panel}
      </div>`;
  };

  root.innerHTML = `
    <div class="combat-layout-3col">
      <div class="combat-turn-track">
        <span class="round-badge">Round ${S.roundNumber}</span>
        ${aiStatusHTML()}
        ${initiativeStripHTML()}
      </div>
      <div class="combat-arena">
        ${teamColHTML(0)}
        <div class="combat-center-col">
          <div class="combat-map-pane">
            ${renderMapToggleHTML()}
            <div class="dungeon-canvas-wrap">
              <canvas id="dungeon-canvas"
                      width="${S.currentMap?.image?.naturalHeight ?? 504}"
                      height="${S.currentMap?.image?.naturalWidth  ?? 672}"></canvas>
            </div>
          </div>
          ${logPanelHTML()}
        </div>
        ${teamColHTML(1)}
      </div>
    </div>
    ${S.awaitingReact ? reactPromptHTML() : ''}
    ${S.awaitingFree ? freeActionPromptHTML() : ''}`;

  const log = root.querySelector('#combat-log');
  if (log) log.scrollTop = log.scrollHeight;
  bindLogControls();

  // Keep the acting fighter in view on a sideways-scrolling turn order (without moving the page)
  const strip = root.querySelector('.initiative-strip');
  const now   = strip?.querySelector('.init-chip.active');
  if (now) strip.scrollLeft = now.offsetLeft - strip.offsetLeft - (strip.clientWidth - now.offsetWidth) / 2;

  bindCombatEvents();
  bindFreeActionEvents();

  const canvas = document.getElementById('dungeon-canvas');
  if (canvas && S.moveMode) canvas.classList.add('move-mode');
  drawMap();
  setupCanvasClickHandler();

  const ab0 = active?.abilities.find(a => a.name === document.querySelector('input[name="ability"]:checked')?.value);
  const prevEl = document.getElementById('ability-preview');
  if (prevEl) prevEl.innerHTML = abilityPreviewHTML(ab0);
  scheduleAI();
}

export function renderReactOverlay() {
  document.getElementById('react-overlay')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = reactPromptHTML();
  if (wrapper.firstElementChild) {
    document.body.appendChild(wrapper.firstElementChild);
    bindReactEvents();
  }
  scheduleAI();
}

export function renderFreeActionOverlay() {
  document.getElementById('free-overlay')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = freeActionPromptHTML();
  if (wrapper.firstElementChild) {
    document.body.appendChild(wrapper.firstElementChild);
    bindFreeActionEvents();
  }
  scheduleAI();
}

export function renderVictoryScreen() {
  const winner    = S.winnerTeam;
  const teamName  = t => `Team ${t === 0 ? 'I' : 'II'}`;
  const survivors = S.combatants.filter(c => c.teamIndex === winner && !c.isKO);
  const fallen    = S.combatants.filter(c => c.isKO);
  const survivorCards = survivors.map(c => {
    const pct = Math.max(0, (c.currentHp / c.maxHp) * 100);
    return `
      <li class="survivor-chip">
        <span class="survivor-name">${c.name}</span>
        <span class="survivor-hp">${c.currentHp} / ${c.maxHp} HP</span>
        <span class="hp-bar-wrap" aria-hidden="true"><span class="hp-bar${pct < 25 ? ' low' : pct < 50 ? ' mid' : ''}" style="width:${pct.toFixed(1)}%"></span></span>
      </li>`;
  }).join('');
  const fallenList = fallen.map(c =>
    `<li class="fallen-chip ${c.teamIndex === 0 ? 'team-a' : 'team-b'}"><span class="fallen-name">${c.name}</span> <span class="fallen-team">${teamName(c.teamIndex)}</span></li>`
  ).join('');
  const facts = [
    `${S.roundNumber} round${S.roundNumber === 1 ? '' : 's'}`,
    S.currentMap?.name,
    `${survivors.length} of ${S.combatants.filter(c => c.teamIndex === winner).length} standing`,
  ].filter(Boolean);

  root.innerHTML = `
    <section class="victory-screen" aria-labelledby="victory-title">
      <span class="cx-eyebrow">Battle concluded</span>
      <h2 class="victory-title" id="victory-title" tabindex="-1">${teamName(winner)} wins</h2>
      <ul class="victory-facts" aria-label="Battle summary">${facts.map(f => `<li>${f}</li>`).join('')}</ul>

      <h3 class="survivor-label">Survivors</h3>
      <ul class="survivor-list">${survivorCards || '<li class="victory-none">No survivors.</li>'}</ul>

      ${fallen.length ? `
        <h3 class="survivor-label">Fallen</h3>
        <ul class="fallen-list">${fallenList}</ul>` : ''}

      <div class="rematch-actions">
        <button class="combat-start-btn" id="btn-rematch">Rematch — same teams</button>
        <button class="combat-start-btn secondary-btn" id="btn-new-teams">New teams</button>
      </div>

      ${S.log.length ? `
        <details class="victory-log">
          <summary>Read the battle chronicle</summary>
          ${logPanelHTML()}
        </details>` : ''}
    </section>`;

  bindLogControls();
  // The fight screen is gone: move focus to the result so keyboard and screen-reader users land on it
  document.getElementById('victory-title')?.focus({ preventScroll: true });

  document.getElementById('btn-rematch')?.addEventListener('click', async () => {
    S.combatants = []; S.initiativeOrder = []; S.log = []; S.winnerTeam = null;
    S.awaitingReact = false; S.pendingAction = null; S.reactOptions = []; S.awaitingFree = null;
    S.currentMap = null; S.mapViewFilter = 'both';
    S.hasMoved = false; S.hasActed = false; S.moveMode = false; S.reachableCells = new Map();
    clearAimState();
    const btn = document.getElementById('btn-rematch');
    if (btn) btn.disabled = true;
    await goToMapChoice();
  });

  document.getElementById('btn-new-teams')?.addEventListener('click', () => {
    Object.assign(S, {
      phase: 'selection', teamNames: [[], []], combatants: [],
      initiativeOrder: [], log: [], winnerTeam: null,
      awaitingReact: false, pendingAction: null, reactOptions: [], awaitingFree: null,
      currentMap: null, mapChoice: null, mapLoading: false, mapViewFilter: 'both',
      hasMoved: false, hasActed: false, moveMode: false, reachableCells: new Map(),
    });
    render();
  });
}

// ── Register render callbacks in _R (called at module evaluation time) ──────
_R.render              = render;
_R.renderCombatScreen  = renderCombatScreen;
_R.renderReactOverlay  = renderReactOverlay;
_R.renderFreeActionOverlay = renderFreeActionOverlay;
_R.renderVictoryScreen = renderVictoryScreen;
_R.appendLog           = appendLog;
