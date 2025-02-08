const realmContainer = document.querySelector('#realm');
const worldContainer = document.querySelector('#world');
const continentContainer = document.querySelector('#continent');
const cityContainer = document.querySelector('#city');
let logoUrl = null;

if ( window.location.href.includes('github') ) {
    logoUrl = 'https://raw.githubusercontent.com/Pl83/TheGreatAdventure/main/img/place/'
} else {
    logoUrl = 'img/place/';
}

realms.forEach(realm => {
    let article = document.createElement('article');
    let summary = document.createElement('summary');
    let details = document.createElement('details');
    let img = document.createElement('img');
    let ul = document.createElement('ul');
    let li = document.createElement('li');
    let li2 = document.createElement('li');

    summary.innerText = realm.name;
    img.src = logoUrl + realm.slug + '.webp';
    li.innerText = 'Size: ' + realm.size
    li2.innerText = "Information: " + realm.description

    ul.appendChild(li);
    ul.appendChild(li2);

    details.appendChild(img);
    details.appendChild(ul);

    article.appendChild(summary);
    article.appendChild(details);

    realmContainer.appendChild(article)
});