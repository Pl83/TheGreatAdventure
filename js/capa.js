function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function parseResourceT(x) {
  const m = /([0-9]+)/.exec(x || '');
  return m ? Number(m[1]) : null;
}

function renderTags(arr) {
  return (arr && arr.length) ? arr.map(v => `<span class="tag">${v}</span>`).join('') : '<em>—</em>';
}

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('tbody');
  const q = document.getElementById('q');
  const typeFilter = document.getElementById('typeFilter');
  const weaponFilter = document.getElementById('weaponFilter');
  const elementFilter = document.getElementById('elementFilter');
  const targetFilter = document.getElementById('targetFilter');
  const categoryFilter = document.getElementById('categoryFilter');
  const resourceFilter = document.getElementById('resourceFilter');
  const resetBtn = document.getElementById('resetBtn');

  // Build filter options from data
  function setOptions(select, list) {
    const opts = uniqueSorted(list).map(v => `<option value="${v}">${v}</option>`).join('');
    select.insertAdjacentHTML('beforeend', opts);
  }

  setOptions(typeFilter, capacitis.map(c => c.type));
  setOptions(weaponFilter, capacitis.map(c => c.weapon));
  setOptions(elementFilter, capacitis.flatMap(c => c.element || []));
  setOptions(targetFilter, capacitis.flatMap(c => c.target || []));
  setOptions(categoryFilter, capacitis.flatMap(c => c.cat || []));

  function matchesSelect(value, selected) {
    return selected === 'all' || (Array.isArray(value) ? value.includes(selected) : value === selected);
  }

  function applyFilters() {
    const text = (q.value || '').trim().toLowerCase();
    const type = typeFilter.value;
    const weapon = weaponFilter.value;
    const element = elementFilter.value;
    const target = targetFilter.value;
    const cat = categoryFilter.value;

    const results = capacitis.filter(c => {
      // Ajout de c.dice dans la chaîne de recherche textuelle
      const hay = `${c.type} ${c.name} ${c.element} ${c.weapon} ${c.target} ${c.desc} ${c.cat} ${c.style} ${c.dice || ''}`.toLowerCase();
      const textOk = text ? hay.includes(text) : true;
      const typeOk = matchesSelect(c.type, type);
      const weaponOk = matchesSelect(c.weapon, weapon);
      const elementOk = matchesSelect(c.element, element);
      const targetOk = matchesSelect(c.target, target);
      const catOk = matchesSelect(c.cat, cat);
      return textOk && typeOk && weaponOk && elementOk && targetOk && catOk;
    });

    renderRows(results);
  }

  function renderRows(list) {
    tbody.innerHTML = '';
    for (const c of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.type}</td>
        <td><strong>${c.name}</strong></td>
        <td>${renderTags(c.element)}</td>
        <td>${c.weapon}</td>
        <td>${renderTags(c.target)}</td>
        <td>${c.desc}</td>
        <td>${renderTags(c.cat)}</td>
        <td>${c.resource || '<em>—</em>'}</td>
        <td>${c.style || '<em>—</em>'}</td>
        <td><code style="color: var(--highlight); font-weight: bold;">${c.dice || '<em>—</em>'}</code></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function resetFilters() {
    q.value = '';
    for (const sel of [typeFilter, weaponFilter, elementFilter, targetFilter, categoryFilter]) {
      sel.value = sel.querySelector('option').value; 
    }
    applyFilters();
  }

  applyFilters();

  q.addEventListener('input', applyFilters);
  for (const sel of [typeFilter, weaponFilter, elementFilter, targetFilter, categoryFilter]) {
    sel.addEventListener('change', applyFilters);
  }
  resetBtn.addEventListener('click', resetFilters);
});