const container = document.querySelector('#artifact');

const urlVars = new URLSearchParams(window.location.search);

console.log(urlVars.get('item'));

const artifact = artifacts.find(artifact => artifact.slug === urlVars.get('item'));

if (artifact) {
    let name = document.querySelector('h2');
    let divinity = document.createElement('li');
    let status = document.createElement('li');
    let autority = document.createElement('li');
    let power = document.createElement('li');
    let img = document.createElement('img');
    let div = document.createElement('ul');

    name.innerText = artifact.name;
    divinity.innerText = "Divinity : " + artifact.divinity;
    status.innerText = "Status : " + artifact.status;
    autority.innerText = "Autority : " + artifact.autority+"/8";
    power.innerText = "Power : " + artifact.power;
    //img.src = 'img/artifacts/' + artifact.slug + '.webp';
    img.alt = artifact.name;

    container.appendChild(img);
    div.appendChild(divinity);
    div.appendChild(status);
    div.appendChild(autority);
    div.appendChild(power);
    container.appendChild(div);
}