// Companion new-tab page. Redirects every new tab to the Local Toby dashboard.
// The main extension's ID is entered once and remembered in this page's own
// localStorage (this companion requests no permissions).

(function () {
  'use strict';
  var KEY = 'localTobyMainId';

  function dashboardUrl(id) {
    return 'chrome-extension://' + id + '/src/dashboard/dashboard.html';
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  // Escape hatch: opening this page as newtab.html#setup skips the redirect so a
  // wrong-but-valid-format id can be corrected instead of locking the user out.
  var id = stored();
  if (id && /^[a-p]{32}$/.test(id) && location.hash !== '#setup') {
    location.replace(dashboardUrl(id));
    return;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('id-input');
    var save = document.getElementById('save');
    if (id) input.value = id; // pre-fill the current (possibly wrong) id for editing
    function commit() {
      var val = (input.value || '').trim().toLowerCase();
      if (!/^[a-p]{32}$/.test(val)) { input.style.borderColor = '#D14343'; input.focus(); return; }
      try { localStorage.setItem(KEY, val); } catch (e) {}
      location.replace(dashboardUrl(val));
    }
    save.addEventListener('click', commit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
  });
})();
