const sheetContainer = document.getElementById('sheet');
const searchInput = document.getElementById('charSearch');

const CATEGORY_LABEL = {
    spell: 'Sort',
    technique: 'Technique',
    technoSpell: 'Techno-Sort',
    transformation: 'Transformation',
    Art: 'Art',
    relic: 'Relique',
};

const TAG_COLOR = {
    fire: '#e84a2f',
    ice: '#5bc8f5',
    lightning: '#f5c518',
    magic: '#a078e8',
    physical: '#b0b0b0',
    heal: '#4caf7d',
    regen: '#4caf7d',
    block: '#5b8dd9',
    react: '#5b8dd9',
    buff: '#78b87a',
    debuff: '#c9504a',
    necro: '#8a2be2',
    water: '#3a9ad9',
    earth: '#8b6914',
    runik: '#d4a017',
    adv: '#66bb6a',
    disv: '#ef5350',
    poison: '#76b041',
    toxic: '#76b041',
    stun: '#ef9a9a',
    para: '#ef9a9a',
    freeze: '#80deea',
    undodgeable: '#ff7043',
    unblockabled: '#ff7043',
    antiMagic: '#9e9e9e',
    oni: '#7b1fa2',
    dash: '#29b6f6',
    instant: '#ffa726',
    cleans: '#80cbc4',
    fear: '#ab47bc',
    bleed: '#e53935',
    root: '#795548',
    taunt: '#ff8f00',
    psy: '#ce93d8',
    organic: '#aed581',
    burn: '#ff7043',
    crit: '#fdd835',
    dodge: '#29b6f6',
    controled: '#f48fb1',
    wet: '#29b6f6',
};

// ── Combat team bridge ─────────────────────────────────────────────────────

function getStoredTeams() {
    try { return JSON.parse(localStorage.getItem('combatTeams') ?? '[[],[]]'); }
    catch { return [[], []]; }
}

function saveTeams(teams) {
    localStorage.setItem('combatTeams', JSON.stringify(teams));
}

// ── Filters ────────────────────────────────────────────────────────────────

// the chips shown by default: what a player cares about. Every other tag hides behind "Tous les tags".
const ELEMENT_TAGS = ['fire', 'ice', 'lightning', 'water', 'earth', 'wind', 'radiant', 'dark', 'necro', 'poison', 'physical', 'magic', 'heal'];
const KIND_TAGS    = ['monster', 'beast', 'mecha', 'evil', 'summon', 'divinity', 'tiger'];

let activeTagFilter = null;
let selectedNom = null;

function charTags(c) {
    const tags = new Set(c.tags ?? []);
    c.moveSet?.forEach(m => m.base.tags?.forEach(t => tags.add(t)));
    c.passif?.forEach(p => p.tags?.forEach(t => tags.add(t)));
    c.transformation?.moveSet?.forEach(m => m.base.tags?.forEach(t => tags.add(t)));
    return tags;
}

function getAllTags() {
    const tags = new Set();
    allChars.forEach(c => charTags(c).forEach(t => tags.add(t)));
    return [...tags].sort();
}

function charMatchesTag(c, tag) {
    return !tag || charTags(c).has(tag);
}

function chip(t) {
    const color = TAG_COLOR[t];
    const style = color ? ` style="--chip:${color}"` : '';
    return `<button class="tag-filter-btn${activeTagFilter === t ? ' active' : ''}" data-tag="${t}"${style}>${t}</button>`;
}

function renderTagFilter() {
    const container = document.getElementById('tagFilter');
    if (!container) return;
    const present = new Set(getAllTags());
    const elements = ELEMENT_TAGS.filter(t => present.has(t));
    const kinds = KIND_TAGS.filter(t => present.has(t));
    const shown = new Set([...elements, ...kinds]);
    const others = [...present].filter(t => !shown.has(t));
    const openOthers = activeTagFilter && others.includes(activeTagFilter);
    container.innerHTML = `
        <div class="chip-row"><button class="tag-filter-btn${!activeTagFilter ? ' active' : ''}" data-tag="">Tous</button>${kinds.map(chip).join('')}</div>
        <div class="chip-row">${elements.map(chip).join('')}</div>
        <details class="chip-more"${openOthers ? ' open' : ''}>
            <summary>Tous les tags (${others.length})</summary>
            <div class="chip-row">${others.map(chip).join('')}</div>
        </details>`;
    container.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = btn.dataset.tag || null;
            activeTagFilter = (t && t === activeTagFilter) ? null : t;
            renderTagFilter();
            renderSheets(searchInput.value);
        });
    });
}

// ── Render helpers ─────────────────────────────────────────────────────────

function tag(label, color) {
    return `<span class="tag" style="background:${color ?? '#555'}">${label}</span>`;
}

function renderTags(tags = []) {
    return tags.map(t => tag(t, TAG_COLOR[t])).join('');
}

function resourceBadge(move) {
    const parts = [];
    if (move.spellCost) parts.push(`${move.spellCost}S`);
    if (move.kiCost) parts.push(`${move.kiCost}Ki`);
    if (move.soulCost) parts.push(`${move.soulCost}♦`);
    if (move.cooldown != null && move.cooldown > 0 && move.cooldown !== 99) parts.push(`${move.cooldown}T cd`);
    if (move.cooldown === 99) parts.push('1×/fight');
    return parts.length ? `<span class="resource-badge">${parts.join(' · ')}</span>` : '';
}

function targetBadge(move) {
    let label = move.target ?? '';
    if (move.range) label += ` r${move.range}`;
    if (move.radius) label += ` ø${move.radius}`;
    if (move.maxBounce) label += ` ×${move.maxBounce}`;
    return label ? `<span class="target-badge">${label}</span>` : '';
}

function renderMove(move) {
    const catLabel = CATEGORY_LABEL[move.category] ?? move.category;
    const dice = move.base.dices ? `<span class="dice">${move.base.dices}</span>` : '';
    const desc = move.description ? `<span class="move-desc">${move.description}</span>` : '';
    return `
        <div class="move-row">
            <span class="move-cat cat-${move.category}">${catLabel}</span>
            <span class="move-name">${move.base.nom}</span>
            ${dice}
            ${targetBadge(move)}
            ${resourceBadge(move)}
            <span class="move-tags">${renderTags(move.base.tags)}</span>
            ${desc}
        </div>`;
}

function renderPassif(p) {
    const dice = p.dices ? `<span class="dice">${p.dices}</span>` : '';
    const desc = p.description ? ` — <em>${p.description}</em>` : '';
    const apply = p.applyOn?.length ? `<span class="apply-on">[${p.applyOn.join(', ')}]</span>` : '';
    return `<div class="passif-row">
        <span class="passif-name">${p.nom}</span>${dice}${apply}
        <span class="move-tags">${renderTags(p.tags)}</span>${desc}
    </div>`;
}

function renderTransformation(tf) {
    if (!tf) return '';
    const hpLine = tf.hp > 0 ? `+${tf.hp} HP` : '';
    const spLine = tf.spellSlot > 0 ? ` · ${tf.spellSlot}S` : '';
    const speedLine = tf.speed !== 6 ? ` · spd ${tf.speed}` : '';
    const moves = tf.moveSet?.length
        ? tf.moveSet.map(renderMove).join('')
        : '<em class="none">—</em>';
    return `
        <div class="transformation-block">
            <div class="tf-header">
                <span class="tf-name">${tf.base.nom}</span>
                <span class="tf-stats">${hpLine}${spLine}${speedLine}</span>
                <span class="move-tags">${renderTags(tf.base.tags)}</span>
            </div>
            <div class="tf-atk">⚔ ${tf.baseAtk.nom} <span class="dice">${tf.baseAtk.dices}</span> ${renderTags(tf.baseAtk.tags)}</div>
            <div class="move-list">${moves}</div>
        </div>`;
}

function renderDomain(d) {
    if (!d) return '';
    const effects = d.effects?.map(e => {
        const dice = e.dices ? `<span class="dice">${e.dices}</span>` : '';
        const cond = e.condition ? `<em class="cond">[if: ${JSON.stringify(e.condition)}]</em>` : '';
        return `<div class="domain-effect-row">
            <span class="domain-effect-name">${e.nom}</span>${dice}
            <span class="de-target tag-target">${e.target}</span>
            <span class="move-tags">${renderTags(e.tags)}</span>${cond}
        </div>`;
    }).join('') ?? '';
    return `
        <div class="domain-block">
            <div class="domain-header">
                <span class="domain-name">${d.name}</span>
                <span class="domain-type">${d.type}</span>
                <span class="domain-ref">Raf. ${d.rafinement} · ${d.charges ?? 1} charge${(d.charges ?? 1) > 1 ? 's' : ''}</span>
            </div>
            <p class="domain-desc">${d.description}</p>
            <div class="domain-effects">${effects}</div>
        </div>`;
}

function renderCombatButtons(char) {
    const teams = getStoredTeams();
    const inTeam0 = teams[0].includes(char.nom);
    const inTeam1 = teams[1].includes(char.nom);
    const goBtn = (inTeam0 || inTeam1)
        ? `<a href="combat.html" class="combat-go-link">▶ Go to Combat</a>` : '';
    return `
        <div class="combat-add-row">
            <button class="combat-add-btn${inTeam0 ? ' in-team' : ''}" data-nom="${char.nom}" data-team="0">
                ${inTeam0 ? '✓ Team 1' : '+ Team 1'}
            </button>
            <button class="combat-add-btn${inTeam1 ? ' in-team' : ''}" data-nom="${char.nom}" data-team="1">
                ${inTeam1 ? '✓ Team 2' : '+ Team 2'}
            </button>
            ${goBtn}
        </div>`;
}

function renderCard(char) {
    const card = document.createElement('article');
    card.className = 'char-card';

    const hasKi = char.ki > 0 || char.kiRegen > 0;
    const hasSouls = char.souls != null;
    const hasSpells = char.spellSlot > 0;
    const hasImmunities = char.immunities?.length > 0;
    const hasAuthority = char.autority > 0;

    const statBadges = [
        hasSpells ? `<span class="stat-badge spell-slot">${char.spellSlot} sorts</span>` : '',
        hasKi ? `<span class="stat-badge ki-badge">${char.ki} Ki (+${char.kiRegen}/t)</span>` : '',
        hasSouls ? `<span class="stat-badge soul-badge">${char.souls} Âmes</span>` : '',
        char.speed !== 6 ? `<span class="stat-badge speed-badge">spd ${char.speed}</span>` : '',
        hasAuthority ? `<span class="stat-badge auth-badge">Auth. ${char.autority}</span>` : '',
    ].join('');

    const immunityRow = hasImmunities
        ? `<div class="immunity-row">Immunités : ${char.immunities.map(i => `<span class="immun-tag">${i}</span>`).join('')}</div>`
        : '';

    const passifSection = char.passif?.length
        ? `<div class="section-title">Passifs</div><div class="passif-list">${char.passif.map(renderPassif).join('')}</div>`
        : '';

    const moveSection = char.moveSet?.length
        ? `<div class="section-title">Capacités</div><div class="move-list">${char.moveSet.map(renderMove).join('')}</div>`
        : '';

    const tfSection = char.transformation
        ? `<div class="section-title">Transformation</div>${renderTransformation(char.transformation)}`
        : '';

    const domainSection = char.domain
        ? `<div class="section-title">Domaine</div>${renderDomain(char.domain)}`
        : '';

    card.innerHTML = `
        <div class="char-header">
            <h3 class="char-name">${char.nom}</h3>
            <span class="char-hp">${char.hp} HP</span>
        </div>
        <div class="char-stats">${statBadges}</div>
        ${immunityRow}
        <div class="base-atk">
            ⚔ ${char.baseAtk.nom}
            <span class="dice">${char.baseAtk.dices}</span>
            ${renderTags(char.baseAtk.tags)}
        </div>
        ${passifSection}
        ${moveSection}
        ${tfSection}
        ${domainSection}
        ${renderCombatButtons(char)}
    `;

    // Bind combat add buttons
    card.querySelectorAll('.combat-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const nom  = btn.dataset.nom;
            const team = parseInt(btn.dataset.team);
            const teams = getStoredTeams();
            if (teams[team].includes(nom)) {
                teams[team] = teams[team].filter(n => n !== nom);
            } else if (teams[team].length < 5) {
                teams[team].push(nom);
            }
            saveTeams(teams);
            renderSheets(searchInput.value);
        });
    });

    return card;
}

let allChars = [];

const listEl = document.getElementById('charList');
const countEl = document.getElementById('listCount');
let visible = [];

async function init() {
    const res = await fetch('js/characters.json');
    allChars = await res.json();
    selectedNom = decodeURIComponent(location.hash.slice(1)) || null;
    renderTagFilter();
    renderSheets();
}

function inTeam(nom) {
    const teams = getStoredTeams();
    return teams[0].includes(nom) ? 1 : teams[1].includes(nom) ? 2 : 0;
}

function renderSheets(filter = '') {
    const q = filter.trim().toLowerCase();
    visible = allChars.filter(c => c.nom.toLowerCase().includes(q) && charMatchesTag(c, activeTagFilter));
    if (!visible.some(c => c.nom === selectedNom)) selectedNom = visible[0]?.nom ?? null;
    countEl.textContent = `${visible.length} / ${allChars.length} fiches`;
    listEl.innerHTML = visible.map(c => {
        const team = inTeam(c.nom);
        return `<li><button class="char-list-item${c.nom === selectedNom ? ' selected' : ''}" role="option"
                    aria-selected="${c.nom === selectedNom}" data-nom="${c.nom.replace(/"/g, '&quot;')}">
            <span class="cli-name">${c.nom}</span>
            ${team ? `<span class="cli-team">T${team}</span>` : ''}
            <span class="cli-hp">${c.hp}</span>
        </button></li>`;
    }).join('') || '<li class="list-empty">Aucune fiche.</li>';
    renderDetail();
}

function renderDetail() {
    sheetContainer.innerHTML = '';
    const c = allChars.find(x => x.nom === selectedNom);
    if (!c) { sheetContainer.innerHTML = '<p class="list-empty">Aucune fiche à afficher.</p>'; return; }
    sheetContainer.appendChild(renderCard(c));
}

function select(nom, scroll = true) {
    selectedNom = nom;
    history.replaceState(null, '', '#' + encodeURIComponent(nom));
    listEl.querySelectorAll('.char-list-item').forEach(btn => {
        const on = btn.dataset.nom === nom;
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-selected', on);
    });
    renderDetail();
    if (scroll && window.matchMedia('(max-width: 800px)').matches) {
        sheetContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

listEl.addEventListener('click', e => {
    const btn = e.target.closest('.char-list-item');
    if (btn) select(btn.dataset.nom);
});

listEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = visible.findIndex(c => c.nom === selectedNom);
    const next = visible[Math.min(visible.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    select(next.nom, false);
    const sel = listEl.querySelector('.char-list-item.selected');
    sel?.focus();
    sel?.scrollIntoView({ block: 'nearest' });
});

searchInput.addEventListener('input', e => renderSheets(e.target.value));
init();
