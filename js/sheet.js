document.addEventListener('DOMContentLoaded', () => {
    const sheetContainer = document.getElementById('sheet');
    const searchInput = document.getElementById('charSearch');

    function renderSheets(filter = '') {
        sheetContainer.innerHTML = '';
        
        const filteredChars = personnageSheet.filter(char => 
            char.name.toLowerCase().includes(filter.toLowerCase())
        );

        filteredChars.forEach(char => {
            const card = document.createElement('article');
            card.className = 'char-card';

            // Construction des sections
            const passives = char.passives ? char.passives.map(p => `<span class="pill">${p}</span>`).join('') : '';
            const spells = char.spells ? char.spells.map(s => `<span class="pill spell" title="${s.desc || ''}">${s.name} (${s.dice || '—'})</span>`).join('') : '';
            const abilities = char.abilities ? char.abilities.map(a => `<span class="pill tech">${a.name} [${a.cooldown || a.cost || ''}]</span>`).join('') : '';

            card.innerHTML = `
                <div class="char-header">
                    <h3>${char.name}</h3>
                    <span class="char-hp">${char.hp} HP</span>
                </div>
                
                ${char.spellSlots ? `<p style="font-size:0.8rem">✨ Spell Slots: <strong>${char.spellSlots}</strong></p>` : ''}
                ${char.souls ? `<p style="font-size:0.8rem">👻 Souls: <strong>${char.souls}</strong></p>` : ''}
                ${char.ki ? `<p style="font-size:0.8rem">☯️ Ki: <strong>${char.ki}</strong> (+${char.kiRegen}/t)</p>` : ''}

                <div class="section-title">Passifs & Titres</div>
                <div class="pill-container">${passives || '<em>Aucun</em>'}</div>

                <div class="section-title">Sorts</div>
                <div class="pill-container">${spells || '<em>Aucun</em>'}</div>

                <div class="section-title">Techniques</div>
                <div class="pill-container">${abilities || '<em>Aucune</em>'}</div>

                <div class="attack-box">
                    ⚔️ ${char.attack || 'Attaque variable'}
                </div>
            `;
            sheetContainer.appendChild(card);
        });
    }

    // Écouteur pour la recherche
    searchInput.addEventListener('input', (e) => renderSheets(e.target.value));

    // Premier rendu
    renderSheets();
});