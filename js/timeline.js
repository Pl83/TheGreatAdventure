document.querySelectorAll('details').forEach((el) => {
    el.addEventListener('click', (e) => {
        if (!el.open) {
            document.querySelectorAll('details').forEach((other) => {
                if (other !== el) other.open = false;
            });
        }
    });
});