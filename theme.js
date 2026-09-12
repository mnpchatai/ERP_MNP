/* Light/dark theme toggle, shared by every page. Initial theme is applied by an
   inline script in <head> (before stylesheets load) to avoid a flash of the
   wrong theme; this file only wires up the toggle button(s). */
(function () {
  var KEY = 'mnp-theme';

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(next === 'dark'));
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(document.documentElement.getAttribute('data-theme') === 'dark'));
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        setTheme(current === 'dark' ? 'light' : 'dark');
      });
    });
  });
})();
