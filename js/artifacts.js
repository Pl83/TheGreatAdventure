import { artifacts } from './main.js';

const container = document.querySelector('#artifacts table tbody');

artifacts.forEach(artifact => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${artifact.name}</td>
        <td>${artifact.divinity}</td>
        <td>${artifact.status}</td>
        <td>${artifact.authority}</td>
    `;
    tr.addEventListener('click', () => {
        window.location.href = `artifact.html?item=${artifact.slug}`;
    });
    container.appendChild(tr);
});
