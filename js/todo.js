// Dev todo dashboard, reachable at /todo.html (not linked from the nav). Progress lives in localStorage.
const DONE_KEY   = 'tgaTodoDone';

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  data: null,
  done: new Set(store.get(DONE_KEY, [])),
  cat: 'all',
  hideDone: false,
};

const root = document.getElementById('todo-root');

const pct = (n, total) => total ? Math.round(n / total * 100) : 0;

function stats(items) {
  const done = items.filter(i => state.done.has(i.id)).length;
  return { done, open: items.length - done, total: items.length, pct: pct(done, items.length) };
}

function render() {
  const { categories, items } = state.data;
  const all = stats(items);

  const tiles = categories.map(c => {
    const s = stats(items.filter(i => i.cat === c.id));
    return `
      <button class="todo-tile ${state.cat === c.id ? 'is-active' : ''}" data-cat="${c.id}">
        <span class="todo-tile-icon">${c.icon}</span>
        <span class="todo-tile-count">${s.open}<small> open</small></span>
        <span class="todo-tile-label">${esc(c.label)}</span>
        <span class="todo-bar"><span style="width:${s.pct}%"></span></span>
        <span class="todo-tile-sub">${s.done} / ${s.total} done</span>
      </button>`;
  }).join('');

  const visibleCats = categories.filter(c => state.cat === 'all' || state.cat === c.id);
  const sections = visibleCats.map(c => {
    const rows = items
      .filter(i => i.cat === c.id && !(state.hideDone && state.done.has(i.id)))
      .map(rowHTML).join('');
    return `
      <section class="todo-section">
        <h3>${c.icon} ${esc(c.label)} <span class="todo-hint">${esc(c.hint)}</span></h3>
        ${rows || '<p class="todo-empty">Nothing here. Well done, Master.</p>'}
      </section>`;
  }).join('');

  root.innerHTML = `
    <div class="todo-overview">
      <div class="todo-total">
        <strong>${all.pct}%</strong>
        <span>${all.done} of ${all.total} items resolved</span>
        <span class="todo-bar todo-bar-lg"><span style="width:${all.pct}%"></span></span>
      </div>
      <div class="todo-tiles">${tiles}</div>
    </div>
    <div class="todo-toolbar">
      <button class="todo-chip ${state.cat === 'all' ? 'is-active' : ''}" data-cat="all">All</button>
      <label class="todo-check"><input type="checkbox" id="todo-hide-done" ${state.hideDone ? 'checked' : ''}> Hide done</label>
      <button class="todo-chip todo-reset" id="todo-reset">Reset progress</button>
    </div>
    ${sections}`;
}

function rowHTML(i) {
  const done = state.done.has(i.id);
  return `
    <article class="todo-item ${done ? 'is-done' : ''}" data-sev="${esc(i.sev)}">
      <label class="todo-item-head">
        <input type="checkbox" data-id="${esc(i.id)}" ${done ? 'checked' : ''}>
        <span class="todo-item-title">${esc(i.title)}</span>
        ${i.who ? `<span class="todo-who">${esc(i.who)}</span>` : ''}
        <span class="todo-sev todo-sev-${esc(i.sev)}">${esc(i.sev)}</span>
      </label>
      <p class="todo-detail">${esc(i.detail)}</p>
      ${i.evidence ? `<p class="todo-meta"><b>Evidence</b> ${esc(i.evidence)}</p>` : ''}
      ${i.where ? `<p class="todo-meta"><b>Where</b> <code>${esc(i.where)}</code></p>` : ''}
    </article>`;
}

root.addEventListener('click', e => {
  const catBtn = e.target.closest('[data-cat]');
  if (catBtn) {
    state.cat = state.cat === catBtn.dataset.cat ? 'all' : catBtn.dataset.cat;
    render();
    return;
  }
  if (e.target.id === 'todo-reset' && confirm('Clear all todo progress?')) {
    state.done.clear();
    store.set(DONE_KEY, []);
    render();
  }
});

root.addEventListener('change', e => {
  if (e.target.id === 'todo-hide-done') {
    state.hideDone = e.target.checked;
    render();
    return;
  }
  const id = e.target.dataset?.id;
  if (!id) return;
  if (e.target.checked) state.done.add(id); else state.done.delete(id);
  store.set(DONE_KEY, [...state.done]);
  render();
});

try {
  state.data = await (await fetch('js/todo.json')).json();
  render();
} catch {
  root.innerHTML = '<p class="todo-empty">Could not load js/todo.json.</p>';
}
