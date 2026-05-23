import { realms, worlds, continents, citys } from './main.js';

const container = document.getElementById('maps-container');

realms.forEach(realm => {
        const realmSection = document.createElement('article');
        realmSection.className = 'realm-card';

        const realmWorlds = worlds.filter(w => w.realm === realm.name);

        const worldsHTML = realmWorlds.map(world => {
            const worldContinents = continents.filter(c => c.world === world.name);
            const worldCities = citys.filter(city =>
                city.world === world.name ||
                worldContinents.some(cont => cont.name === city.continents)
            );

            return `
                <div class="world-item">
                    <h3>${world.name}</h3>
                    <p><em>System: ${world.system} (${world.nbStars} star(s))</em></p>
                    <p>${world.description}</p>
                    ${worldContinents.length ? `
                        <div class="sub-info">
                            <strong>Continents:</strong> ${worldContinents.map(c => c.name).join(', ')}
                        </div>
                    ` : ''}
                    ${worldCities.length ? `
                        <div class="sub-info">
                            <strong>Cities:</strong>
                            ${worldCities.map(city => `<span class="city-pill">${city.name}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        realmSection.innerHTML = `
            <div class="realm-header">
                <h2>${realm.name} <span class="pill-realm">(${realm.size})</span></h2>
                <p>${realm.description}</p>
            </div>
            <div class="worlds-container">
                ${worldsHTML || '<p>No worlds listed in this realm.</p>'}
            </div>
        `;

        container.appendChild(realmSection);
});
