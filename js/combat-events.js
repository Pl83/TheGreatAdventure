/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-events.js — Event binding for all combat screens
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  S,
  activeCombatant, livingCombatants, enemies, targetPool,
  hasValidTarget, drawMap,
  handlePass, handleAttack, handleCastAbility,
  handleTransform, handleActivateDomain,
  handleReactYes, handleReactNo, handleFreeAction,
  enterMoveMode, exitMoveMode,
  enterAimMode, exitAimMode, cancelAim, koAllies,
  addLog, goToMapChoice,
} from './combat-logic.js';

import { setAiTeam } from './combat-ai-driver.js';
import { abilityPreviewHTML, abilityFireLabel, pickAbility, renderCombatScreen, renderSelectionScreen } from './combat-render.js';

// ── §13  Event Binding ─────────────────────────────────────────────────────

function saveTeams() {
  try { localStorage.setItem('combatTeams', JSON.stringify(S.teamNames)); } catch {}
}

// Esc leaves aim mode from anywhere (bound once; right-click does the same on the canvas)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.phase === 'combat' && S.aimMode) cancelAim();
});

export function bindSelectionEvents() {
  const root = document.getElementById('combat-root');
  root.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const name = e.currentTarget.dataset.name;
      const team = parseInt(e.currentTarget.dataset.team);
      if (!S.teamNames[team].includes(name) && S.teamNames[team].length < 5) {
        S.teamNames[team].push(name);
        saveTeams();
        renderSelectionScreen({ focus: { name, team }, announce: `${name} added to Team ${team === 0 ? 'I' : 'II'}.` });
      }
    });
  });
  root.querySelectorAll('.remove-btn, .chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const name = e.currentTarget.dataset.name;
      const team = parseInt(e.currentTarget.dataset.team);
      S.teamNames[team] = S.teamNames[team].filter(n => n !== name);
      saveTeams();
      renderSelectionScreen({ focus: { name, team }, announce: `${name} removed from Team ${team === 0 ? 'I' : 'II'}.` });
    });
  });
  root.querySelectorAll('input[name="ai-team"]').forEach(radio => {
    radio.addEventListener('change', e => setAiTeam(e.target.value === '' ? null : parseInt(e.target.value)));
  });
  document.getElementById('btn-start')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-start');
    if (btn) btn.disabled = true;
    await goToMapChoice();
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
    return active.abilities.find(a => a.name === document.querySelector('input[name="ability"]:checked')?.value);
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
        ? (ab.isRevive ? koAllies(active.teamIndex) : livingCombatants(active.teamIndex))
        : targetPool(active);
      nomapSel.innerHTML = pool.map(t => `<option value="${t.id}">${t.name} · ${t.currentHp} HP</option>`).join('') || '<option>No targets</option>';
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

  document.getElementById('ability-list')?.addEventListener('change', () => {
    const ab = getSelectedAbility();
    if (ab) pickAbility(active, ab.name);
    syncAbilityBtn();
  });
}

// The free-action prompt: one button per choice
export function bindFreeActionEvents() {
  for (const btn of document.querySelectorAll('#free-overlay [data-free]')) {
    btn.addEventListener('click', () => handleFreeAction({ type: btn.dataset.free, abilityName: btn.dataset.ability }));
  }
  document.querySelector('#free-overlay [data-free]:not([disabled])')?.focus();
}

export function bindReactEvents() {
  const dialog = document.querySelector('#react-overlay .react-dialog');
  if (!dialog) return;
  const yes = document.getElementById('btn-react-yes');
  dialog.querySelector('.react-ability-list')?.addEventListener('change', e => {
    if (yes) yes.textContent = `React with ${e.target.value}`;
  });
  yes?.addEventListener('click', handleReactYes);
  document.getElementById('btn-react-no')?.addEventListener('click', handleReactNo);

  // Modal: keyboard focus starts on the chosen reaction and cannot wander behind the overlay
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const stops = [dialog.querySelector('input[name="react"]:checked'), ...dialog.querySelectorAll('button')].filter(Boolean);
    const first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (!dialog.contains(document.activeElement)) dialog.querySelector('input[name="react"]:checked')?.focus();
}
