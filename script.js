// TechSaathi — shared site behavior
// Handles: mobile nav toggle, text-size control, high-contrast toggle,
// and (on the contact page) a friendly inline form confirmation.

(function () {
  var root = document.documentElement;
  var TEXT_KEY = 'ts-text-size';
  var CONTRAST_KEY = 'ts-contrast';
  var sizes = ['text-base', 'text-lg', 'text-xl'];

  function applySavedPreferences() {
    var savedSize = localStorage.getItem(TEXT_KEY);
    if (savedSize && savedSize !== 'text-base') {
      root.classList.add(savedSize);
    }
    if (localStorage.getItem(CONTRAST_KEY) === 'on') {
      root.classList.add('contrast');
    }
    updateButtonStates();
  }

  function currentSizeIndex() {
    for (var i = sizes.length - 1; i >= 0; i--) {
      if (root.classList.contains(sizes[i])) return i;
    }
    return 0;
  }

  function setSize(index) {
    sizes.forEach(function (s) { root.classList.remove(s); });
    index = Math.max(0, Math.min(sizes.length - 1, index));
    if (index > 0) root.classList.add(sizes[index]);
    localStorage.setItem(TEXT_KEY, sizes[index]);
    updateButtonStates();
  }

  function updateButtonStates() {
    var contrastBtn = document.getElementById('contrastToggle');
    if (contrastBtn) {
      contrastBtn.setAttribute('aria-pressed', root.classList.contains('contrast') ? 'true' : 'false');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    applySavedPreferences();

    var incBtn = document.getElementById('textIncrease');
    var decBtn = document.getElementById('textDecrease');
    var contrastBtn = document.getElementById('contrastToggle');
    var navToggle = document.getElementById('navToggle');
    var navbar = document.getElementById('navbar');

    if (incBtn) {
      incBtn.addEventListener('click', function () { setSize(currentSizeIndex() + 1); });
    }
    if (decBtn) {
      decBtn.addEventListener('click', function () { setSize(currentSizeIndex() - 1); });
    }
    if (contrastBtn) {
      contrastBtn.addEventListener('click', function () {
        var on = root.classList.toggle('contrast');
        localStorage.setItem(CONTRAST_KEY, on ? 'on' : 'off');
        updateButtonStates();
      });
    }
    if (navToggle && navbar) {
      navToggle.addEventListener('click', function () {
        var isOpen = navbar.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }

    // Contact form: keep the person on the page, validate natively,
    // then show a clear confirmation instead of silently redirecting.
    var form = document.getElementById('contactForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }
        var data = {
          name: form.elements['name'].value.trim(),
          email: form.elements['email'].value.trim(),
          subject: form.elements['subject'].value.trim(),
          message: form.elements['message'].value.trim()
        };
        var showDone = function () {
          var success = document.getElementById('formSuccess');
          if (success) {
            success.classList.add('show');
            success.setAttribute('tabindex', '-1');
            success.focus();
          }
          form.reset();
        };
        if (window.EasyAuth) {
          EasyAuth.saveFeedback(data).then(showDone, function () {
            alert('Sorry, we could not send your message because the connection failed. Please try again.');
          });
        } else { showDone(); }
      });
    }
  });
})();
