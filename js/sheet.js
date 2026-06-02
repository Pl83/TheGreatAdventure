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
    if (move.soulCost) parts.push(`${move.soulCost}Â`);
    if (move.cooldown != null && move.cooldown > 0) parts.push(`${move.cooldown}T cd`);
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
                <span class="domain-ref">Raf. ${d.rafinement} · ${d.spellCost}S</span>
            </div>
            <p class="domain-desc">${d.description}</p>
            <div class="domain-effects">${effects}</div>
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
    `;
    return card;
}

let allChars = [];

async function init() {
    const res = await fetch('js/characters.json');
    allChars = await res.json();
    renderSheets();
}

function renderSheets(filter = '') {
    sheetContainer.innerHTML = '';
    const q = filter.toLowerCase();
    allChars
        .filter(c => c.nom.toLowerCase().includes(q))
        .forEach(c => sheetContainer.appendChild(renderCard(c)));
}

searchInput.addEventListener('input', e => renderSheets(e.target.value));
init();
