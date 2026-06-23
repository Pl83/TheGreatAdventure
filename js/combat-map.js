/* ═══════════════════════════════════════════════════════════════════════════
   js/combat-map.js — Canvas rendering of the battle map (overlays + tokens)
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  _R, S, SPELL_RANGE,
  activeCombatant, getCombatant, livingCombatants,
  isOccupied, chebyshev, computeAimOverlay, coneCells, aoeCombatantHits,
} from './combat-logic.js';
import { cellPxOf, isWalkableG } from './dungeon-loader.js';

// Safe document handle — null in headless contexts (tests/simulation).
const _doc = typeof document !== 'undefined' ? document : null;

export function drawMap() {
  const canvas = _doc?.getElementById('dungeon-canvas');
  if (!canvas || !S.currentMap) return;
  const { image } = S.currentMap;
  canvas.width  = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const ctx    = canvas.getContext('2d');
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  const cp     = cellPxOf(S.currentMap);
  const active = activeCombatant();
  ctx.drawImage(image, 0, 0);
  if (S.moveMode && S.reachableCells.size > 0) {
    ctx.fillStyle = 'rgba(74,144,217,0.35)';
    for (const [key] of S.reachableCells) {
      const [gx, gy] = key.split(',').map(Number);
      if (!isOccupied(gx, gy, active?.id ?? -1))
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
    }
    if (active) {
      ctx.strokeStyle = 'rgba(74,144,217,0.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(active.x * cp + 1, active.y * cp + 1, cp - 2, cp - 2);
    }
  }
  if (S.aimMode && S.aimAbility && active) {
    if (S.aimAbility.isAoe) {
      const range   = S.aimAbility.range ?? SPELL_RANGE;
      const radius  = S.aimAbility.radius > 0 ? S.aimAbility.radius : 1;
      const { cols, rows } = S.currentMap.grid;
      ctx.fillStyle = 'rgba(255,140,0,0.12)';
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (!isWalkableG(S.currentMap, gx, gy)) continue;
          if (chebyshev(active, { x: gx, y: gy }) <= range)
            ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
      if (S.aimHover && chebyshev(active, S.aimHover) <= range) {
        const { x: hx, y: hy } = S.aimHover;
        ctx.fillStyle = 'rgba(255,100,0,0.38)';
        for (let gy = 0; gy < rows; gy++) {
          for (let gx = 0; gx < cols; gx++) {
            if (chebyshev({ x: hx, y: hy }, { x: gx, y: gy }) <= radius)
              ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
          }
        }
        ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
        for (const t of aoeCombatantHits(S.aimAbility, active, hx, hy)) {
          ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
        }
      }
    } else if (S.aimAbility.isCone) {
      const dirCell  = S.aimHover ?? null;
      const cells    = dirCell ? coneCells(active, S.aimAbility, dirCell) : [];
      // Reuse cells instead of calling coneCellTargets (avoids a second full grid sweep)
      const cellSet  = new Set(cells.map(cell => `${cell.x},${cell.y}`));
      const hits     = livingCombatants(active.teamIndex === 0 ? 1 : 0)
        .filter(t => cellSet.has(`${t.x},${t.y}`));
      const { losCells } = computeAimOverlay(active, S.aimAbility);
      ctx.fillStyle = 'rgba(255,140,0,0.10)';
      for (const [key] of (losCells.entries?.() ?? [])) {
        const [gx, gy] = key.split(',').map(Number);
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.fillStyle = 'rgba(255,140,0,0.35)';
      for (const { x: gx, y: gy } of cells) {
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
      for (const t of hits) {
        ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
      }
    } else {
      const { inRangeCells, losCells, validTargetIds } = computeAimOverlay(active, S.aimAbility);
      ctx.fillStyle = 'rgba(80,80,80,0.45)';
      for (const key of inRangeCells) {
        if (!losCells.has(key)) {
          const [gx, gy] = key.split(',').map(Number);
          ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
        }
      }
      ctx.fillStyle = 'rgba(255,140,0,0.22)';
      for (const key of losCells) {
        const [gx, gy] = key.split(',').map(Number);
        ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
      }
      ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 2;
      for (const t of validTargetIds.values()) {
        ctx.strokeRect(t.x * cp + 1, t.y * cp + 1, cp - 2, cp - 2);
      }
      if (S.aimHover) {
        const { x: hx, y: hy } = S.aimHover;
        if (losCells.has(`${hx},${hy}`)) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(hx * cp + 1, hy * cp + 1, cp - 2, cp - 2);
        }
      }
    }
  }
  if (S.teleportMode) {
    const actor = getCombatant(S.teleportActorId);
    if (actor) {
      const { cols, rows } = S.currentMap.grid;
      ctx.fillStyle = 'rgba(168,85,247,0.25)';
      for (let gy = 0; gy < rows; gy++)
        for (let gx = 0; gx < cols; gx++)
          if (isWalkableG(S.currentMap, gx, gy) && chebyshev(actor, { x: gx, y: gy }) <= S.teleportRange)
            ctx.fillRect(gx * cp + 1, gy * cp + 1, cp - 2, cp - 2);
    }
  }
  const TEAM_COL = ['#4A90D9', '#D94A4A'];
  const filter   = S.mapViewFilter;
  const showTeam = (ti) => filter === 'both' || (filter === 'team0' ? ti === 0 : ti === 1);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3;
  for (const c of S.combatants) {
    if (c.isKO || !showTeam(c.teamIndex)) continue;
    const cx = c.x * cp + cp / 2, cy = c.y * cp + cp / 2;
    const isAct = active?.id === c.id;
    const radius = cp * (isAct ? 0.42 : 0.34);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = c.isTransformed ? '#a855f7' : TEAM_COL[c.teamIndex];
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isAct ? '#E4B14A' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = isAct ? 2.5 : 1;
    ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(cp * 0.4)}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(c.name[0].toUpperCase(), cx, cy);
  }
  ctx.shadowBlur = 0;
}

// Register on the render seam so combat-logic can trigger a redraw without
// importing this module (mirrors how combat-render.js registers _R callbacks).
_R.drawMap = drawMap;
