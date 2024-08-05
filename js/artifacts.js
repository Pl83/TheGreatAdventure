const container = document.querySelector('#artifacts table tbody');

const logoUrl = 'img/artifacts/';
const showdetailsUrl = 'artifact.html?item=';

function fillArtifacts() {
    artifacts.forEach(artifact => {
        let tr = document.createElement('tr');
        let name = document.createElement('td');
        let divinity = document.createElement('td');
        let status = document.createElement('td');
        let autority = document.createElement('td');
    
        name.innerText = artifact.name;
        divinity.innerText = artifact.divinity;
        status.innerText = artifact.status;
        autority.innerText = artifact.autority;
    
        tr.appendChild(name);
        tr.appendChild(divinity);
        tr.appendChild(status);
        tr.appendChild(autority);
    
        container.appendChild(tr);
    
        tr.addEventListener('click', () => {
            window.location.href = showdetailsUrl + artifact.slug;
        });
    });
}

fillArtifacts();