// Responsive nav toggle — shared across all pages
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.querySelector('.nav-toggle');
  var header = document.querySelector('header');
  if (!btn || !header) return;

  btn.addEventListener('click', function () {
    var open = header.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
  });

  // Close drawer when any nav link is clicked (page navigation)
  header.querySelectorAll('nav a').forEach(function (a) {
    a.addEventListener('click', function () {
      header.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
});
