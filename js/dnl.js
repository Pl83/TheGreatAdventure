import { EFFECTS, titles, weights } from './main.js';

const tbody = document.getElementById('tbody');
const searchInput = document.getElementById('q');
const damageFilter = document.getElementById('damageFilter');

function hasDamage(effect) {
    return effect.dice && effect.dice !== '—';
}

function renderRows(list) {
    tbody.innerHTML = '';
    for (const eff of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${eff.name}</strong></td>
            <td>${eff.dice || '—'}</td>
            <td>${eff.type || '—'}</td>
            <td>${eff.notes ? eff.notes : '<em>—</em>'}</td>
        `;
        tbody.appendChild(tr);
    }
}

function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    const damageMode = damageFilter.value;

    const results = EFFECTS.filter(eff => {
        const text = `${eff.name} ${eff.dice} ${eff.type} ${eff.notes}`.toLowerCase();
        const matchesText = q ? text.includes(q) : true;
        const matchesDamage = damageMode === 'all' ? true
            : damageMode === 'has' ? hasDamage(eff) : !hasDamage(eff);
        return matchesText && matchesDamage;
    });

    renderRows(results);
}

renderRows(EFFECTS);
searchInput.addEventListener('input', applyFilters);
damageFilter.addEventListener('change', applyFilters);

function rollOne(exclude = []) {
    const pool = [];
    for (const [name, data] of Object.entries(titles)) {
        if (exclude.includes(name)) continue;
        const weight = weights[data.rarity] ?? 1;
        for (let i = 0; i < weight; i++) {
            pool.push({ name, effect: data.effect, rarity: data.rarity });
        }
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

function rollGacha() {
    const rarePool = Object.entries(titles)
        .filter(([, data]) => data.rarity >= 3)
        .map(([name, data]) => ({ name, effect: data.effect, rarity: data.rarity }));

    const results = [rarePool[Math.floor(Math.random() * rarePool.length)]];
    while (results.length < 5) {
        results.push(rollOne(results.map(r => r.name)));
    }

    const container = document.getElementById('results');
    container.innerHTML = '';

    const rarityNames = ['', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

    results.forEach((r, index) => {
        const rarityClass = rarityNames[r.rarity];
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-inner" id="card-${index}">
                <div class="card-front">?</div>
                <div class="card-back ${rarityClass}">
                    <strong>${r.name}</strong><br><small>${r.effect}</small>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    results.forEach((r, i) => {
        setTimeout(() => {
            const cardEl = document.getElementById(`card-${i}`);
            cardEl.classList.add('flipped');
            cardEl.querySelector('.card-back').classList.add(`glow-${rarityNames[r.rarity]}`);
        }, i * 800);
    });
}

document.getElementById('gachaBtn').addEventListener('click', rollGacha);
