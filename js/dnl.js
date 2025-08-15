document.addEventListener('DOMContentLoaded', () => {
  
});

const tbody = document.getElementById('tbody');
const count = document.getElementById('count');
const searchInput = document.getElementById('q');
const damageFilter = document.getElementById('damageFilter');

function hasDamage(effect) {
  return effect.dice && effect.dice !== '—';
}

function renderRows(list) {
  tbody.innerHTML = '';
  for (const eff of list) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.innerHTML = `<strong>${eff.name}</strong>`;

    const tdDice = document.createElement('td');
    tdDice.textContent = eff.dice || '—';

    const tdType = document.createElement('td');
    tdType.textContent = eff.type || '—';

    const tdNotes = document.createElement('td');
    tdNotes.innerHTML = eff.notes ? eff.notes : '<em>—</em>';

    tr.append(tdName, tdDice, tdType, tdNotes);
    tbody.appendChild(tr);
  }
  //count.textContent = `${list.length} ${list.length === 1 ? 'effect' : 'effects'}`;
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const damageMode = damageFilter.value; // all | has | none

  let results = EFFECTS.filter(eff => {
    const text = `${eff.name} ${eff.dice} ${eff.type} ${eff.notes}`.toLowerCase();
    const matchesText = q ? text.includes(q) : true;
    const matchesDamage = damageMode === 'all'
      ? true
      : damageMode === 'has' ? hasDamage(eff) : !hasDamage(eff);
    return matchesText && matchesDamage;
  });

  renderRows(results);
}

// Initialize
renderRows(EFFECTS);

// Events
searchInput.addEventListener('input', applyFilters);
damageFilter.addEventListener('change', applyFilters);


function rollOne(exclude = []) {
  const pool = [];
  for (const [name, data] of Object.entries(titles)) {
    if (exclude.includes(name)) continue;
    const weight = weights[data.rarity] || 1;
    for (let i = 0; i < weight; i++) {
      pool.push({ name, effect: data.effect, rarity: data.rarity });
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function rollGacha() {
  let results = [];
  
  // Guarantee at least one Rare+ (rarity 3+)
  const rarePool = Object.entries(titles)
    .filter(([_, data]) => data.rarity >= 3)
    .map(([name, data]) => ({ name, effect: data.effect, rarity: data.rarity }));
  results.push(rarePool[Math.floor(Math.random() * rarePool.length)]);
  
  // Fill the rest without duplicates
  while (results.length < 5) {
    const pick = rollOne(results.map(r => r.name));
    results.push(pick);
  }
  
  const container = document.getElementById('results');
  container.innerHTML = '';
  results.forEach((r, index) => {
    const rarityClass = r.rarity === 1 ? 'common' :
                        r.rarity === 2 ? 'uncommon' :
                        r.rarity === 3 ? 'rare' : 
                        r.rarity === 4 ? 'epic' : 'legendary' ;

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
  
  // Flip and glow cards one by one
  results.forEach((r, i) => {
    setTimeout(() => {
      const cardEl = document.getElementById(`card-${i}`);
      cardEl.classList.add('flipped');
      const rarityGlow = r.rarity === 1 ? 'glow-common' :
                         r.rarity === 2 ? 'glow-uncommon' :
                         r.rarity === 3 ? 'glow-rare' : 
                         r.rarity === 4 ? 'glow-epic' : 'glow-legendary' ;
      cardEl.querySelector('.card-back').classList.add(rarityGlow);
    }, i * 800);
  });
}