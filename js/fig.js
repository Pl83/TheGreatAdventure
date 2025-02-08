/*Load faction*/

// let factionsHolder = document.getElementById('facts');

// factions.forEach(e => {
//     let li = document.createElement('li');
//     let label = document.createElement('label');
//     label.classList.add('faction');
//     label.innerHTML =`${e.name}  <input type="checkbox" name="${e.name}" value="${e.name}">`;
//     li.append(label);
//     factionsHolder.append(li);
// })



/*=========================================================================================*/
/*====================================Load characters======================================*/
/*=========================================================================================*/

document.addEventListener("DOMContentLoaded", function () {
    const jsonDataUrl = "js/fig.json"; // Update with the correct path if needed

    // Fetch the JSON data
    fetch(jsonDataUrl)
        .then(response => response.json())
        .then(data => populateCharacters(data))
        .catch(error => console.error("Error loading JSON:", error));

    function populateCharacters(data) {
        const figSection = document.getElementById("fig");

        Object.keys(data).forEach(faction => {
            const characters = data[faction];

            // Create the faction category header
            const categoryDiv = document.createElement("div");
            categoryDiv.classList.add("categories");

            const img = document.createElement("img");
            img.src = `img/logo/${faction.toLowerCase().replace(/\s+/g, '-')}.webp`;
            img.alt = `${faction} logo`;
            img.classList.add('logos');
            img.loading = 'lazy';

            const title = document.createElement("h3");
            title.textContent = faction;

            categoryDiv.appendChild(img);
            categoryDiv.appendChild(title);
            figSection.appendChild(categoryDiv);

            // Create faction container
            const factionContainer = document.createElement("div");
            factionContainer.id = faction;
            factionContainer.classList.add("cards-wrapper");

            Object.keys(characters).forEach(characterName => {
                const character = characters[characterName];

                // Create the character card
                const cardDiv = document.createElement("div");
                cardDiv.classList.add("card");
                if (character.unique) {
                    cardDiv.classList.add("unique");
                }

                // Top section (name & title)
                const topDiv = document.createElement("div");
                topDiv.classList.add("top");

                const nameElement = document.createElement("h4");
                nameElement.textContent = characterName;
                topDiv.appendChild(nameElement);

                if (character.title) {
                    const titleElement = document.createElement("p");
                    titleElement.textContent = character.title.join(", ");
                    topDiv.appendChild(titleElement);
                }

                // Middle section (image & details)
                const middleDiv = document.createElement("div");
                middleDiv.classList.add("middle");

                let imgElement = document.createElement("img");
                imgElement.classList.add("left");

                if (character.url && character.url.length > 0) {
                    imgElement.src = `https://raw.githubusercontent.com/Pl83/legoBDD/refs/heads/main/${character.url[0]}`;
                    imgElement.alt = `Image of ${characterName}`;
                    imgElement.dataset.index = 0; // Track current image index
                    imgElement.dataset.images = JSON.stringify(character.url); // Store image array

                    // Add hover event to change cursor to pointer if multiple images
                    if (character.url.length > 1) {
                        imgElement.style.cursor = "pointer";
                    }

                    // Add click event to cycle images
                    imgElement.addEventListener("click", function () {
                        let images = JSON.parse(this.dataset.images);
                        let index = parseInt(this.dataset.index, 10);

                        index = (index + 1) % images.length; // Cycle through images

                        this.src = `https://raw.githubusercontent.com/Pl83/legoBDD/refs/heads/main/Gost/${images[index]}`;
                        this.dataset.index = index;
                    });

                    middleDiv.appendChild(imgElement);
                }

                const detailsList = document.createElement("ul");
                detailsList.classList.add("right");

                const speciesItem = document.createElement("li");
                speciesItem.textContent = `Species: ${character.species}`;
                detailsList.appendChild(speciesItem);

                if (character.weapon) {
                    const weaponItem = document.createElement("li");
                    weaponItem.textContent = `Weapon: ${character.weapon}`;
                    detailsList.appendChild(weaponItem);
                }

                if (character.power) {
                    const powerItem = document.createElement("li");
                    powerItem.textContent = `Powers: ${character.power.join(", ")}`;
                    detailsList.appendChild(powerItem);
                }

                if (character.weakness) {
                    const weaknessItem = document.createElement("li");
                    weaknessItem.textContent = `Weakness: ${character.weakness.join(", ")}`;
                    detailsList.appendChild(weaknessItem);
                }

                middleDiv.appendChild(detailsList);

                // Bottom section (description)
                const bottomDiv = document.createElement("p");
                bottomDiv.classList.add("bottom");
                bottomDiv.textContent = character.description;

                // Append sections to card
                cardDiv.appendChild(topDiv);
                cardDiv.appendChild(middleDiv);
                cardDiv.appendChild(bottomDiv);

                // Append card to faction container
                factionContainer.appendChild(cardDiv);
            });

            // Append faction container to the section
            figSection.appendChild(factionContainer);
        });
    }
});
