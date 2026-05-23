import { factions } from './main.js';

// Map alignment string → CSS custom property for the top edge bar
const alignColor = {
  'lawful good':    'var(--tga-align-lg)',
  'lawful neutral': 'var(--tga-align-ln)',
  'lawful evil':    'var(--tga-align-le)',
  'chaotic neutral':'var(--tga-align-cn)',
  'chaotic evil':   'var(--tga-align-ce)',
  'neutral neutral':'var(--tga-align-nn)',
  'true neutral':   'var(--tga-align-nn)',
  'neutral evil':   'var(--tga-align-ne)',
  'neutral good':   'var(--tga-align-ng)',
};

const container = document.querySelector('#factions');

factions.forEach(faction => {
  const alignment = faction.alignment ?? faction.alignement ?? '';
  const color = alignColor[alignment.toLowerCase()] ?? 'var(--tga-bronze)';

  const article = document.createElement('article');
  article.className = 'faction-card';
  article.style.setProperty('--faction-align-color', color);

  article.innerHTML = `
    <div class="faction-top">
      <div class="faction-crest">
        <img src="img/logo/${faction.slug}.webp" alt="${faction.name}" loading="lazy">
      </div>
      <div class="faction-title">
        <span class="faction-eyebrow">${alignment || 'Unknown alignment'}</span>
        <h3>${faction.name}</h3>
      </div>
    </div>
    <p class="faction-body">${faction.text}</p>
    <div class="faction-footer">
      <span>${faction.slug}</span>
      <span>${alignment || '—'}</span>
    </div>
  `;

  container.appendChild(article);
});
