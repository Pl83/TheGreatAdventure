import { S, getCombatant } from './combat-logic.js';

// The lingering fields on the map: who raised each, how long it has left, and which side it works on
export function fieldStripHTML() {
  if (!S.fields.length) return '';
  return `<ul class="active-field-strip" aria-label="Active fields">${S.fields.map(f => {
    const owner = getCombatant(f.casterId);
    return `<li class="field-strip-entry field-${f.kind}">${f.kind === 'allies' ? '🌸' : '🌫'} ${owner?.name ?? '?'}: ${f.name} · ${f.roundsLeft} round${f.roundsLeft === 1 ? '' : 's'}</li>`;
  }).join('')}</ul>`;
}
