import { factions } from './main.js';

const container = document.querySelector('#factions');

factions.forEach(faction => {
    const article = document.createElement('article');
    const div = document.createElement('div');
    const img = document.createElement('img');
    const h3 = document.createElement('h3');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const p = document.createElement('p');
    const p2 = document.createElement('p');

    img.loading = 'lazy';
    img.src = `img/logo/${faction.slug}.webp`;
    img.alt = faction.name;

    h3.textContent = faction.name;
    summary.textContent = 'Who are they?';
    p.textContent = faction.text;
    p2.textContent = `Alignment: ${faction.alignment ?? faction.alignement ?? '—'}`;

    div.append(img, h3);
    details.append(summary, p);
    article.append(div, details, p2);
    container.appendChild(article);
});
