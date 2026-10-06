/* Password reset page: /reset-password?token=… (link from the reset email). */
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
    if (pw !== pw2) return fail('The two passwords don’t match.');
    var btn = form.querySelector('button'); btn.disabled = true;
    fetch('/api/auth/reset-password', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, password: pw })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok) throw new Error(d.message || 'Something went wrong. Please try again.');
        form.hidden = true; document.getElementById('resetDone').hidden = false;
      });
    }).catch(function (e2) { fail(e2.message); }).then(function () { btn.disabled = false; });
  });
})();
