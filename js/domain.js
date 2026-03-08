document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('domain-container');

    for (const owner in domainData) {
        const domain = domainData[owner];
        const card = document.createElement('div');
        card.className = `domain-card ${domain.type.toLowerCase()}`;

        card.innerHTML = `
            <div class="domain-header">
                <span class="domain-type">${domain.type}</span>
                <h3>${domain.name}</h3>
                <p style="color: #7f8c8d; font-size: 0.8rem; margin: 5px 0;">Utilisateur : ${owner}</p>
            </div>
            
            <p class="domain-desc">"${domain.description}"</p>
            
            <div class="domain-stats">
                <p><strong>Effet: </strong>   ${domain.effect}</p>
                <p><strong>Coût: </strong>   ${domain.cost}</p>
                <p><strong>Rafinement: </strong>   ${domain.rafinement}</p>
            </div>
        `;
        container.appendChild(card);
    }
});