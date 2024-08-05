const container = document.querySelector('#factions');

const logoUrl = 'img/logo/';
const showPersoUrl = 'personages.html?filter=';

factions.forEach(faction => {
    let article = document.createElement('article');
    let div = document.createElement('div');
    let img = document.createElement('img');
    let h3 = document.createElement('h3');
    let details = document.createElement('details');
    let summary = document.createElement('summary');
    let p = document.createElement('p');
    let p2 = document.createElement('p');
    let a = document.createElement('a');

    img.loading = 'lazy';
    img.src = logoUrl + faction.name + '.webp';
    img.alt = faction.name;
    
    h3.innerText = faction.name;

    summary.innerText = "Who are they ?";

    p.innerText = faction.text;
    p2.innerText = "Alignement : " + faction.alignement;

    a.href = showPersoUrl + faction.slug;
    a.innerText = "See Caracters affiliated to this factions";

    div.appendChild(img);
    div.appendChild(h3);

    details.appendChild(summary);
    details.appendChild(p);

    article.appendChild(div);
    article.appendChild(details);
    article.appendChild(p2);
    article.appendChild(a);

    container.appendChild(article);
});