const JSON_URL = 'js/fig.json';
const IMG_BASE = 'https://raw.githubusercontent.com/Pl83/legoBDD/refs/heads/main/';

const figSection = document.getElementById('fig');

fetch(JSON_URL)
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => populateCharacters(data))
    .catch(() => {
        figSection.innerHTML = '<p>Failed to load character data.</p>';
    });

function populateCharacters(data) {
    Object.entries(data).forEach(([faction, characters]) => {
        if (!Object.keys(characters).length) return;

        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'categories';

        const img = document.createElement('img');
        img.src = `img/logo/${faction.toLowerCase().replace(/\s+/g, '-')}.webp`;
        img.alt = `${faction} logo`;
        img.className = 'logos';
        img.loading = 'lazy';

        const title = document.createElement('h3');
        title.textContent = faction;

        categoryDiv.append(img, title);
        figSection.appendChild(categoryDiv);

        const factionContainer = document.createElement('div');
        factionContainer.id = faction;
        factionContainer.className = 'cards-wrapper';

        Object.entries(characters).forEach(([characterName, character]) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = character.unique ? 'card unique' : 'card';

            const topDiv = document.createElement('div');
            topDiv.className = 'top';

            const nameEl = document.createElement('h4');
            nameEl.textContent = characterName;
            topDiv.appendChild(nameEl);

            if (character.title) {
                const titleEl = document.createElement('p');
                titleEl.textContent = character.title.join(', ');
                topDiv.appendChild(titleEl);
            }

            const middleDiv = document.createElement('div');
            middleDiv.className = 'middle';

            if (character.url?.length) {
                const imgEl = document.createElement('img');
                imgEl.className = 'left';
                imgEl.src = IMG_BASE + character.url[0];
                imgEl.alt = `Image of ${characterName}`;
                imgEl.dataset.index = 0;
                imgEl.dataset.images = JSON.stringify(character.url);

                if (character.url.length > 1) {
                    imgEl.style.cursor = 'pointer';
                    imgEl.addEventListener('click', function () {
                        const images = JSON.parse(this.dataset.images);
                        const next = (parseInt(this.dataset.index, 10) + 1) % images.length;
                        this.src = IMG_BASE + images[next];
                        this.dataset.index = next;
                    });
                }
                middleDiv.appendChild(imgEl);
            }

            const detailsList = document.createElement('ul');
            detailsList.className = 'right';
            detailsList.innerHTML = `
                <li>Species: ${character.species ?? '—'}</li>
                ${character.weapon ? `<li>Weapon: ${character.weapon}</li>` : ''}
                ${character.power?.length ? `<li>Powers: ${character.power.join(', ')}</li>` : ''}
                ${character.weakness?.length ? `<li>Weakness: ${character.weakness.join(', ')}</li>` : ''}
            `;
            middleDiv.appendChild(detailsList);

            const bottomDiv = document.createElement('p');
            bottomDiv.className = 'bottom';
            bottomDiv.textContent = character.description ?? '';

            cardDiv.append(topDiv, middleDiv, bottomDiv);
            factionContainer.appendChild(cardDiv);
        });

        figSection.appendChild(factionContainer);
    });
}
