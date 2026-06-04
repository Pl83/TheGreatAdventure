/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-render.js — HTML generation and screen rendering
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  _R, S, SPELL_RANGE, allChars,
  activeCombatant, livingCombatants, koAllies, getCombatant,
  enemies, abilityAvailable, hasSilence, hasValidTarget,
  chebyshev, targetInRange,
  drawMap, setupCanvasClickHandler,
  clearAimState, startCombat, startInitiative,
} from './combat-logic.js';

import { bindSelectionEvents, bindCombatEvents, bindReactEvents } from './combat-events.js';

export const root = document.getElementById('combat-root');

// ── §12  Render helpers ────────────────────────────────────────────────────

export function statusEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('burn'))                                         return '🔥';
  if (n.includes('toxic') || n.includes('poison'))               return '🧪';
  if (n.includes('bleed') || n.includes('hemo'))                 return '🩸';
  if (['para','stun','cocoon','fear'].some(k => n.includes(k)))  return '⚡';
  if (n.includes('gel') || n.includes('freeze'))                 return '❄️';
  if (n.includes('silence'))                                      return '🔇';
  if (n.includes('root'))                                         return '🌿';
  if (n.includes('blind'))                                        return '🙈';
  if (n.includes('regen') || n.includes('regenerat'))            return '💚';
  if (n === 'fly')                                               return '🦅';
  if (n === 'chains_of_apophis')                                 return '⛓';
  if (n === 'living_blade_armor')                                return '⚔';
  if (n === 'final_reckoning')                                   return '💀';
  if (n === 'runik_precast')                                     return '✦';
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
  return `<div class="hp-bar-wrap"><div class="hp-bar${cls}" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="hp-text">${c.currentHp} / ${c.maxHp} HP</span>`;
}

export function resourceHTML(c) {
  let out = '';
  if (c.maxSpellSlots > 0) {
    const showMax = Math.min(c.maxSpellSlots, 12);
    const pips = Array.from({ length: showMax }, (_, i) =>
      `<span class="spell-pip ${i < c.spellSlots ? 'filled' : 'empty'}" title="Slot ${i + 1}"></span>`
    ).join('');
    const extra = c.maxSpellSlots > 12 ? `<span class="pip-overflow">+${c.maxSpellSlots - 12}</span>` : '';
    out += `<div class="spell-pips">${pips}${extra}</div>`;
  }
  if (c.maxKi > 0) out += `<div class="ki-counter">Ki: ${c.ki}/${c.maxKi}</div>`;
  if (c.souls > 0 || c.sourceChar.souls) out += `<div class="ki-counter souls-counter">Souls: ${c.souls}</div>`;
  return out;
}

export function statusBadgesHTML(c) {
  if (!c.statusEffects.length) return '';
  const badges = c.statusEffects.map(e => {
    const durTxt = e.name === 'damage_shield'
      ? `${e.shieldHp} HP`
      : (e.turnsLeft === 999 ? '∞' : e.turnsLeft + 't');
    return `<span class="status-badge ${statusCssClass(e.damType)}" title="${e.notes}">${e.name} (${durTxt})</span>`;
  }).join('');
  return `<div class="status-badge-row">${badges}</div>`;
}

export function combatantCardHTML(c, isActive) {
  const koClass      = c.isKO        ? ' is-ko'      : '';
  const activeClass  = isActive      ? ' active-turn' : '';
  const teamClass    = c.teamIndex === 0 ? ' team-a' : ' team-b';
  const tfBadge      = c.isTransformed
    ? `<span class="transform-active-badge">${c.sourceChar.transformation?.base.nom ?? 'Transformed'}</span>`
    : '';
  const domainBadge  = c.domainActive
    ? `<span class="domain-active-badge">${c.sourceChar.domain?.name ?? 'Domain'}</span>`
    : '';
  const passivesHTML = c.sourceChar.passif?.length
    ? `<div class="char-passives-mini">${c.sourceChar.passif.slice(0, 2).map(p =>
        `<span class="passive-mini" title="${p.nom}">${p.nom.length > 40 ? p.nom.slice(0, 40) + '…' : p.nom}</span>`
      ).join('')}</div>`
    : '';
  return `
    <div class="combat-char-card${koClass}${activeClass}${teamClass}" data-id="${c.id}">
      <div class="combat-char-name">${c.name}</div>
      ${hpBarHTML(c)}
      ${resourceHTML(c)}
      ${statusBadgesHTML(c)}
      ${tfBadge}${domainBadge}
      ${passivesHTML}
    </div>`;
}

export function initiativeStripHTML() {
  const chips = S.initiativeOrder.map((id, idx) => {
    const c        = getCombatant(id);
    const isActive = idx === S.currentTurnIndex;
    return `<div class="init-chip${c.isKO ? ' is-ko' : ''}${isActive ? ' active' : ''} ${c.teamIndex === 0 ? 'team-a' : 'team-b'}" title="${c.name} — init ${c.initiativeRoll}">
              ${c.name}<br><small>${c.initiativeRoll}</small>
            </div>`;
  }).join('');
  return `<div class="initiative-strip">${chips}</div>`;
}

export function abilityPreviewHTML(ability) {
  if (!ability) return '';
  const tags = [];
  if (ability.isAoe)     tags.push('AoE');
  if (ability.isCone)    tags.push('Cone');
  if (ability.isSplash)  tags.push('Splash');
  if (ability.isReact)   tags.push('React');
  if (ability.isInstant) tags.push('Instant');
  if (ability.isBlock)   tags.push('Block');
  if (ability.isHeal)    tags.push('Heal');
  if (ability.maxBounce) tags.push(`Bounce×${ability.maxBounce}`);
  if (ability.targetKind === 'ally') tags.push('Ally');
  if (ability.targetKind === 'self') tags.push('Self');
  if (ability.range && ability.range !== SPELL_RANGE) tags.push(`r${ability.range}`);
  if (ability.radius > 0) tags.push(`ø${ability.radius}`);
  const tagHTML  = tags.map(t => `<span class="ab-tag">${t}</span>`).join('');
  const diceHTML = ability.dice   ? `<span class="ab-dice">${ability.dice}</span>` : '';
  const fxHTML   = ability.effect ? `<span class="ab-effect">✦ ${ability.effect}</span>` : '';
  const descHTML = ability.desc   ? `<span class="ab-desc">${ability.desc}</span>` : '';
  const costHTML = ability.cost   ? `<span class="ab-cost">${ability.cost.amount} ${ability.cost.type}</span>` : '';
  return `<div class="ability-preview">${diceHTML}${fxHTML}${costHTML}${tagHTML}${descHTML}</div>`;
}

export function abilityFireLabel(ab) {
  if (!ab) return 'Aim';
  if (ab.tags?.includes('teleportation')) return '✦ Teleport';
  if (ab.isAoe) return 'Aim AoE';
  if (ab.targetKind === 'self') return 'Use';
  if (ab.isCone) return 'Aim Cone';
  return 'Aim';
}

export function actionPanelHTML(c) {
  const enemyTeam  = c.teamIndex === 0 ? 1 : 0;
  const enemyAlive = livingCombatants(enemyTeam);
  const allyAlive  = livingCombatants(c.teamIndex);
  const silence    = hasSilence(c);
  const hasMap     = !!S.currentMap;
  const acted      = S.hasActed;

  const targetOptsForAbility = (ability) => {
    if (ability?.targetKind === 'self') return `<option value="${c.id}">Self</option>`;
    if (ability?.targetKind === 'ally') {
      const allyPool = ability.isRevive
        ? [...allyAlive, ...koAllies(c.teamIndex)]
        : allyAlive;
      return allyPool.map(t =>
        `<option value="${t.id}">${t.name} (${t.currentHp}/${t.maxHp}HP)${t.isKO ? ' [KO]' : ''}</option>`
      ).join('');
    }
    if (enemyAlive.length === 0) return '<option>No targets</option>';
    return enemyAlive.map(t => {
      const dist    = hasMap ? chebyshev(c, t) : 0;
      const range   = hasMap ? targetInRange(c, t, ability) : { inRange: true, reason: '' };
      const distTxt = hasMap ? ` ${dist}sq` : '';
      const warnTxt = (hasMap && !range.inRange)
        ? (range.reason.includes('sight') ? ' ✗' : ' !') : '';
      const disabled = (hasMap && !range.inRange && !ability?.isAoe) ? ' disabled' : '';
      return `<option value="${t.id}"${disabled}>${t.name} (${t.currentHp}HP${distTxt}${warnTxt})</option>`;
    }).join('');
  };

  const atkTargetOpts = targetOptsForAbility(null);
  const noEnemies     = enemyAlive.length === 0;

  const isRooted = c.statusEffects.some(e => e.name.toLowerCase() === 'root');
  const moveSection = !S.hasMoved ? `
    <div class="action-section move-section">
      ${isRooted
        ? `<span class="move-done-badge">Rooted — cannot move</span>`
        : S.moveMode
          ? `<button class="action-btn map-cancel-move-btn" id="btn-cancel-move">Cancel Move</button>
             <span class="move-hint">Click a highlighted cell on the map</span>`
          : `<button class="action-btn map-move-btn" id="btn-move">Move (${c.speed} cells)</button>`
      }
    </div>` : `
    <div class="action-section move-section">
      <span class="move-done-badge">Moved</span>
    </div>`;

  const abilityList = c.abilities.filter(ab =>
    !ab.isTransform &&
    abilityAvailable(c, ab) &&
    !(silence && ab.cost?.type === 'slots')
  );

  const SOURCE_LABEL = { spell: 'Spell', technoSpell: 'T-Spell', technique: 'Tech', Art: 'Art', relic: 'Relic' };

  const abOpt = (ab) => {
    const cdLeft    = c.cooldowns[ab.name] ?? 0;
    const cdTxt     = cdLeft > 0 ? ` [${cdLeft}T]` : ab.cooldownTurns > 0 ? ` [${ab.cooldownTurns}T CD]` : '';
    const costTxt   = ab.cost   ? ` · ${ab.cost.amount}${ab.cost.type === 'slots' ? 'S' : ab.cost.type === 'ki' ? 'Ki' : '♦'}` : '';
    const srcTxt    = SOURCE_LABEL[ab.source] ? `[${SOURCE_LABEL[ab.source]}] ` : '';
    const reactTxt  = (ab.isBlock || ab.isReact) ? ' [R]' : '';
    const chargeTxt = ab.maxCharges > 0 ? ` [${c.remainingCharges[ab.name] ?? ab.maxCharges}/${ab.maxCharges}♦]` : '';
    return `<option value="${ab.name}">${srcTxt}${ab.name}${reactTxt}${costTxt}${cdTxt}${chargeTxt}</option>`;
  };

  const firstAbility = abilityList[0];
  const atkNoTarget  = !hasValidTarget(c, null);
  const abNoTarget   = !hasValidTarget(c, firstAbility);

  const fireLabel = abilityFireLabel;

  const nomapTargetOpts = () => {
    if (!firstAbility || firstAbility.isAoe || firstAbility.isCone || firstAbility.targetKind === 'self') return '';
    const pool = firstAbility.targetKind === 'ally' ? allyAlive : enemyAlive;
    if (!pool.length) return '<option>No targets</option>';
    return pool.map(t => `<option value="${t.id}">${t.name} (${t.currentHp}HP)</option>`).join('');
  };

  const abilitySection = abilityList.length > 0 ? `
    <div class="action-section ability-section">
      <label class="action-label">Abilities${silence ? ' <span class="range-warn">Silenced</span>' : ` (${c.spellSlots}S · ${c.ki}Ki)`}</label>
      <select id="ability-select" class="target-select">${abilityList.map(abOpt).join('')}</select>
      <div class="aim-row">
        <button class="action-btn aim-btn" id="btn-ability-fire" ${abNoTarget || (acted && !firstAbility?.isInstant) ? 'disabled' : ''}>
          ${fireLabel(firstAbility)}
        </button>
        <span id="aim-hint-ability" class="aim-hint" style="display:none">↖ Click target on map</span>
      </div>
      ${!hasMap && nomapTargetOpts() ? `<select id="ability-target-nomap" class="target-select nomap-target">${nomapTargetOpts()}</select>` : ''}
      <div id="ability-preview" class="ability-preview-wrap"></div>
    </div>` : '';

  const tf = c.sourceChar.transformation;
  const tfAbility = c.abilities.find(a => a.isTransform);
  const transformSection = tf && tfAbility && !c.isTransformed ? `
    <div class="action-section">
      <label class="action-label">Transformation</label>
      <button class="action-btn transform-btn" id="btn-transform" data-caster="${c.id}"
              ${(acted || c.usedThisFight.includes(tf.base.nom)) ? 'disabled' : ''}>
        ${tf.base.nom} ${tfAbility.cost ? `(${tfAbility.cost.amount} ${tfAbility.cost.type})` : '(free)'}
      </button>
    </div>` : '';

  const domain = c.sourceChar.domain;
  const chargesLeft = c.domainCharges ?? 0;
  const domainSection = domain ? (c.domainActive
    ? `<div class="action-section"><span class="domain-active-badge">🌐 ${domain.name} — Active (${chargesLeft} charge${chargesLeft !== 1 ? 's' : ''} left)</span></div>`
    : chargesLeft > 0
      ? `<div class="action-section">
          <label class="action-label">Domain Expansion</label>
          <span class="domain-cost-label">${domain.name} · ${domain.type} · Ref.${domain.rafinement ?? 'N/A'} · ${domain.spellCost}S · ${chargesLeft}/${Math.max(1, Math.floor((domain.rafinement ?? 0) / 3))} charges</span>
          <button class="action-btn domain-btn" id="btn-domain" data-caster="${c.id}"
                  ${(c.spellSlots < domain.spellCost || acted) ? 'disabled' : ''}>
            Activate Domain
          </button>
        </div>`
      : `<div class="action-section"><span class="domain-active-badge" style="opacity:0.5">🌐 ${domain.name} — No charges left</span></div>`) : '';

  const activeDomainStrip = S.activeDomains.length > 0
    ? `<div class="active-domain-strip">${S.activeDomains.map(d => {
        const owner = getCombatant(d.casterId);
        if (!owner) return '';
        const teamClass = owner.teamIndex === 0 ? 'team0' : 'team1';
        return `<span class="domain-strip-entry ${teamClass}">🌐 ${owner.name}: ${d.domain.name} [${d.domain.type}]</span>`;
      }).join('')}</div>`
    : '';

  const atkNote = hasMap && atkNoTarget && !noEnemies
    ? '<span class="range-warn">Move closer to attack</span>' : '';

  return `
    ${activeDomainStrip}
    <div class="action-panel">
      <div class="action-panel-title">${c.name}'s Turn${acted ? ' <span class="acted-badge">Action Used</span>' : ''}</div>
      <div class="action-section finish-turn-section">
        <button class="action-btn finish-turn-btn" id="btn-pass">Finish Turn</button>
      </div>
      ${moveSection}
      <div class="action-section">
        <label class="action-label">Basic Attack ${atkNote}</label>
        <select id="atk-target" class="target-select" ${noEnemies ? 'disabled' : ''}>
          ${noEnemies ? '<option>No targets</option>' : atkTargetOpts}
        </select>
        <button class="action-btn confirm-action-btn" id="btn-attack" data-attacker="${c.id}"
                ${atkNoTarget || noEnemies || acted ? 'disabled' : ''}>
          Attack <span class="atk-dice">(${c.transformedBaseAtk?.dices ?? c.sourceChar.baseAtk?.dices ?? '1d6'})</span>
        </button>
      </div>
      ${abilitySection}
      ${transformSection}
      ${domainSection}
    </div>`;
}

export function reactPromptHTML() {
  if (!S.awaitingReact || !S.reactOptions.length) return '';
  const reactor  = getCombatant(S.reactOptions[0].combatantId);
  const action   = S.pendingAction;
  const attacker = getCombatant(action?.attackerId ?? action?.casterId);
  const abilityOpts = S.reactOptions.map((opt, i) => `
    <div class="react-ability-option ${i === 0 ? 'is-selected' : ''}" data-ability-name="${opt.ability.name}">
      <strong>${opt.ability.name}</strong>
      <span class="react-option-desc">${opt.ability.desc || (opt.ability.isBlock ? 'Block' : 'React')}</span>
    </div>`).join('');
  return `
    <div id="react-overlay" class="react-overlay">
      <div class="react-dialog">
        <div class="react-title">React Opportunity</div>
        <p class="react-desc-text">${attacker ? attacker.name : 'Enemy'} targets ${reactor.name}!</p>
        <p class="react-sub">${reactor.name} can react with:</p>
        <div class="react-ability-list">${abilityOpts}</div>
        <div class="react-buttons">
          <button class="react-yes-btn" id="btn-react-yes">React</button>
          <button class="react-no-btn"  id="btn-react-no">Take the Hit</button>
        </div>
      </div>
    </div>`;
}

export function logPanelHTML() {
  const entries = S.log.slice(-80).map(e => {
    if (e.flavor === 'divider') return `<div class="log-round-divider">${e.text}</div>`;
    return `<div class="log-entry log-${e.flavor}">${e.text}</div>`;
  }).join('');
  return `<div class="combat-log" id="combat-log">${entries}</div>`;
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
  else if (S.phase === 'initiative') renderInitiativeScreen();
  else if (S.phase === 'combat')     renderCombatScreen();
  else if (S.phase === 'victory')    renderVictoryScreen();
}

export function renderSelectionScreen() {
  const charGrid = (teamIdx) => allChars.map(c => {
      const inThis  = S.teamNames[teamIdx].includes(c.nom);
      const inOther = S.teamNames[1 - teamIdx].includes(c.nom);
      const full    = S.teamNames[teamIdx].length >= 4;
      const locked  = !inThis && (inOther || full);
      const abilCount = c.moveSet?.length ?? 0;
      return `
        <div class="char-select-card${inThis ? ' is-selected' : ''}${locked ? ' is-disabled' : ''}">
          <span class="crest-initial">${(c.nom[0] ?? '?').toUpperCase()}</span>
          <div class="select-card-name">${c.nom}</div>
          <div class="select-card-stats">${c.hp} HP · ${c.spellSlot ?? 0} slots · ${c.ki ?? 0} ki · spd ${c.speed ?? 6}</div>
          <div class="select-card-count">${abilCount} moves</div>
          ${inThis
            ? `<button class="select-btn remove-btn" data-name="${c.nom}" data-team="${teamIdx}">✕ Remove</button>`
            : `<button class="select-btn add-btn" data-name="${c.nom}" data-team="${teamIdx}" ${locked ? 'disabled' : ''}>+ Team ${teamIdx + 1}</button>`
          }
        </div>`;
  }).join('');

  const roster = (teamIdx) => {
    if (!S.teamNames[teamIdx].length) return '<span class="no-selection">None selected</span>';
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
        <span class="cx-eyebrow">War Council</span>
        <h3 class="selection-title">Choose Your Champions</h3>
        <p class="selection-sub">Pick 1–4 characters per team, then roll for initiative.</p>
      </div>
      <div class="selection-teams">
        <div class="selection-team">
          <div class="team-header team-a-header">Team I</div>
          <div class="selected-roster">${roster(0)}</div>
          <div class="char-select-grid">${charGrid(0)}</div>
        </div>
        <div class="selection-team">
          <div class="team-header team-b-header">Team II</div>
          <div class="selected-roster">${roster(1)}</div>
          <div class="char-select-grid">${charGrid(1)}</div>
        </div>
      </div>
      <div class="selection-footer">
        <button class="combat-start-btn" id="btn-start" ${canStart ? '' : 'disabled'}>
          Roll for Initiative
        </button>
      </div>
    </div>`;

  bindSelectionEvents();
}

export function renderInitiativeScreen() {
  const rows = S.initiativeOrder.map(id => {
    const c    = getCombatant(id);
    const pct  = ((c.initiativeRoll / 26) * 100).toFixed(1); // max = 20 + 3 from speed 12
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
    const panel = (active && isActiveTeam && S.phase === 'combat')
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
    ${S.awaitingReact ? reactPromptHTML() : ''}`;

  const log = root.querySelector('#combat-log');
  if (log) log.scrollTop = log.scrollHeight;

  bindCombatEvents();

  const canvas = document.getElementById('dungeon-canvas');
  if (canvas && S.moveMode) canvas.classList.add('move-mode');
  drawMap();
  setupCanvasClickHandler();

  const ab0 = active?.abilities.find(a => a.name === document.getElementById('ability-select')?.value);
  const prevEl = document.getElementById('ability-preview');
  if (prevEl) prevEl.innerHTML = abilityPreviewHTML(ab0);
}

export function renderReactOverlay() {
  document.getElementById('react-overlay')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = reactPromptHTML();
  document.body.appendChild(wrapper.firstElementChild);
  bindReactEvents();
}

export function renderVictoryScreen() {
  const winner    = S.winnerTeam;
  const survivors = S.combatants.filter(c => c.teamIndex === winner && !c.isKO);
  const survivorCards = survivors.map(c => `
    <div class="survivor-chip">
      <div class="survivor-name">${c.name}</div>
      <div class="hp-text">${c.currentHp} / ${c.maxHp} HP</div>
    </div>`).join('');

  root.innerHTML = `
    <div class="victory-screen">
      <span class="cx-eyebrow">Battle Concluded</span>
      <div class="victory-title">Victory</div>
      <div class="victory-subtitle">Team ${winner + 1} wins the battle!</div>
      <div class="survivor-label">Survivors</div>
      <div class="survivor-list">${survivorCards || '<p>No survivors.</p>'}</div>
      <div class="rematch-actions">
        <button class="combat-start-btn" id="btn-rematch">Rematch</button>
        <button class="combat-start-btn secondary-btn" id="btn-new-teams">↩ New Teams</button>
      </div>
    </div>`;

  document.getElementById('btn-rematch')?.addEventListener('click', async () => {
    S.combatants = []; S.initiativeOrder = []; S.log = []; S.winnerTeam = null;
    S.awaitingReact = false; S.pendingAction = null; S.reactOptions = [];
    S.currentMap = null; S.mapViewFilter = 'both';
    S.hasMoved = false; S.hasActed = false; S.moveMode = false; S.reachableCells = new Map();
    clearAimState();
    const btn = document.getElementById('btn-rematch');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading map…'; }
    await startInitiative();
  });

  document.getElementById('btn-new-teams')?.addEventListener('click', () => {
    Object.assign(S, {
      phase: 'selection', teamNames: [[], []], combatants: [],
      initiativeOrder: [], log: [], winnerTeam: null,
      awaitingReact: false, pendingAction: null, reactOptions: [],
      currentMap: null, mapViewFilter: 'both',
      hasMoved: false, hasActed: false, moveMode: false, reachableCells: new Map(),
    });
    render();
  });
}

// ── Register render callbacks in _R (called at module evaluation time) ──────
_R.render              = render;
_R.renderCombatScreen  = renderCombatScreen;
_R.renderReactOverlay  = renderReactOverlay;
_R.renderVictoryScreen = renderVictoryScreen;
