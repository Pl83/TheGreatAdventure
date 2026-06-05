/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-events.js — Event binding for all combat screens
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  S,
  activeCombatant, livingCombatants, enemies,
  hasValidTarget, drawMap,
  handlePass, handleAttack, handleCastAbility,
  handleTransform, handleActivateDomain,
  handleReactYes, handleReactNo,
  enterMoveMode, exitMoveMode,
  enterAimMode, exitAimMode,
  addLog, startInitiative,
} from './combat-logic.js';

import { abilityPreviewHTML, abilityFireLabel, renderCombatScreen, renderSelectionScreen } from './combat-render.js';

// ── §13  Event Binding ─────────────────────────────────────────────────────

export function bindSelectionEvents() {
  const root = document.getElementById('combat-root');
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
  document.getElementById('btn-start')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-start');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading map…'; }
    await startInitiative();
  });
}

export function bindCombatEvents() {
  if (!activeCombatant() || S.phase !== 'combat') return;
  const active = activeCombatant();

  document.getElementById('btn-pass')?.addEventListener('click', handlePass);

  document.getElementById('btn-attack')?.addEventListener('click', () => {
    const targetId = parseInt(document.getElementById('atk-target')?.value);
    if (!isNaN(targetId)) handleAttack(active.id, targetId);
  });

  // ── Unified ability handler ────────────────────────────────────────────────
  function getSelectedAbility() {
    return active.abilities.find(a => a.name === document.getElementById('ability-select')?.value);
  }

  function fireAbilityImmediate(ability) {
    const targetIds = ability.isAoe
      ? (ability.targetKind === 'ally'
          ? livingCombatants(active.teamIndex).map(t => t.id)
          : enemies(active).map(t => t.id))
      : [active.id];
    handleCastAbility(active.id, ability.name, targetIds);
  }

  document.getElementById('btn-ability-fire')?.addEventListener('click', () => {
    const ability = getSelectedAbility();
    if (!ability) return;
    if (ability.tags?.includes('teleportation')) {
      if (!S.currentMap) { addLog(`No map for teleportation.`, 'info'); return; }
      handleCastAbility(active.id, ability.name, [active.id]);
      return;
    }
    if (ability.targetKind === 'self') {
      fireAbilityImmediate(ability);
      return;
    }
    if (ability.isAoe) {
      if (!S.currentMap) { fireAbilityImmediate(ability); return; }
      enterAimMode(ability, 'ability');
      const hint = document.getElementById('aim-hint-ability');
      if (hint) hint.style.display = 'inline';
      return;
    }
    if (!S.currentMap) {
      const targetId = parseInt(document.getElementById('ability-target-nomap')?.value);
      if (!isNaN(targetId)) handleCastAbility(active.id, ability.name, [targetId]);
      return;
    }
    enterAimMode(ability, 'ability');
    const hint = document.getElementById('aim-hint-ability');
    if (hint) hint.style.display = 'inline';
  });

  // Transform button
  document.getElementById('btn-transform')?.addEventListener('click', () => {
    handleTransform(parseInt(document.getElementById('btn-transform').dataset.caster));
  });

  // Domain button
  document.getElementById('btn-domain')?.addEventListener('click', () => {
    handleActivateDomain(parseInt(document.getElementById('btn-domain').dataset.caster));
  });

  // Move / Cancel-move
  document.getElementById('btn-move')?.addEventListener('click', () => {
    enterMoveMode(); renderCombatScreen();
  });
  document.getElementById('btn-cancel-move')?.addEventListener('click', () => {
    exitMoveMode(); renderCombatScreen();
  });

  // Map view toggle
  document.querySelectorAll('.map-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.mapViewFilter = btn.dataset.filter;
      document.querySelectorAll('.map-toggle-btn').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      drawMap();
    });
  });

  // Ability preview + fire button sync
  function syncAbilityBtn() {
    const ab   = getSelectedAbility();
    const btn  = document.getElementById('btn-ability-fire');
    const prev = document.getElementById('ability-preview');
    const hint = document.getElementById('aim-hint-ability');
    if (prev) prev.innerHTML = abilityPreviewHTML(ab);

    if (!ab || !btn) return;
    const isImmediate = ab.targetKind === 'self' && !ab.tags?.includes('teleportation');
    btn.textContent = abilityFireLabel(ab);
    btn.disabled = !hasValidTarget(active, ab) || (S.hasActed && !ab.isInstant);

    // Update no-map fallback dropdown
    const nomapSel = document.getElementById('ability-target-nomap');
    if (nomapSel) {
      const pool = ab.targetKind === 'ally'
        ? livingCombatants(active.teamIndex)
        : livingCombatants(active.teamIndex === 0 ? 1 : 0);
      nomapSel.innerHTML = pool.map(t => `<option value="${t.id}">${t.name} (${t.currentHp}HP)</option>`).join('') || '<option>No targets</option>';
      nomapSel.style.display = (!S.currentMap && !isImmediate) ? '' : 'none';
    }

    // If in aim mode, update it for new ability
    if (S.aimMode && S.aimSection === 'ability') {
      if (!isImmediate && S.currentMap) {
        enterAimMode(ab, 'ability');
      } else {
        exitAimMode();
        if (hint) hint.style.display = 'none';
      }
    }
  }
  syncAbilityBtn();

  document.getElementById('ability-select')?.addEventListener('change', syncAbilityBtn);
}

export function bindReactEvents() {
  document.querySelectorAll('.react-ability-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.react-ability-option').forEach(o => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
    });
  });
  document.getElementById('btn-react-yes')?.addEventListener('click', handleReactYes);
  document.getElementById('btn-react-no')?.addEventListener('click', handleReactNo);
}
