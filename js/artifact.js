import { artifacts } from './main.js';

const container = document.querySelector('#artifact');
const slug = new URLSearchParams(window.location.search).get('item');
const artifact = artifacts.find(a => a.slug === slug);

if (artifact) {
    document.querySelector('h2').textContent = artifact.name;

    const ul = document.createElement('ul');
    ul.innerHTML = `
        <li>Divinity: ${artifact.divinity}</li>
        <li>Status: ${artifact.status}</li>
        <li>Authority: ${artifact.authority}/8</li>
        <li>Power: ${artifact.power}</li>
    `;
    container.appendChild(ul);
} else {
    container.textContent = slug ? 'Artifact not found.' : 'No artifact specified.';
}
