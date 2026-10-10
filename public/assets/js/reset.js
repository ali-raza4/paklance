/* Password reset page: /reset-password?token=… (link from the reset email).
   Validates token with backend, handles password visibility toggle,
   validates password complexity, and posts to /api/auth/reset-password. */
(function () {
  var form = document.getElementById('resetForm');
  var err = document.getElementById('rpErr');
  var submitBtn = document.getElementById('rpSubmitBtn');
  var invalidAction = document.getElementById('rpInvalidAction');
  var resetDone = document.getElementById('resetDone');
  var accountBadge = document.getElementById('rpAccountBadge');
  var userEmail = document.getElementById('rpUserEmail');
  var pwInput = document.getElementById('rpPw');
  var pw2Input = document.getElementById('rpPw2');

  var token = (new URLSearchParams(location.search).get('token') || '').trim();

  function fail(msg, isFatal) {
    err.textContent = msg;
    err.hidden = false;
    if (isFatal) {
      if (submitBtn) submitBtn.disabled = true;
      if (pwInput) pwInput.disabled = true;
      if (pw2Input) pw2Input.disabled = true;
      if (invalidAction) invalidAction.hidden = false;
    }
  }

  function clearErr() {
    err.textContent = '';
    err.hidden = true;
  }

  // Eye toggle handlers
  document.querySelectorAll('[data-pa-eye]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-pa-eye');
      var input = document.getElementById(targetId);
      if (!input) return;
      var isPw = input.type === 'password';
      input.type = isPw ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(isPw));
      btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
    });
  });

  // Check token existence
  if (!token) {
    fail('This password reset link is incomplete or missing. Please open the full link from your email, or request a new one.', true);
    return;
  }

  // Pre-validate token with backend
  fetch('/api/auth/verify-reset-token?token=' + encodeURIComponent(token))
    .then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(data.message || 'This password reset link is invalid or has expired.');
        }
        return data;
      });
    })
    .then(function (data) {
      if (data && data.email && userEmail && accountBadge) {
        userEmail.textContent = 'Resetting password for: ' + data.email;
        accountBadge.style.display = 'block';
      }
    })
    .catch(function (e) {
      fail(e.message || 'This reset link has expired or is invalid. Please request a new one.', true);
    });

  // Handle submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErr();

    var pw = pwInput.value;
    var pw2 = pw2Input.value;

    if (!pw || pw.length < 8) {
      return fail('Password must be at least 8 characters long.');
    }
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      return fail('Password must contain at least one letter and one number.');
    }
    if (pw !== pw2) {
      return fail('The two passwords do not match. Please re-enter them.');
    }

    submitBtn.disabled = true;
    var originalText = submitBtn.textContent;
    submitBtn.textContent = 'Updating password…';

    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: token,
        newPassword: pw,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error(data.message || 'Failed to reset password. Please try again.');
          }
          return data;
        });
      })
      .then(function () {
        form.hidden = true;
        resetDone.hidden = false;
      })
      .catch(function (err) {
        fail(err.message || 'An unexpected error occurred. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      });
  });
})();

