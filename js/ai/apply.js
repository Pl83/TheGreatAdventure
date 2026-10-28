// Plays a turn plan or a react choice through the real UI handlers, exactly as clicks would.
//   TurnPlan    = { move: {x,y} | null, action: { type: 'pass' } | { type: 'attack', targetId }
//                 | { type: 'cast', ability, targetIds, dest? } | { type: 'domain' } | { type: 'transform' } }
//   ReactChoice = { combatantId, abilityName, dest? } | null
import {
  S, getCombatant, activeCombatant, chebyshev,
  enterMoveMode, exitMoveMode, handleMoveClick, handleTeleportClick, exitTeleportMode,
  handlePass, handleAttack, handleCastAbility, handleActivateDomain, handleTransform,
  handleReactYes, handleReactNo, resumePendingAction, isHeadless, _R,
} from '../combat-logic.js';

// Places the pending teleport at dest, else on the legal cell nearest to it (the actor's own cell at worst),
// so a fight is never left waiting in teleport mode
function completeTeleport(dest) {
  if (!S.teleportMode) return;
  if (dest && handleTeleportClick(dest.x, dest.y)) return;
  const actor = getCombatant(S.teleportActorId);
  if (actor) {
    const goal  = dest ?? actor;
    const range = S.teleportRange;
    const cells = [];
    for (let x = actor.x - range; x <= actor.x + range; x++) {
      for (let y = actor.y - range; y <= actor.y + range; y++) cells.push({ x, y });
    }
    cells.sort((a, b) => chebyshev(a, goal) - chebyshev(b, goal));
    for (const cell of cells) if (handleTeleportClick(cell.x, cell.y)) return;
  }
  // No legal cell at all: drop the teleport (a react then resolves as declined)
  const reactAbility = S.pendingTeleportReact;
  S.pendingTeleportReact = null;
  exitTeleportMode();
  if (reactAbility) resumePendingAction(null); else if (!isHeadless()) _R.renderCombatScreen();
}

function doMove(to) {
  if (S.hasMoved) return 'already moved';
  enterMoveMode();
  if (!S.moveMode) return 'cannot move';
  handleMoveClick(to.x, to.y);
  if (S.hasMoved) return null;
  exitMoveMode();
  return `move to (${to.x}, ${to.y}) rejected`;
}

export function applyPlan(plan) {
  const c = activeCombatant();
  if (!c || S.phase !== 'combat') return { accepted: false, reason: 'no fight in progress' };
  if (S.awaitingReact || S.teleportMode) return { accepted: false, reason: 'react pending' };
  const reasons = [];
  if (plan.move) {
    const moveFail = doMove(plan.move);
    if (moveFail) reasons.push(moveFail);
  }

  const serial = S.turnSerial, acted = S.hasActed, logLen = S.log.length;
  const a = plan.action;
  switch (a?.type) {
    case 'pass':      handlePass(); break;
    case 'attack':    handleAttack(c.id, a.targetId); break;
    case 'cast':
      handleCastAbility(c.id, a.ability, a.targetIds ?? []);
      if (S.teleportMode && !S.pendingTeleportReact) completeTeleport(a.dest);
      break;
    case 'domain':    handleActivateDomain(c.id); break;
    case 'transform': handleTransform(c.id); break;
    default:          reasons.push(`unknown action ${a?.type}`);
  }

  // An instant cast keeps the turn open and leaves hasActed alone: its "uses" log line (written only once
  // every check has passed and the cost is paid) is the proof it happened
  const cast = a?.type === 'cast' && S.log.slice(logLen).some(e => e.text === `${c.name} uses ${a.ability}!`);
  const accepted = S.turnSerial !== serial || (!acted && S.hasActed) || cast
    || S.awaitingReact || !!S.pendingAction || S.phase !== 'combat';
  // The engine explains its refusals in the log
  if (!accepted) reasons.push(S.log.slice(logLen).at(-1)?.text ?? `${a?.type} rejected`);
  return reasons.length ? { accepted, reason: reasons.join('; ') } : { accepted };
}

export function settleReacts(choose) {
  let played = 0;
  while (S.awaitingReact) {
    const choice = choose();
    const option = choice && S.reactOptions.find(o => o.combatantId === choice.combatantId && o.ability.name === choice.abilityName);
    if (!option) { handleReactNo(); continue; }
    // Headless handleReactYes takes the first option, so leave only the chosen one
    S.reactOptions = [option];
    handleReactYes();
    played++;
    if (S.teleportMode && S.pendingTeleportReact) completeTeleport(choice.dest);
  }
  return played;
}
