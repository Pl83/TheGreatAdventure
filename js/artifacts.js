import { artifacts } from './main.js';

const container = document.querySelector('#artifacts table tbody');

artifacts.forEach(artifact => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td class="art-name">${artifact.name}</td>
        <td class="art-div">${artifact.divinity}</td>
        <td>${artifact.status}</td>
        <td><span class="art-auth">${artifact.authority}</span></td>
    `;
    tr.addEventListener('click', () => {
        window.location.href = `artifact.html?item=${artifact.slug}`;
    });
    container.appendChild(tr);
});
