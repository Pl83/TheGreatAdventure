/* ═══════════════════════════════════════════════════════════════════════════
   js/combat.js — Entry point
   ═══════════════════════════════════════════════════════════════════════════ */

import { loadChars } from './combat-logic.js';
import { render } from './combat-render.js';
import { loadAiTeam } from './combat-ai-driver.js';

(async () => {
  await loadChars();
  loadAiTeam();
  render();
})();
