import { capacitis } from './main.js';

function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function renderTags(arr) {
    return arr?.length ? arr.map(v => `<span class="tag">${v}</span>`).join('') : '<em>—</em>';
}

const tbody = document.getElementById('tbody');
const q = document.getElementById('q');
const typeFilter = document.getElementById('typeFilter');
const weaponFilter = document.getElementById('weaponFilter');
const elementFilter = document.getElementById('elementFilter');
const targetFilter = document.getElementById('targetFilter');
const categoryFilter = document.getElementById('categoryFilter');
const resetBtn = document.getElementById('resetBtn');
const filters = [typeFilter, weaponFilter, elementFilter, targetFilter, categoryFilter];

function setOptions(select, list) {
    uniqueSorted(list).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
}

setOptions(typeFilter, capacitis.map(c => c.type));
setOptions(weaponFilter, capacitis.map(c => c.weapon));
setOptions(elementFilter, capacitis.flatMap(c => c.element ?? []));
setOptions(targetFilter, capacitis.flatMap(c => c.target ?? []));
setOptions(categoryFilter, capacitis.flatMap(c => c.cat ?? []));

function matchesSelect(value, selected) {
    return selected === 'all' || (Array.isArray(value) ? value.includes(selected) : value === selected);
}

function applyFilters() {
    const text = q.value.trim().toLowerCase();
    const type = typeFilter.value;
    const weapon = weaponFilter.value;
    const element = elementFilter.value;
    const target = targetFilter.value;
    const cat = categoryFilter.value;

    const results = capacitis.filter(c => {
        const hay = `${c.type} ${c.name} ${c.element} ${c.weapon} ${c.target} ${c.desc} ${c.cat} ${c.style} ${c.dice ?? ''}`.toLowerCase();
        return (text ? hay.includes(text) : true)
            && matchesSelect(c.type, type)
            && matchesSelect(c.weapon, weapon)
            && matchesSelect(c.element, element)
            && matchesSelect(c.target, target)
            && matchesSelect(c.cat, cat);
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
            <td>${c.resource ?? '<em>—</em>'}</td>
            <td>${c.style ?? '<em>—</em>'}</td>
            <td><code class="dice-roll">${c.dice ?? '<em>—</em>'}</code></td>
        `;
        tbody.appendChild(tr);
    }
}

function resetFilters() {
    q.value = '';
    filters.forEach(sel => { sel.value = sel.options[0].value; });
    applyFilters();
}

applyFilters();
q.addEventListener('input', applyFilters);
filters.forEach(sel => sel.addEventListener('change', applyFilters));
resetBtn.addEventListener('click', resetFilters);
