/* ═══════════════════════════════════════════════════════════════════════════
   js/watabou-runner.js — Runs Watabou's One Page Dungeon generator in a
   hidden same-origin iframe and captures its JSON and PNG exports.

   The generator (Dungeon.js, OpenFL) is loaded from watabou.github.io at
   play time. It "downloads" through FileSaver (URL.createObjectURL + a
   synthetic <a download> click), so the iframe page wraps both before the
   script loads and hands every saved Blob to the parent.

   1. export=json  → the app builds the dungeon and saves the JSON blob.
   2. Shift+E      → "Export as PNG" dialog (cell size defaults to 70 px).
   3. Enter        → dialog OK → image/png blob, map bounds + 1 cell margin.
   ═══════════════════════════════════════════════════════════════════════════ */

const ORIGIN = 'https://watabou.github.io/one-page-dungeon/';
const W = 900, H = 600;

/**
 * Generate one dungeon for `seed`.
 * Resolves { json, png } (parsed JSON object, image/png Blob).
 * Rejects on abort or any failure. The iframe is always removed.
 */
export async function runWatabou(seed, signal) {
  signal?.throwIfAborted();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off-screen but laid out: the OpenFL canvas needs real dimensions.
  frame.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${W}px;height:${H}px;border:0;visibility:hidden;pointer-events:none`;

  const blobs = new BlobQueue();
  frame.__watabouSave = blob => blobs.push(blob);
  frame.srcdoc = framePage(String(seed));

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  document.body.appendChild(frame);
  const work = generate(frame, blobs);
  work.catch(() => {}); // may still settle after an abort won the race
  try {
    return await Promise.race([aborted, work]);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    frame.__watabouSave = null;
    frame.remove();
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

const CELL_PX = 70; // ExportForm default; the loader's maps use the same size

async function generate(frame, blobs) {
  const json = JSON.parse(await (await blobs.next('application/json')).text());

  // Shift+E opens "Export as PNG"; Enter on the open form means OK.
  const win = frame.contentWindow;
  key(win, 'keydown', 16, { shiftKey: true });
  key(win, 'keydown', 69, { shiftKey: true });
  key(win, 'keyup',   69, { shiftKey: true });
  key(win, 'keyup',   16);
  await nextFrame(win);
  key(win, 'keydown', 13);
  key(win, 'keyup',   13);
  // Copy the bytes into a Blob of our own realm while the frame is alive:
  // reading a frame-created Blob after the iframe is removed never settles.
  const bytes = await (await blobs.next('image/png')).arrayBuffer();

  // The form caps the cell size for very large maps; only 70 px is accepted.
  const { width, height } = pngSize(bytes);
  if (width % CELL_PX || height % CELL_PX) {
    throw new Error(`PNG ${width}x${height} is not a ${CELL_PX} px cell export`);
  }
  return { json, png: new Blob([bytes], { type: 'image/png' }) };
}

/** Width and height from the PNG IHDR chunk (bytes 16–23), without decoding. */
function pngSize(bytes) {
  const v = new DataView(bytes);
  if (v.byteLength < 24 || v.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** srcdoc page: hooks first, then Dungeon.js, then embed. */
function framePage(seed) {
  // The app reads its parameters from `new URLSearchParams(location.search)`,
  // and an about:srcdoc page cannot carry a query string, so that one call
  // is answered with ours.
  const query = JSON.stringify(new URLSearchParams({ seed, export: 'json' }).toString());
  return `<!doctype html><html><head><meta charset="utf-8">
<base href="${ORIGIN}">
<script>
URLSearchParams = (P => class extends P { constructor(s) { super(s === location.search ? ${query} : s); } })(URLSearchParams);
URL.createObjectURL = (c => b => { frameElement && frameElement.__watabouSave && frameElement.__watabouSave(b); return c(b); })(URL.createObjectURL.bind(URL));
HTMLAnchorElement.prototype.click = function () {};
history.replaceState = history.pushState = function () {};
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = function () {};
addEventListener('error', e => frameElement && frameElement.__watabouSave && frameElement.__watabouSave(new Error(e.message)));
<\/script>
<script src="Dungeon.js" crossorigin="anonymous" onerror="frameElement.__watabouSave(new Error('Dungeon.js failed to load'))"><\/script>
</head><body style="margin:0">
<div id="openfl-content" style="width:${W}px;height:${H}px"></div>
<script>lime.embed("Dungeon", "openfl-content", ${W}, ${H});<\/script>
</body></html>`;
}

/** Collects saved blobs; next(type) waits for the first blob of that type. Errors reject. */
class BlobQueue {
  constructor() { this.items = []; this.waiter = null; }
  push(item) { this.items.push(item); this.flush(); }
  next(type) {
    return new Promise((resolve, reject) => { this.waiter = { type, resolve, reject }; this.flush(); });
  }
  flush() {
    const w = this.waiter;
    if (!w) return;
    const err = this.items.find(i => i instanceof Error);
    if (err) { this.waiter = null; w.reject(err); return; }
    const i = this.items.findIndex(b => b.type === w.type);
    if (i < 0) return;
    this.waiter = null;
    w.resolve(this.items.splice(i, 1)[0]);
  }
}

/** Dispatch a keyboard event on the frame window with keyCode/which set (lime reads them). */
function key(win, type, code, init = {}) {
  const ev = new win.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, 'keyCode', { get: () => code });
  Object.defineProperty(ev, 'which',   { get: () => code });
  win.dispatchEvent(ev);
}

function nextFrame(win) {
  return new Promise(r => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
}
