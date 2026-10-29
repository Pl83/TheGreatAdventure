/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-ai-driver.js — Plays one team of the live combat page with the bot
   S.aiTeam is the team the bot plays (0 or 1), or null for two human players.
   The render code calls scheduleAI() after each screen; the bot answers a short pause later.
   ═══════════════════════════════════════════════════════════════════════════ */

import { S, activeCombatant, getCombatant, isHeadless, handlePass, handleReactNo } from './combat-logic.js';
import { createBrain } from './ai/brain.js';
import { applyPlan, settleReacts } from './ai/apply.js';
import { decidingTeam } from './ai/search.js';

// The search blocks the page for its whole budget, so it stays short (the engine's hard cap is 8 s)
export const AI_BUDGET = { ms: 2000 };
const THINK_DELAY_MS = 700;   // lets the previous move be seen before the bot answers

let brain = null;
let timer = null;
let busy  = false;

// For tests: swap in a brain with a fixed seed and a simulation-count budget
export function setAiBrain(b) { brain = b; }

const getBrain = () => (brain ??= createBrain({
  budget: AI_BUDGET,
  onError: (err, where) => console.warn(`[bot] ${where} failed, played the greedy fallback`, err),
}));

export function setAiTeam(team) {
  S.aiTeam = team === 0 || team === 1 ? team : null;
  try {
    if (S.aiTeam === null) localStorage.removeItem('combatAiTeam');
    else localStorage.setItem('combatAiTeam', String(S.aiTeam));
  } catch {}
}

export function loadAiTeam() {
  try {
    const v = localStorage.getItem('combatAiTeam');
    S.aiTeam = v === '0' ? 0 : v === '1' ? 1 : null;
  } catch { S.aiTeam = null; }
}

/** Who has to decide now: 'react' (a prompt for a bot unit), 'turn' (a bot unit is up), or null. */
export function pendingAiDecision() {
  if (S.aiTeam === null || S.aiTeam === undefined || S.phase !== 'combat' || S.teleportMode) return null;
  if (S.awaitingReact) {
    const reactor = getCombatant(S.reactOptions[0]?.combatantId);
    return reactor && reactor.teamIndex === S.aiTeam ? 'react' : null;
  }
  const c = activeCombatant();
  return c && decidingTeam(c) === S.aiTeam ? 'turn' : null;
}

/** True when the bot, not the person at the screen, decides for this unit. */
export const controlledByAi = c => S.aiTeam !== null && S.aiTeam !== undefined && decidingTeam(c) === S.aiTeam;

export function aiStatusHTML() {
  const kind = pendingAiDecision();
  if (!kind) return '';
  const what = kind === 'react' ? 'is choosing a reaction' : 'is thinking';
  return `<p class="ai-status" role="status">Bot (Team ${S.aiTeam === 0 ? 'I' : 'II'}) ${what}…</p>`;
}

/** Makes the bot's pending decision, once. Returns false when there was nothing for it to decide. */
export function stepAI() {
  const kind = pendingAiDecision();
  if (!kind) return false;
  const b = getBrain();
  try {
    if (kind === 'react') {
      settleReacts(() => b.chooseReact());
    } else {
      const result = applyPlan(b.chooseTurn(S.aiTeam));
      if (!result.accepted) applyPlan({ move: null, action: { type: 'pass' } });
    }
  } catch (err) {
    // Never leave the fight waiting on a bot that crashed
    console.error('[bot] decision failed', err);
    if (S.awaitingReact) handleReactNo();
    else if (pendingAiDecision() === 'turn') handlePass();
  }
  return true;
}

/** Called by the render code after each screen: queues the bot's move if it is the bot's turn. */
export function scheduleAI() {
  if (isHeadless() || busy || timer || !pendingAiDecision()) return;
  timer = setTimeout(() => {
    timer = null;
    if (!pendingAiDecision()) return;
    busy = true;
    try { stepAI(); } finally { busy = false; }
    scheduleAI();   // the renders inside stepAI ran while busy, so queue the next move here
  }, THINK_DELAY_MS);
}
