/* ═══════════════════════════════════════════════════════════════════════════
   js/combat.js — Entry point
   ═══════════════════════════════════════════════════════════════════════════ */

import { loadChars } from './combat-logic.js';
import { render } from './combat-render.js';

(async () => {
  await loadChars();
  render();
})();
