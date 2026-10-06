/* Password reset page: /reset-password?token=… (link from the reset email).
   NOTE: The production backend does not have a /auth/reset-password endpoint yet.
   This page validates the token's presence, checks password strength/match,
   then shows a truthful fallback message directing users to support. */
(function () {
  var form = document.getElementById('resetForm'), err = document.getElementById('rpErr');
  var token = new URLSearchParams(location.search).get('token') || '';
  function fail(msg) { err.textContent = msg; err.hidden = false; }
  if (!token) fail('This reset link is incomplete. Open the full link from the email, or request a new one.');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var pw = document.getElementById('rpPw').value, pw2 = document.getElementById('rpPw2').value;
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return fail('Use at least 8 characters, including a letter and a number.');
    if (pw !== pw2) return fail('The two passwords don\u2019t match.');
    // Password reset by email link is not yet available on the production backend.
    // Show a truthful message instead of calling an endpoint that does not exist.
    fail('Password reset via email is not yet available. Please email support@paklance.com and we\u2019ll reset your password within one business day.');
  });
})();
