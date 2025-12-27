// const realmContainer = document.querySelector('#realm');
// const worldContainer = document.querySelector('#world');
// const continentContainer = document.querySelector('#continent');
// const cityContainer = document.querySelector('#city');
// let logoUrl = null;

// if ( window.location.href.includes('github') ) {
//     logoUrl = 'https://raw.githubusercontent.com/Pl83/TheGreatAdventure/main/img/place/'
// } else {
//     logoUrl = 'img/place/';
// }

// realms.forEach(realm => {
//     let article = document.createElement('article');
//     let summary = document.createElement('summary');
//     let details = document.createElement('details');
//     let img = document.createElement('img');
//     let ul = document.createElement('ul');
//     let li = document.createElement('li');
//     let li2 = document.createElement('li');

//     summary.innerText = realm.name;
//     img.src = logoUrl + realm.slug + '.webp';
//     li.innerText = 'Size: ' + realm.size
//     li2.innerText = "Information: " + realm.description

//     ul.appendChild(li);
//     ul.appendChild(li2);

//     details.appendChild(img);
//     details.appendChild(ul);

//     article.appendChild(summary);
//     article.appendChild(details);

//     realmContainer.appendChild(article)
// });

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('maps-container');

    realms.forEach(realm => {
        // Création de la carte du Realm
        const realmSection = document.createElement('article');
        realmSection.className = 'realm-card';
        
        // Filtrage des mondes appartenant à ce realm
        const realmWorlds = worlds.filter(w => w.realm === realm.name);

        let worldsHTML = '';
        realmWorlds.forEach(world => {
            // Filtrage des continents appartenant à ce monde
            const worldContinents = continents.filter(c => c.world === world.name);
            
            // Filtrage des villes appartenant à ce monde (ou continents de ce monde)
            const worldCities = citys.filter(city => 
                city.world === world.name || 
                worldContinents.some(cont => cont.name === city.continents)
            );

            worldsHTML += `
                <div class="world-item">
                    <h3>${world.name}</h3>
                    <p><em>Système: ${world.system} (${world.nbStars} étoile(s))</em></p>
                    <p>${world.description}</p>
                    
                    ${worldContinents.length > 0 ? `
                        <div class="sub-info">
                            <strong>Continents:</strong> ${worldContinents.map(c => c.name).join(', ')}
                        </div>
                    ` : ''}
                    
                    ${worldCities.length > 0 ? `
                        <div class="sub-info">
                            <strong>Villes:</strong> 
                            ${worldCities.map(city => `<span class="city-pill">${city.name}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        realmSection.innerHTML = `
            <div class="realm-header">
                <h2>${realm.name} <span class="pill-realm">(${realm.size})</span></h2>
                <p>${realm.description}</p>
            </div>
            <div class="worlds-container">
                ${worldsHTML || '<p>Aucun monde répertorié dans ce realm.</p>'}
            </div>
        `;
        
        container.appendChild(realmSection);
    });
});