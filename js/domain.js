import { domainData } from './main.js';

const container = document.getElementById('domain-container');

for (const [owner, domain] of Object.entries(domainData)) {
        const card = document.createElement('div');
        card.className = `domain-card ${domain.type.toLowerCase()}`;
        card.innerHTML = `
            <div class="domain-header">
                <span class="domain-type">${domain.type}</span>
                <h3>${domain.name}</h3>
                <p class="domain-user">Utilisateur : ${owner}</p>
            </div>
            <p class="domain-desc">"${domain.description}"</p>
            <div class="domain-stats">
                <p><strong>Effet :</strong> ${domain.effect}</p>
                <p><strong>Coût :</strong> ${domain.cost}</p>
                <p><strong>Raffinement :</strong> ${domain.rafinement}</p>
            </div>
        `;
        container.appendChild(card);
}
