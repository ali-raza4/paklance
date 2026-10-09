/* ===== PAKLANCE AUTH MODULE: JS START =====
   Frontend for the new sign up / log in flow:
     Google  → choose account → signing in → full name → skills → account created → dashboard
     Email   → email + password → verify 6-digit code → full name → skills → account created → dashboard
   Full name and skills are mandatory (no "Skip for now"). Returning users with a complete
   profile go straight to the dashboard; anyone with an unfinished profile resumes at the missing step.

   Public API
     PaklanceAuth.init(options)   options: { mock, apiBase, googleClientId, notify(msg), onFinish(user, info), resendCooldown, maxSkills }
     PaklanceAuth.open('signup' | 'login')
     PaklanceAuth.editSkills()    re-opens the skills step to edit (used on the dashboard)
     PaklanceAuth.logOut()        → Promise
     PaklanceAuth.getUser()       → user | null
     PaklanceAuth.onChange(fn)    fn(user | null) on every sign in / profile update / log out
     PaklanceAuth.isOpen()
     PaklanceAuth.profile.*       load / saveIntro / addItem / removeItem / saveVideo / uploadVideo / savePhoto / removePhoto — dashboard and profile page
     PaklanceAuth.seminars.*      list / register — free seminars on recording a video introduction

   BACKEND: call init({ mock: false, apiBase: '/api', googleClientId: '…' }) and implement the
   endpoints used by RealAPI below. Full request/response contract is in README.md.
*/
window.PaklanceAuth = (function () {
  'use strict';

  var CONFIG = { mock: true, apiBase: '/api', googleClientId: '1060835632727-nbba09rr2dl8c7bmib2da82vqbf9n3gv.apps.googleusercontent.com', resendCooldown: 30, maxSkills: 15 };

  /* ---------- Skills catalogue (users can also add custom skills) ---------- */
  var SKILL_GROUPS = {
    'Development': ['Web Development', 'Frontend Development', 'Backend Development', 'Mobile App Development', 'React', 'Node.js', 'WordPress', 'Shopify', 'Python', 'Laravel', 'Flutter', 'QA Testing'],
    'Design': ['Graphic Design', 'UI/UX Design', 'Logo Design', 'Brand Identity', 'Packaging Design', 'Illustration', 'Figma'],
    'Marketing': ['Digital Marketing', 'SEO', 'Social Media Marketing', 'Google Ads', 'Meta Ads', 'Email Marketing'],
    'Writing': ['Content Writing', 'Copywriting', 'Urdu Writing', 'Urdu–English Translation', 'Technical Writing', 'Proofreading'],
    'Video': ['Video Editing', 'Motion Graphics', '2D Animation', 'YouTube Editing'],
    'Business & Support': ['Data Entry', 'Virtual Assistance', 'Data Analysis', 'Bookkeeping', 'Customer Support']
  };
  var POPULAR = ['Web Development', 'Graphic Design', 'Content Writing', 'Digital Marketing', 'UI/UX Design', 'Video Editing', 'SEO', 'Mobile App Development'];
  var ALL_SKILLS = [];
  Object.keys(SKILL_GROUPS).forEach(function (g) { SKILL_GROUPS[g].forEach(function (s) { ALL_SKILLS.push({ name: s, group: g }); }); });

  function apiError(code, message) { var e = new Error(message); e.code = code; return e; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* =====================================================================
     REAL BACKEND  (used when init({ mock: false }))
     Every call resolves with the JSON body, or rejects with { code, message }.
     ===================================================================== */
  /* ---------- JWT token storage (production NestJS uses Bearer tokens) ---------- */
  var TOKEN_KEY = 'pk_access_token';
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function clearToken() { setToken(null); }

  /* ---------- normalise a user object (Express backend shape) to the shape the UI expects ---------- */
  function normaliseUser(u) {
    if (!u) return null;
    return {
      id:            u.id,
      email:         u.email,
      // Express backend returns fullName directly; NestJS returned name
      fullName:      u.fullName || u.name || null,
      // Express backend returns skills as a parsed array (via present.user)
      skills:        Array.isArray(u.skills) ? u.skills : [],
      // Express backend returns emailVerified; NestJS returned isEmailVerified
      emailVerified: !!(u.emailVerified !== undefined ? u.emailVerified : (u.isEmailVerified !== undefined ? u.isEmailVerified : true)),
      provider:      u.provider || 'email',
      // Express backend returns memberSince already as YYYY-MM-DD
      memberSince:   u.memberSince || (u.createdAt ? String(u.createdAt).slice(0, 10) : null),
      photo:         u.photo || u.avatarUrl || null,
      role:          u.role || 'member'
    };
  }

  function request(method, path, body) {
    // Inject JWT Bearer token for authenticated requests
    var headers = {};
    var tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return fetch(CONFIG.apiBase + path, {
      method: method,
      headers: headers,
      body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          // 401 means token expired/invalid — clear it
          if (res.status === 401) clearToken();
          var e = apiError(data.code || 'SERVER_ERROR', data.message || 'Something went wrong. Please try again.');
          if (data.fields) e.fields = data.fields;
          throw e;
        }
        return data;
      });
    }, function () {
      throw apiError('NETWORK', 'Can’t reach Paklance right now. Check your connection and try again.');
    });
  }

  // XHR helper used for video upload — injects Bearer token
  function xhrUpload(path, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', CONFIG.apiBase + path);
      var tok = getToken();
      if (tok) x.setRequestHeader('Authorization', 'Bearer ' + tok);
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var d = {}; try { d = JSON.parse(x.responseText || '{}'); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(d);
        else if (x.status === 413) reject(apiError('TOO_LARGE', 'The video is too large to upload. Please compress it and try again.'));
        else if (x.status === 504 || x.status === 502) reject(apiError('SERVER_ERROR', 'The upload timed out. Please try again.'));
        else reject(apiError(d.code || 'SERVER_ERROR', d.message || d.error || 'Upload failed. Please try again.'));
      };
      x.onerror = function () { reject(apiError('NETWORK', 'Can’t reach Paklance right now. Check your connection and try again.')); };
      x.send(formData);
    });
  }

  // Google sign-in: Google's own account chooser opens in a pop-up (Google Identity Services, authorization-code
  // flow). The one-time code is exchanged and the ID token verified on the server (POST /auth/google { code }).
  // The page loads https://accounts.google.com/gsi/client when GOOGLE_CLIENT_ID is configured.
  function getGoogleAuth() {
    return new Promise(function (resolve, reject) {
      var clientId = CONFIG.googleClientId || '1060835632727-nbba09rr2dl8c7bmib2da82vqbf9n3gv.apps.googleusercontent.com';
      if (!clientId) {
        return reject(apiError('GOOGLE_UNAVAILABLE', 'Google sign-in isn’t available right now. Try again, or continue with email.'));
      }
      function proceed() {
        var oauth2 = window.google && window.google.accounts && window.google.accounts.oauth2;
        if (!oauth2) return reject(apiError('GOOGLE_UNAVAILABLE', 'Google sign-in isn’t available right now. Try again, or continue with email.'));
        try {
          var client = oauth2.initCodeClient({
            client_id: clientId,
            scope: 'openid email profile',
            ux_mode: 'popup',
            callback: function (r) { if (r && r.code) resolve({ code: r.code }); else reject(apiError('GOOGLE_CANCELLED', 'Google sign-in was cancelled.')); },
            error_callback: function (err) {
              var msg = (err && (err.type === 'popup_failed_to_open' || err.message === 'popup_failed_to_open'))
                ? 'Pop-up was blocked. Please allow pop-ups for Paklance in your browser settings and try again.'
                : 'Google sign-in was closed. Try again, or continue with email.';
              reject(apiError('GOOGLE_CANCELLED', msg));
            }
          });
          client.requestCode();   // called straight from the click, so pop-up blockers allow it
        } catch (e) {
          reject(apiError('GOOGLE_ERROR', (e && e.message) || 'Failed to start Google sign-in.'));
        }
      }
      var oauth2 = window.google && window.google.accounts && window.google.accounts.oauth2;
      if (oauth2) {
        proceed();
        return;
      }
      if (typeof document !== 'undefined') {
        var s = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        if (s) {
          s.addEventListener('load', proceed, { once: true });
          setTimeout(function () {
            if (!(window.google && window.google.accounts && window.google.accounts.oauth2)) {
              reject(apiError('GOOGLE_UNAVAILABLE', 'Google sign-in isn’t available right now. Try again, or continue with email.'));
            }
          }, 4000);
          return;
        }
      }
      proceed();
    });
  }

  // Upcoming seminars shown locally (production backend has no seminar endpoint yet)
  function nextAt(weekday, hour, weeksLater) {
    var pk = new Date(Date.now() + 5 * 3600000), d = new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + (((weekday - d.getUTCDay() + 7) % 7) || 7) + 7 * (weeksLater || 0));
    return new Date(d.getTime() + (hour - 5) * 3600000).toISOString();
  }
  var SAMPLE_SEMINARS = [
    { id: 'sem-phone', title: 'Record your video introduction on your phone', mode: 'Online', place: 'Live on Zoom', startsAt: nextAt(6, 19, 0), minutes: 60, seats: 100, taken: 58, seatsLeft: 42, registered: false,
      about: 'Light, sound, framing and a simple script. Bring your phone: you’ll record a practice take during the session.', sample: true },
    { id: 'sem-isb', title: 'Video introduction workshop: record on the spot', mode: 'In person', place: 'Islamabad · venue details are emailed after you register', startsAt: nextAt(0, 11, 1), minutes: 120, seats: 30, taken: 21, seatsLeft: 9, registered: false,
      about: 'Our team helps you plan what to say and records your video with proper lighting. You leave with a finished clip.', sample: true },
    { id: 'sem-script', title: 'Write your 60-second script (English and Urdu)', mode: 'Online', place: 'Live on Google Meet', startsAt: nextAt(3, 20, 1), minutes: 45, seats: 100, taken: 17, seatsLeft: 83, registered: false,
      about: 'Turn your skills and best project into a short, natural script, with examples in both languages.', sample: true }
  ];
  var _seminarRegs = {}; // track registrations in-session

  var RealAPI = {
    // Restore session: GET /api/me — Express uses cookie-based sessions (same-origin fetch includes cookies)
    me: function () {
      return request('GET', '/me').then(function (r) {
        // Express /api/me returns { user: {...} } where user follows present.user() shape
        var u = r && (r.user || r);
        if (!u || !u.id) return { user: null };
        var norm = normaliseUser(u);
        if (norm && !isClientUser(norm) && (!norm.skills || !norm.skills.length)) {
          return RealAPI.getProfile().then(function (p) {
            if (p && p.profile && Array.isArray(p.profile.skills) && p.profile.skills.length) {
              norm.skills = p.profile.skills.slice();
            }
            return { user: norm };
          }).catch(function () { return { user: norm }; });
        }
        return { user: norm };
      }).catch(function () { return { user: null }; });
    },

    // Google sign-in: POST /api/auth/google { code | credential }
    googleSignIn: function () {
      return getGoogleAuth().then(function (body) { return request('POST', '/auth/google', body); })
        .then(function (r) {
          // Express returns { user } with cookie session — no accessToken
          if (r.accessToken) setToken(r.accessToken);
          var u = normaliseUser(r.user);
          if (u && !isClientUser(u) && (!u.skills || !u.skills.length)) {
            return RealAPI.getProfile().then(function (p) {
              if (p && p.profile && Array.isArray(p.profile.skills) && p.profile.skills.length) {
                u.skills = p.profile.skills.slice();
                RealAPI.saveSkills(u.skills).catch(function () {});
              }
              return { user: u };
            }).catch(function () { return { user: u }; });
          }
          return { user: u };
        });
    },

    // POST /api/auth/signup  — Express endpoint name
    emailSignUp: function (email, password) {
      return request('POST', '/auth/signup', { email: email, password: password })
        .then(function (r) {
          // Express returns { pendingVerification: true }
          return { pendingVerification: true, email: r.email || email };
        });
    },

    // POST /api/auth/verify-email  — Express endpoint, uses 'code' field
    verifyEmail: function (email, code) {
      return request('POST', '/auth/verify-email', { email: email, code: code })
        .then(function (r) {
          // Express returns { user } with cookie session set — no accessToken
          if (r.accessToken) setToken(r.accessToken);
          return { user: normaliseUser(r.user) };
        });
    },

    // POST /api/auth/resend-code  — Express endpoint name
    resendCode: function (email) {
      return request('POST', '/auth/resend-code', { email: email })
        .then(function () { return { ok: true }; });
    },

    // POST /api/auth/login  — Express endpoint, returns { user } with cookie session
    emailLogIn: function (email, password) {
      return request('POST', '/auth/login', { email: email, password: password })
        .then(function (r) {
          // Express backend: pendingVerification path
          if (r.pendingVerification) return { pendingVerification: true };
          // Express returns { user } — no accessToken (cookie-based session)
          if (r.accessToken) setToken(r.accessToken);
          var u = normaliseUser(r.user);
          if (u && !isClientUser(u) && (!u.skills || !u.skills.length)) {
            return RealAPI.getProfile().then(function (p) {
              if (p && p.profile && Array.isArray(p.profile.skills) && p.profile.skills.length) {
                u.skills = p.profile.skills.slice();
                RealAPI.saveSkills(u.skills).catch(function () {});
              }
              return { user: u };
            }).catch(function () { return { user: u }; });
          }
          return { user: u };
        });
    },

    // Password reset: POST /api/auth/forgot-password
    requestPasswordReset: function (email) {
      return request('POST', '/auth/forgot-password', { email: email })
        .then(function () { return { ok: true }; })
        .catch(function () {
          return Promise.reject(apiError(
            'NOT_AVAILABLE',
            'Password reset by email is not yet available. Please contact support@paklance.com to reset your password.'
          ));
        });
    },

    // PATCH /api/me  — saves fullName field (Express uses fullName, not name)
    saveFullName: function (fullName) {
      return request('PATCH', '/me', { fullName: fullName })
        .then(function (r) { return { user: normaliseUser(r.user || r) }; });
    },

    // PATCH /api/me  — saves skills array
    saveSkills: function (skills) {
      return request('PATCH', '/me', { skills: skills })
        .then(function (r) { return { user: normaliseUser(r.user || r) }; });
    },

    // Logout: POST /api/auth/logout destroys the server-side session cookie
    logOut: function () {
      return request('POST', '/auth/logout', null)
        .catch(function () { return { ok: true }; })
        .then(function () { clearToken(); return { ok: true }; });
    },

    // GET /api/me/profile  — returns my public profile + portfolio items + video
    getProfile: function () {
      return request('GET', '/me/profile').then(function (r) {
        // Express/NestJS returns { profile, items, video, ... }
        // profile may be null if not created yet
        var p = r.profile || {};
        return {
          profile: r.profile ? {
            headline:     p.headline || null,
            bio:          p.bio || null,
            hourlyRate:   p.hourly_rate || p.hourlyRate || null,
            availability: p.availability || null,
            city:         p.city || null,
            country:      p.country || null
          } : null,
          items: Array.isArray(r.items) ? r.items : (Array.isArray(r.portfolioItems) ? r.portfolioItems : []),
          video: r.video || null
        };
      }).catch(function () {
        return { profile: null, items: [], video: null };
      });
    },

    // PUT /api/me/profile  — create/update public profile (headline, city, category, hourlyRate, availability, bio, country, name)
    saveIntro: function (data) {
      var payload = {};
      if (data.headline     !== undefined) payload.headline     = data.headline;
      if (data.bio          !== undefined) payload.bio          = data.bio;
      if (data.hourlyRate   !== undefined) payload.hourly_rate  = Number(data.hourlyRate);
      if (data.availability !== undefined) payload.availability = data.availability;
      if (data.city         !== undefined) payload.city         = data.city;
      if (data.country      !== undefined) payload.country      = data.country;
      if (data.category     !== undefined) payload.category     = data.category;
      if (data.fullName     !== undefined) payload.fullName     = data.fullName;
      if (data.name         !== undefined) payload.name         = data.name;
      if (data.skills       !== undefined) payload.skills       = data.skills;
      return request('PUT', '/me/profile', payload)
        .then(function (r) { return { profile: r.profile || r }; });
    },

    // POST /api/me/profile/items  — add a portfolio/education/experience/etc item
    addProfileItem: function (item) {
      return request('POST', '/me/profile/items', item)
        .then(function (r) { return { item: r.item || r }; });
    },

    // DELETE /api/me/profile/items/:id
    removeProfileItem: function (id) {
      return request('DELETE', '/me/profile/items/' + encodeURIComponent(id))
        .then(function () { return { ok: true }; });
    },

    // Video link save: PUT /api/me/profile/video { url }
    saveVideo: function (url, extra) {
      var body = (extra && typeof extra === 'object') ? Object.assign({}, extra, { url: url || null }) : { url: url || null };
      return request('PUT', '/me/profile/video', body)
        .then(function (r) { return { video: r.video || null }; })
        .catch(function () { return { video: url ? { url: url } : null }; });
    },

    // Video file upload: direct browser-to-object-storage upload with fallback & auto-token refresh
    uploadVideo: function (file, meta, onProgress) {
      var duration = meta && meta.duration ? Math.round(meta.duration) : null;
      function performUpload(isRetry) {
        return request('POST', '/me/profile/video/upload-token', {
          pathname: file.name || 'video.mp4',
          duration: duration,
          size: file.size,
          type: file.type || 'video/mp4'
        }).then(function (tokenRes) {
          if (tokenRes && tokenRes.method === 'direct-blob' && tokenRes.uploadUrl && tokenRes.clientToken) {
            return new Promise(function (resolve, reject) {
              var x = new XMLHttpRequest();
              x.open('PUT', tokenRes.uploadUrl);
              x.setRequestHeader('Authorization', 'Bearer ' + tokenRes.clientToken);
              x.setRequestHeader('x-api-version', '12');
              x.setRequestHeader('x-vercel-blob-access', 'public');
              x.setRequestHeader('content-type', file.type || 'video/mp4');
              x.upload.onprogress = function (e) {
                if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
              };
              x.onload = function () {
                var d = {}; try { d = JSON.parse(x.responseText || '{}'); } catch (e) {}
                if (x.status >= 200 && x.status < 300 && d.url) {
                  // Step 2: Save permanent CDN URL and metadata into user profile DB
                  request('PUT', '/me/profile/video', {
                    kind: 'upload',
                    url: d.url,
                    name: file.name || 'video.mp4',
                    size: file.size,
                    type: file.type || 'video/mp4',
                    duration: duration
                  }).then(function (saveRes) {
                    resolve({ video: saveRes.video || null });
                  }).catch(function (saveErr) {
                    reject(apiError(saveErr && saveErr.code || 'SERVER_ERROR', (saveErr && saveErr.message) || 'Video uploaded, but failed to save to profile. Please try again.'));
                  });
                } else if (!isRetry && (x.status === 403 || x.status === 401 || (d.error && /token.*expired/i.test(d.error.message || '')))) {
                  // Auto-retry with fresh token if expired
                  performUpload(true).then(resolve).catch(reject);
                } else if (x.status === 413) {
                  reject(apiError('TOO_LARGE', 'The video is too large to upload. Please compress it and try again.'));
                } else {
                  var errMsg = (d.error && d.error.message) || 'Upload failed. Please try again.';
                  if (/token.*expired/i.test(errMsg)) errMsg = 'Upload session expired. Please try again.';
                  reject(apiError(d.error && d.error.code || 'SERVER_ERROR', errMsg));
                }
              };
              x.onerror = function () {
                reject(apiError('NETWORK', 'Can’t reach upload storage. Check your connection and try again.'));
              };
              x.send(file);
            });
          }
          var f = new FormData();
          f.append('video', file, file.name || 'video.mp4');
          if (duration) f.append('duration', String(duration));
          return xhrUpload('/me/profile/video/upload', f, onProgress)
            .then(function (r) { return { video: r.video || null }; });
        }).catch(function (err) {
          if (err && (err.code === 'NOT_FOUND' || err.status === 404)) {
            var f = new FormData();
            f.append('video', file, file.name || 'video.mp4');
            if (duration) f.append('duration', String(duration));
            return xhrUpload('/me/profile/video/upload', f, onProgress)
              .then(function (r) { return { video: r.video || null }; });
          }
          throw err;
        });
      }
      return performUpload(false);
    },

    // Photo upload: POST /api/me/photo (multipart, field name 'photo')
    savePhoto: function (blob) {
      var f = new FormData();
      f.append('photo', blob, 'photo.jpg');
      return request('POST', '/me/photo', f)
        .then(function (r) { return { user: normaliseUser(r.user || r) }; });
    },

    // Remove photo: DELETE /api/me/photo
    removePhoto: function () {
      return request('DELETE', '/me/photo', null)
        .then(function (r) { return { user: normaliseUser(r.user || r) }; });
    },

    // Seminars: production backend has no seminar endpoint yet.
    // Return locally-defined upcoming seminar schedule.
    listSeminars: function () {
      var seminars = SAMPLE_SEMINARS.map(function (s) {
        return Object.assign({}, s, { registered: !!_seminarRegs[s.id] });
      });
      return Promise.resolve({ seminars: seminars });
    },

    // Seminar registration: stored in-session only (no production endpoint)
    registerSeminar: function (id) {
      var s = SAMPLE_SEMINARS.filter(function (x) { return x.id === id; })[0];
      if (!s) return Promise.reject(apiError('NOT_FOUND', 'This seminar is no longer available.'));
      _seminarRegs[id] = true;
      return Promise.resolve({ seminar: Object.assign({}, s, { registered: true, seatsLeft: Math.max(0, s.seatsLeft - 1) }) });
    }
  };

  /* =====================================================================
     MOCK BACKEND  (preview only — delete once the real API is live)
     Code is always 123456. Demo login: demo@paklance.com / Paklance123
     ===================================================================== */
  var db = {
    users: { 'demo@paklance.com': { id: 'u_demo', email: 'demo@paklance.com', password: 'Paklance123', fullName: 'Demo User', skills: ['Web Development', 'React'], emailVerified: true, provider: 'email', memberSince: '2026-09-01' } },
    pending: {},
    current: null
  };
  function today() { return new Date().toISOString().slice(0, 10); }
  function pub(u) { return u ? { id: u.id, email: u.email, fullName: u.fullName, skills: u.skills.slice(), emailVerified: u.emailVerified, provider: u.provider, memberSince: u.memberSince || null, photo: u.photo || null, role: u.role || 'member' } : null; }

  // Sample seminars on recording a video introduction, always a few days ahead (times are Pakistan time, UTC+5).
  function nextAt(weekday, hour, weeksLater) {
    var pk = new Date(Date.now() + 5 * 3600000), d = new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + (((weekday - d.getUTCDay() + 7) % 7) || 7) + 7 * (weeksLater || 0));
    return new Date(d.getTime() + (hour - 5) * 3600000).toISOString();
  }
  var SEMINARS = [
    { id: 'sem-phone', title: 'Record your video introduction on your phone', mode: 'Online', place: 'Live on Zoom', startsAt: nextAt(6, 19, 0), minutes: 60, seats: 100, taken: 58,
      about: 'Light, sound, framing and a simple script. Bring your phone: you’ll record a practice take during the session.', sample: true },
    { id: 'sem-isb', title: 'Video introduction workshop: record on the spot', mode: 'In person', place: 'Islamabad · venue details are emailed after you register', startsAt: nextAt(0, 11, 1), minutes: 120, seats: 30, taken: 21,
      about: 'Our team helps you plan what to say and records your video with proper lighting. You leave with a finished clip.', sample: true },
    { id: 'sem-script', title: 'Write your 60-second script (English and Urdu)', mode: 'Online', place: 'Live on Google Meet', startsAt: nextAt(3, 20, 1), minutes: 45, seats: 100, taken: 17,
      about: 'Turn your skills and best project into a short, natural script, with examples in both languages.', sample: true }
  ];
  function seminarFor(u, s) { return Object.assign({}, s, { seatsLeft: s.seats - s.taken, registered: !!(u && u.seminars && u.seminars.indexOf(s.id) > -1) }); }
  function dropVideo(u) { if (u && u.video && /^blob:/.test(u.video.url || '')) URL.revokeObjectURL(u.video.url); }
  function me() { var u = db.users[db.current]; if (!u) throw apiError('UNAUTHENTICATED', 'Your session has ended. Please log in again.'); return u; }
  var MockAPI = {
    me: function () { return wait(80).then(function () { return { user: pub(db.users[db.current]) }; }); },
    googleSignIn: function (account) {
      return wait(1400).then(function () {
        var u = db.users[account.email];
        if (!u) { u = { id: 'u_' + Date.now(), email: account.email, fullName: null, skills: [], emailVerified: true, provider: 'google', memberSince: today() }; db.users[account.email] = u; }
        db.current = u.email; return { user: pub(u) };
      });
    },
    emailSignUp: function (email, password) {
      return wait(800).then(function () {
        if (db.users[email]) throw apiError('EMAIL_TAKEN', 'An account with this email already exists.');
        db.pending[email] = { password: password, code: '123456' }; return { pendingVerification: true };
      });
    },
    verifyEmail: function (email, code) {
      return wait(700).then(function () {
        var p = db.pending[email];
        if (!p) throw apiError('NOT_FOUND', 'We couldn’t find a sign up for this email. Please sign up again.');
        if (code !== p.code) throw apiError('INVALID_CODE', 'That code isn’t right. Check your email and try again.');
        var u = { id: 'u_' + Date.now(), email: email, password: p.password, fullName: null, skills: [], emailVerified: true, provider: 'email', memberSince: today() };
        db.users[email] = u; delete db.pending[email]; db.current = email; return { user: pub(u) };
      });
    },
    resendCode: function () { return wait(600).then(function () { return { ok: true }; }); },
    emailLogIn: function (email, password) {
      return wait(800).then(function () {
        var u = db.users[email];
        if (!u) { var p = db.pending[email]; if (p && p.password === password) return { pendingVerification: true }; throw apiError('INVALID_CREDENTIALS', 'Email or password is incorrect.'); }
        if (!u.password) throw apiError('USE_GOOGLE', 'This account signs in with Google. Use “Continue with Google” instead.');
        if (u.password !== password) throw apiError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
        db.current = email; return { user: pub(u) };
      });
    },
    requestPasswordReset: function () { return wait(700).then(function () { return { ok: true }; }); },
    saveFullName: function (fullName) { return wait(450).then(function () { var u = me(); u.fullName = fullName; return { user: pub(u) }; }); },
    saveSkills: function (skills) { return wait(450).then(function () { var u = me(); u.skills = skills.slice(); return { user: pub(u) }; }); },
    logOut: function () { return wait(150).then(function () { db.current = null; return { ok: true }; }); },
    getProfile: function () { return wait(250).then(function () { var u = me(); return { profile: u.profile || null, items: (u.items || []).slice(), video: u.video || null }; }); },
    saveVideo: function (url) { return wait(450).then(function () { var u = me(); dropVideo(u); u.video = url ? { url: url } : null; return { video: u.video }; }); },
    // Preview: the file stays in this browser tab (an object URL). The live site stores it and returns a hosted URL.
    uploadVideo: function (file, meta, onProgress) {
      return new Promise(function (resolve) {
        var p = 0, t = setInterval(function () { p = Math.min(1, p + 0.07 + Math.random() * 0.06); if (onProgress) onProgress(p); if (p >= 1) { clearInterval(t); resolve(); } }, 120);
      }).then(function () { return wait(250); }).then(function () {
        var u = me(); dropVideo(u);
        u.video = { kind: 'upload', url: URL.createObjectURL(file), name: file.name, size: file.size, type: file.type || '', duration: (meta && meta.duration) || null };
        return { video: u.video };
      });
    },
    savePhoto: function (blob) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(apiError('UPLOAD_FAILED', 'We couldn’t save your photo. Please try again.')); };
        r.readAsDataURL(blob);
      }).then(function (url) { return wait(500).then(function () { var u = me(); u.photo = url; return { user: pub(u) }; }); });
    },
    removePhoto: function () { return wait(300).then(function () { var u = me(); u.photo = null; return { user: pub(u) }; }); },
    listSeminars: function () { return wait(300).then(function () { var u = db.users[db.current]; return { seminars: SEMINARS.map(function (s) { return seminarFor(u, s); }) }; }); },
    registerSeminar: function (id) {
      return wait(500).then(function () {
        var u = me(), s = SEMINARS.filter(function (x) { return x.id === id; })[0];
        if (!s) throw apiError('NOT_FOUND', 'This seminar isn’t available any more.');
        u.seminars = u.seminars || [];
        if (u.seminars.indexOf(id) < 0) { if (s.taken >= s.seats) throw apiError('FULL', 'This seminar is full. Please choose another date.'); u.seminars.push(id); s.taken++; }
        return { seminar: seminarFor(u, s) };
      });
    },
    saveIntro: function (data) { return wait(500).then(function () { var u = me(); u.profile = Object.assign({}, u.profile, data); return { profile: u.profile }; }); },
    addProfileItem: function (item) {
      return wait(450).then(function () {
        var u = me(); u.items = u.items || [];
        var saved = Object.assign({ id: 'pi_' + Date.now() + '_' + u.items.length }, item); u.items.push(saved);
        return { item: saved };
      });
    },
    removeProfileItem: function (id) { return wait(300).then(function () { var u = me(); u.items = (u.items || []).filter(function (x) { return x.id !== id; }); return { ok: true }; }); }
  };

  var API = MockAPI;

  /* =====================================================================
     UI
     ===================================================================== */
  var root, opts = {}, user = null, listeners = [];
  var state = { screen: null, stack: [], email: '', onboarding: false, mode: 'onboard', skills: [], items: [], active: -1, verifying: false, googleRun: 0, cooldown: 0, timer: null, lastFocus: null };
  var BACKABLE = { email: 1, google: 1, forgot: 1, 'forgot-sent': 1, skills: 1 };
  var MILESTONE = { signing: 1, verify: 1, name: 1, done: 1 };  // screens that reset back-history
  var LOCKED = { name: 1, skills: 1, signing: 1 };                // cannot be closed: name & skills are mandatory
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

  function $(s) { return root.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(root.querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function notify(msg) { if (opts.notify) opts.notify(msg); }
  function setUser(u) { user = u; listeners.forEach(function (fn) { fn(u); }); }
  function isClientUser(u) {
    if (!u) return false;
    var r = String(u.role || '').toLowerCase();
    return r === 'client';
  }
  function nextStep(u) {
    if (!u) return null;
    if (!u.emailVerified) return 'verify';
    if (!u.fullName) return 'name';
    if (isClientUser(u)) return null;
    if (!u.skills || !u.skills.length) return 'skills';
    return null;
  }
  function focusEl(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

  function show(screen, isBack) {
    if (!isBack && state.screen && state.screen !== screen) state.stack.push(state.screen);
    if (MILESTONE[screen]) state.stack = [];
    state.screen = screen;
    $$('.pa-screen').forEach(function (s) { s.hidden = s.getAttribute('data-screen') !== screen; });
    var sc = $('.pa-screen[data-screen="' + screen + '"]');
    var h = sc.querySelector('.pa-h');
    root.setAttribute('aria-labelledby', h.id);
    $('[data-pa-back]').hidden = !(BACKABLE[screen] && state.stack.length);
    $('[data-pa-close]').hidden = !!LOCKED[screen] && state.mode !== 'edit';
    if (screen === 'skills') renderSkills();
    var f = sc.querySelector('[data-pa-focus]') || h;
    setTimeout(function () { focusEl(f); }, 40);
  }
  function back() { var prev = state.stack.pop(); if (prev) show(prev, true); }

  function lock(on) { root.hidden = !on; document.body.style.overflow = on ? 'hidden' : ''; }

  function open(mode) {
    resetForms();
    state.stack = []; state.screen = null; state.mode = 'onboard'; state.onboarding = false;
    state.lastFocus = document.activeElement;
    lock(true);
    var step = nextStep(user);
    if (user && step) { state.onboarding = true; state.skills = (user.skills || []).slice(); show(step); return; } // resume unfinished profile
    show(mode === 'login' ? 'login' : 'choose');
  }
  function editSkills() {
    if (!user) { open('login'); return; }
    resetForms();
    state.stack = []; state.screen = null; state.mode = 'edit'; state.skills = user.skills.slice();
    state.lastFocus = document.activeElement;
    lock(true);
    show('skills');
  }
  function close(force) {
    if (root.hidden) return;
    if (!force && LOCKED[state.screen] && state.mode !== 'edit') return;
    if (!force && state.screen === 'done') { finish(); return; }
    if (state.screen === 'signing') state.googleRun++;
    clearInterval(state.timer);
    hideSuggest();
    lock(false);
    focusEl(state.lastFocus);
  }
  function finish() {
    close(true);
    if (opts.onFinish) opts.onFinish(user, { isNew: true });
  }

  function afterAuth(u) {
    setUser(u);
    var step = nextStep(u);
    if (step) { state.onboarding = true; if (step === 'skills') state.skills = (u.skills || []).slice(); show(step); return; }
    if (state.onboarding) { show('done'); return; }
    close(true);
    notify('Welcome back' + (u.fullName ? ', ' + u.fullName.split(' ')[0] : '') + '!');
    if (opts.onFinish) opts.onFinish(u, { isNew: false });
  }

  /* ---------- helpers: fields, alerts, busy buttons ---------- */
  function fieldError(input, msg) {
    var p = input.closest('.pa-field').querySelector('.pa-err');
    if (msg) { input.setAttribute('aria-invalid', 'true'); p.textContent = msg; p.hidden = false; input.setAttribute('aria-describedby', p.id); }
    else { input.removeAttribute('aria-invalid'); p.hidden = true; input.removeAttribute('aria-describedby'); }
  }
  function alertOn(screen, html) {
    var a = $('.pa-screen[data-screen="' + screen + '"] .pa-alert'); if (!a) return;
    a.innerHTML = html || ''; a.hidden = !html;
  }
  function busy(btn, on, label) {
    if (on) { btn.setAttribute('data-label', btn.textContent); btn.disabled = true; btn.innerHTML = '<span class="pa-spin-sm" aria-hidden="true"></span>' + esc(label); }
    else if (btn.hasAttribute('data-label')) { btn.disabled = false; btn.textContent = btn.getAttribute('data-label'); btn.removeAttribute('data-label'); }
  }
  function firstInvalid(form) { focusEl(form.querySelector('[aria-invalid="true"]')); }
  function resetForms() {
    $$('form').forEach(function (f) { f.reset(); });
    $$('.pa-field input').forEach(function (i) { fieldError(i); });
    $$('.pa-alert').forEach(function (a) { a.hidden = true; a.innerHTML = ''; });
    $$('[data-pa-eye]').forEach(function (b) { var i = document.getElementById(b.getAttribute('data-pa-eye')); if (i) i.type = 'password'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); });
    $('#paOtherForm').hidden = true;
    $('#paCustomForm').hidden = true; $('#paAddCustom').hidden = false;
    $('#paSkillErr').hidden = true; $('#paSkillQ').value = '';
    clearCode(); $('#paCodeErr').hidden = true; $('#paCode').classList.remove('is-error'); $('#paCodeStatus').textContent = '';
    paintRules();
  }

  /* ---------- Google ---------- */
  function startGoogle() {
    alertOn('choose', ''); alertOn('login', '');
    if (CONFIG.mock) { show('google'); return; }   // live site: Google shows its own account picker
    runGoogle();
  }
  function runGoogle(account) {
    var run = ++state.googleRun;
    show('signing');
    API.googleSignIn(account).then(function (res) {
      if (run !== state.googleRun) return;
      afterAuth(res.user);
    }).catch(function (err) {
      if (run !== state.googleRun) return;
      show('choose', true); alertOn('choose', esc(err.message));
    });
  }
  function onOtherAccount(e) {
    e.preventDefault();
    var inp = $('#paOtherEmail'), email = inp.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { fieldError(inp, 'Enter a valid email address.'); focusEl(inp); return; }
    fieldError(inp);
    runGoogle({ email: email });
  }

  /* ---------- Email sign up ---------- */
  function pwRules(pw) { return { len: pw.length >= 8, letter: /\p{L}/u.test(pw), num: /\d/.test(pw) }; }
  function paintRules() {
    var r = pwRules($('#paPw').value);
    $$('#paRules li').forEach(function (li) { li.classList.toggle('ok', !!r[li.getAttribute('data-rule')]); });
  }
  function onEmailSignup(e) {
    e.preventDefault();
    var f = e.target, em = $('#paEmail'), p1 = $('#paPw'), p2 = $('#paPw2');
    var email = em.value.trim().toLowerCase(), pw = p1.value, pw2 = p2.value, r = pwRules(pw);
    alertOn('email', '');
    fieldError(em, EMAIL_RE.test(email) ? '' : (email ? 'Enter a valid email address, like name@example.com.' : 'Enter your email address.'));
    fieldError(p1, (r.len && r.letter && r.num) ? '' : 'Use at least 8 characters, including a letter and a number.');
    fieldError(p2, (pw2 && pw2 === pw) ? '' : (pw2 ? 'Passwords don’t match.' : 'Confirm your password.'));
    if (f.querySelector('[aria-invalid="true"]')) { firstInvalid(f); return; }
    var btn = f.querySelector('[type="submit"]'); busy(btn, true, 'Creating account…');
    API.emailSignUp(email, pw).then(function () {
      state.email = email; state.onboarding = true;
      $('#paVerifyEmail').textContent = email;
      clearCode(); $('#paCodeErr').hidden = true; $('#paCodeStatus').textContent = '';
      show('verify'); startCooldown();
    }).catch(function (err) {
      if (err.code === 'EMAIL_TAKEN') alertOn('email', esc(err.message) + ' <button type="button" class="pa-link" data-pa-go="login" data-pa-prefill="' + esc(email) + '">Log in instead</button>');
      else alertOn('email', esc(err.message));
    }).then(function () { busy(btn, false); });
  }

  /* ---------- Verification code ---------- */
  function codeInputs() { return $$('#paCode input'); }
  function clearCode() { codeInputs().forEach(function (i) { i.value = ''; }); }
  function setCodeDisabled(on) { codeInputs().forEach(function (i) { i.disabled = on; }); }
  function fillCode(v, start) {
    var cis = codeInputs();
    for (var k = 0; k < v.length && start + k < 6; k++) cis[start + k].value = v[k];
    focusEl(cis[Math.min(start + v.length, 5)]);
    codeChanged();
  }
  function codeChanged() {
    var code = codeInputs().map(function (i) { return i.value; }).join('');
    if (code.length && !$('#paCodeErr').hidden) { $('#paCodeErr').hidden = true; $('#paCode').classList.remove('is-error'); }
    if (code.length === 6 && !state.verifying) submitCode(code);
  }
  function submitCode(code) {
    state.verifying = true; setCodeDisabled(true);
    $('#paCodeStatus').textContent = 'Verifying…';
    var failed = false;
    API.verifyEmail(state.email, code).then(function (res) {
      $('#paCodeStatus').textContent = '';
      clearInterval(state.timer);
      afterAuth(res.user);
    }).catch(function (err) {
      failed = true;
      $('#paCodeStatus').textContent = '';
      var box = $('#paCode'); box.classList.remove('is-error'); void box.offsetWidth; box.classList.add('is-error');
      var p = $('#paCodeErr'); p.textContent = err.message; p.hidden = false;
      clearCode();
    }).then(function () {
      state.verifying = false; setCodeDisabled(false);
      if (failed && state.screen === 'verify') focusEl(codeInputs()[0]);
    });
  }
  function startCooldown() {
    clearInterval(state.timer); state.cooldown = CONFIG.resendCooldown; paintResend();
    state.timer = setInterval(function () { state.cooldown--; paintResend(); if (state.cooldown <= 0) clearInterval(state.timer); }, 1000);
  }
  function paintResend() {
    var b = $('#paResend');
    if (state.cooldown > 0) { b.disabled = true; b.textContent = 'Resend in 0:' + String(state.cooldown).padStart(2, '0'); }
    else { b.disabled = false; b.textContent = 'Resend'; }
  }
  function resend() {
    if (state.cooldown > 0) return;
    var b = $('#paResend'); b.disabled = true; b.textContent = 'Sending…';
    API.resendCode(state.email).then(function () {
      $('#paCodeStatus').textContent = 'We sent a new code to ' + state.email + '.';
      startCooldown();
    }).catch(function (err) { $('#paCodeStatus').textContent = err.message; b.disabled = false; b.textContent = 'Resend'; });
  }

  /* ---------- Log in / forgot password ---------- */
  function onLogin(e) {
    e.preventDefault();
    var f = e.target, em = $('#paLoginEmail'), pwEl = $('#paLoginPw');
    var email = em.value.trim().toLowerCase(), pw = pwEl.value;
    alertOn('login', '');
    fieldError(em, EMAIL_RE.test(email) ? '' : (email ? 'Enter a valid email address.' : 'Enter your email address.'));
    fieldError(pwEl, pw ? '' : 'Enter your password.');
    if (f.querySelector('[aria-invalid="true"]')) { firstInvalid(f); return; }
    var btn = f.querySelector('[type="submit"]'); busy(btn, true, 'Logging in…');
    API.emailLogIn(email, pw).then(function (res) {
      if (res.pendingVerification) {             // signed up earlier but never verified → backend sends a fresh code
        state.email = email; state.onboarding = true;
        $('#paVerifyEmail').textContent = email; clearCode();
        show('verify'); startCooldown();
        $('#paCodeStatus').textContent = 'Verify your email to finish signing up.';
        return;
      }
      afterAuth(res.user);
    }).catch(function (err) { alertOn('login', esc(err.message)); }).then(function () { busy(btn, false); });
  }
  function onForgot(e) {
    e.preventDefault();
    var f = e.target, em = $('#paForgotEmail'), email = em.value.trim().toLowerCase();
    alertOn('forgot', '');
    fieldError(em, EMAIL_RE.test(email) ? '' : (email ? 'Enter a valid email address.' : 'Enter your email address.'));
    if (f.querySelector('[aria-invalid="true"]')) { firstInvalid(f); return; }
    var btn = f.querySelector('[type="submit"]'); busy(btn, true, 'Sending…');
    API.requestPasswordReset(email).then(function () {
      $('#paResetEmail').textContent = email; show('forgot-sent');
    }).catch(function (err) { alertOn('forgot', esc(err.message)); }).then(function () { busy(btn, false); });
  }

  /* ---------- Full name ---------- */
  function onName(e) {
    e.preventDefault();
    var f = e.target, inp = $('#paName'), name = inp.value.replace(/\s+/g, ' ').trim();
    var letters = (name.match(/\p{L}/gu) || []).length;
    if (!name) { fieldError(inp, 'Please enter your full name.'); focusEl(inp); return; }
    if (!NAME_RE.test(name) || letters < 2) { fieldError(inp, 'Use letters only, for example Ayesha Khan.'); focusEl(inp); return; }
    fieldError(inp);
    var btn = f.querySelector('[type="submit"]'); busy(btn, true, 'Saving…');
    API.saveFullName(name).then(function (res) { afterAuth(res.user); })
      .catch(function (err) { fieldError(inp, err.message); })
      .then(function () { busy(btn, false); });
  }

  /* ---------- Skills ---------- */
  function has(name) { var n = name.toLowerCase(); return state.skills.some(function (s) { return s.toLowerCase() === n; }); }
  function skillErr(msg) { var p = $('#paSkillErr'); p.textContent = msg || ''; p.hidden = !msg; }
  function renderSkills() {
    $('#paSelected').innerHTML = state.skills.map(function (s, i) {
      return '<span class="pa-chip on">' + esc(s) + '<button type="button" data-pa-remove="' + i + '" aria-label="Remove ' + esc(s) + '">×</button></span>';
    }).join('');
    var pop = POPULAR.filter(function (s) { return !has(s); });
    $('#paPopular').innerHTML = pop.map(function (s) { return '<button type="button" class="pa-chip" data-pa-add-skill="' + esc(s) + '">+ ' + esc(s) + '</button>'; }).join('');
    $('#paPopularWrap').hidden = !pop.length || state.skills.length >= CONFIG.maxSkills;
    var n = state.skills.length;
    $('#paSkillCount').textContent = n ? (n + ' selected · up to ' + CONFIG.maxSkills) : 'Select at least 1 skill to continue.';
    var next = $('#paSkillsNext');
    next.setAttribute('aria-disabled', n ? 'false' : 'true');
    if (!next.disabled) next.textContent = state.mode === 'edit' ? 'Save skills' : 'Next';
    if (n) skillErr('');
  }
  function addSkill(name) {
    name = String(name).replace(/\s+/g, ' ').trim();
    if (!name) return false;
    if (has(name)) { renderSkills(); return true; }
    if (state.skills.length >= CONFIG.maxSkills) { skillErr('You can add up to ' + CONFIG.maxSkills + ' skills.'); return false; }
    var known = ALL_SKILLS.filter(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })[0];
    state.skills.push(known ? known.name : name);
    renderSkills(); return true;
  }
  function suggest() {
    var qv = $('#paSkillQ').value.replace(/\s+/g, ' ').trim(), ql = qv.toLowerCase(), list = $('#paSkillList');
    if (!qv) { hideSuggest(); return; }
    var items = ALL_SKILLS.filter(function (s) { return s.name.toLowerCase().indexOf(ql) > -1 && !has(s.name); }).slice(0, 6);
    var exact = ALL_SKILLS.some(function (s) { return s.name.toLowerCase() === ql; }) || has(qv);
    if (!exact && qv.length >= 2 && qv.length <= 40) items.push({ name: qv, custom: true });
    state.items = items; state.active = items.length ? 0 : -1;
    list.innerHTML = items.length ? items.map(function (it, i) {
      return '<li role="option" id="pa-opt-' + i + '" data-pa-opt="' + i + '"' + (it.custom ? ' class="custom"' : '') + '>' +
        (it.custom ? 'Add “' + esc(it.name) + '” as a custom skill' : '<span>' + esc(it.name) + '</span><small>' + esc(it.group) + '</small>') + '</li>';
    }).join('') : '<li class="pa-none">No matching skills</li>';
    list.hidden = false; $('#paSkillQ').setAttribute('aria-expanded', 'true');
    paintActive();
  }
  function paintActive() {
    $$('#paSkillList [data-pa-opt]').forEach(function (li, i) { var on = i === state.active; li.classList.toggle('active', on); li.setAttribute('aria-selected', on ? 'true' : 'false'); });
    var q = $('#paSkillQ');
    if (state.active > -1) q.setAttribute('aria-activedescendant', 'pa-opt-' + state.active); else q.removeAttribute('aria-activedescendant');
  }
  function hideSuggest() {
    if (!root) return;
    $('#paSkillList').hidden = true; state.active = -1;
    var q = $('#paSkillQ'); q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant');
  }
  function pick(i) {
    var it = state.items[i]; if (!it) return;
    if (addSkill(it.name)) { $('#paSkillQ').value = ''; hideSuggest(); }
    focusEl($('#paSkillQ'));
  }
  function onSkillKey(e) {
    var listOpen = !$('#paSkillList').hidden, n = state.items.length;
    if (e.key === 'ArrowDown' && listOpen && n) { e.preventDefault(); state.active = (state.active + 1) % n; paintActive(); }
    else if (e.key === 'ArrowUp' && listOpen && n) { e.preventDefault(); state.active = (state.active - 1 + n) % n; paintActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (listOpen && state.active > -1) pick(state.active); }
    else if (e.key === 'Escape' && listOpen) { e.preventDefault(); e.stopPropagation(); hideSuggest(); }
  }
  function onCustom(e) {
    e.preventDefault();
    var inp = $('#paCustomInput'), v = inp.value.replace(/\s+/g, ' ').trim();
    if (v.length < 2) { skillErr('Type a skill with at least 2 characters.'); focusEl(inp); return; }
    if (addSkill(v)) { inp.value = ''; $('#paCustomForm').hidden = true; $('#paAddCustom').hidden = false; focusEl($('#paAddCustom')); }
  }
  function submitSkills() {
    if (!state.skills.length) { skillErr('Choose at least one skill to continue.'); focusEl($('#paSkillQ')); return; }
    var btn = $('#paSkillsNext'); busy(btn, true, 'Saving…');
    API.saveSkills(state.skills.slice()).then(function (res) {
      busy(btn, false);
      if (state.mode === 'edit') { setUser(res.user); close(true); notify('Skills updated.'); return; }
      afterAuth(res.user);
    }).catch(function (err) { busy(btn, false); skillErr(err.message); });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    if (e.target === root) { close(); return; }
    var opt = e.target.closest('[data-pa-opt]'); if (opt) { pick(+opt.getAttribute('data-pa-opt')); return; }
    var t = e.target.closest('button'); if (!t || !root.contains(t) || t.type === 'submit') return;
    if (t.hasAttribute('data-pa-close')) { close(); return; }
    if (t.hasAttribute('data-pa-back')) { back(); return; }
    var go = t.getAttribute('data-pa-go');
    if (go) {
      if (go === 'google') { startGoogle(); return; }
      if (t.hasAttribute('data-pa-prefill')) $('#paLoginEmail').value = t.getAttribute('data-pa-prefill');
      if (go === 'forgot') $('#paForgotEmail').value = $('#paLoginEmail').value;
      if (go === 'login' || go === 'choose') { state.stack = []; alertOn(go, ''); show(go, true); return; }
      show(go); return;
    }
    if (t.hasAttribute('data-pa-account')) { runGoogle({ email: t.getAttribute('data-pa-account') }); return; }
    if (t.hasAttribute('data-pa-other')) { $('#paOtherForm').hidden = false; focusEl($('#paOtherEmail')); return; }
    if (t.hasAttribute('data-pa-eye')) {
      var inp = document.getElementById(t.getAttribute('data-pa-eye')), showPw = inp.type === 'password';
      inp.type = showPw ? 'text' : 'password';
      t.setAttribute('aria-pressed', String(showPw)); t.setAttribute('aria-label', showPw ? 'Hide password' : 'Show password');
      return;
    }
    if (t.hasAttribute('data-pa-cancel')) { state.googleRun++; show('choose', true); return; }
    if (t.hasAttribute('data-pa-finish')) { finish(); return; }
    if (t.hasAttribute('data-pa-doc')) { notify('The ' + t.textContent.trim() + ' will open here on the live site.'); return; }
    if (t.hasAttribute('data-pa-remove')) { state.skills.splice(+t.getAttribute('data-pa-remove'), 1); renderSkills(); focusEl($('#paSkillQ')); return; }
    if (t.hasAttribute('data-pa-add-skill')) { addSkill(t.getAttribute('data-pa-add-skill')); return; }
    if (t.id === 'paResend') { resend(); return; }
    if (t.id === 'paAddCustom') { t.hidden = true; $('#paCustomForm').hidden = false; focusEl($('#paCustomInput')); return; }
    if (t.id === 'paCustomCancel') { $('#paCustomForm').hidden = true; $('#paAddCustom').hidden = false; $('#paCustomInput').value = ''; return; }
    if (t.id === 'paSkillsNext') { submitSkills(); return; }
  }
  function onKey(e) {
    if (!root || root.hidden) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') {
      var f = Array.prototype.slice.call(root.querySelectorAll('button, input, [href]')).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); focusEl(first); }
    }
  }

  function init(o) {
    opts = o || {};
    if (opts.mock === false) CONFIG.mock = false;
    ['apiBase', 'googleClientId', 'resendCooldown', 'maxSkills'].forEach(function (k) { if (opts[k] != null) CONFIG[k] = opts[k]; });
    API = CONFIG.mock ? MockAPI : RealAPI;
    root = document.getElementById('paAuth');
    $$('.pa-err').forEach(function (p, i) { if (!p.id) p.id = 'pa-err-' + i; });
    $$('[data-pa-mock]').forEach(function (el) { el.hidden = !CONFIG.mock; });

    root.addEventListener('click', onClick);
    root.addEventListener('mousedown', function (e) { if (e.target.closest('[data-pa-opt]')) e.preventDefault(); });
    $('#paEmailForm').addEventListener('submit', onEmailSignup);
    $('#paLoginForm').addEventListener('submit', onLogin);
    $('#paForgotForm').addEventListener('submit', onForgot);
    $('#paNameForm').addEventListener('submit', onName);
    $('#paOtherForm').addEventListener('submit', onOtherAccount);
    $('#paCustomForm').addEventListener('submit', onCustom);
    $('#paPw').addEventListener('input', paintRules);
    $$('.pa-field input').forEach(function (inp) { inp.addEventListener('input', function () { if (inp.getAttribute('aria-invalid')) fieldError(inp); }); });

    var cis = codeInputs();
    cis.forEach(function (inp, i) {
      inp.addEventListener('input', function () {
        var v = inp.value.replace(/\D/g, '');
        if (v.length > 1) { fillCode(v, i); return; }
        inp.value = v;
        if (v && i < 5) focusEl(cis[i + 1]);
        codeChanged();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !inp.value && i > 0) { e.preventDefault(); cis[i - 1].value = ''; focusEl(cis[i - 1]); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); focusEl(cis[i - 1]); }
        else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); focusEl(cis[i + 1]); }
      });
      inp.addEventListener('paste', function (e) {
        var t = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\D/g, '');
        if (t) { e.preventDefault(); fillCode(t, 0); }
      });
      inp.addEventListener('focus', function () { inp.select(); });
    });

    var sq = $('#paSkillQ');
    sq.addEventListener('input', suggest);
    sq.addEventListener('keydown', onSkillKey);
    sq.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== sq) hideSuggest(); }, 120); });

    document.addEventListener('keydown', onKey);
    // Resolves once the existing session (if any) has been restored, so the page can route after it.
    // In mock mode, resolve immediately. In real mode, attempt session restore via stored JWT token.
    return CONFIG.mock ? Promise.resolve() : API.me().then(function (r) { if (r && r.user) setUser(r.user); }).catch(function () {});
  }

  return {
    init: init,
    open: open,
    editSkills: editSkills,
    // logOut clears the stored JWT token (stateless backend — no server-side session to destroy)
    logOut: function () { return API.logOut().catch(function () {}).then(function () { clearToken(); setUser(null); }); },
    getUser: function () { return user; },
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    isOpen: function () { return !!root && !root.hidden; },
    skillGroups: SKILL_GROUPS,
    // Profile data for the dashboard tracker (PaklanceProfile below). Each call → Promise.
    profile: {
      load: function () { return API.getProfile(); },                        // → { profile | null, items: [] }
      saveIntro: function (data) { return API.saveIntro(data); },            // → { profile }
      addItem: function (item) { return API.addProfileItem(item); },         // → { item }
      removeItem: function (id) { return API.removeProfileItem(id); },       // → { ok }
      saveVideo: function (url, extra) { return API.saveVideo(url, extra); },              // url or null to remove → { video }
      uploadVideo: function (file, meta, onProgress) { return API.uploadVideo(file, meta, onProgress); },   // video file → { video: { kind: 'upload', url, name, size, duration } }
      // Profile photo: a square JPEG (400×400) from the photo editor. Updates the signed-in user (user.photo).
      savePhoto: function (blob) { return API.savePhoto(blob).then(function (r) { setUser(r.user); return r; }); },
      removePhoto: function () { return API.removePhoto().then(function (r) { setUser(r.user); return r; }); }
    },
    // Free seminars on recording a video introduction
    seminars: {
      list: function () { return API.listSeminars(); },                     // → { seminars: [{ id, title, mode, place, startsAt, minutes, seatsLeft, registered, about }] }
      register: function (id) { return API.registerSeminar(id); }            // → { seminar }
    }
  };
})();

/* ===== PAKLANCE VIDEO =====
   Click-to-play players for video links from YouTube, Vimeo, Loom and Google Drive. Nothing loads from
   the video site until the viewer presses play (faster pages, no tracking before that).
     PaklanceVideo.parse(url)        → { provider, id, url, embed } | null (unsupported link)
     PaklanceVideo.fromSaved(video)  → the same shape for a saved profile video: a link, or { upload: true, url, name, duration } for a file
     PaklanceVideo.duration(sec)     → "1:05"
     PaklanceVideo.player(v, opts)   → HTML. v = parse() result, { sample: true, length } or null (coming soon)
*/
window.PaklanceVideo = (function () {
  'use strict';
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.8v12.4c0 .8.9 1.3 1.6.8l9.4-6.2a1 1 0 0 0 0-1.6L10.1 5c-.7-.5-1.6 0-1.6.8z"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function parse(url) {
    var s = String(url || '').trim(), m;
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    if (/\s/.test(s) || s.length > 300) return null;
    if ((m = s.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i)))
      return { provider: 'YouTube', id: m[1], url: s, embed: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?autoplay=1&rel=0' };
    if ((m = s.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?!\d)/i)))
      return { provider: 'Vimeo', id: m[1], url: s, embed: 'https://player.vimeo.com/video/' + m[1] + '?autoplay=1' };
    if ((m = s.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([a-f0-9]{16,40})(?![a-f0-9])/i)))
      return { provider: 'Loom', id: m[1], url: s, embed: 'https://www.loom.com/embed/' + m[1] + '?autoplay=1' };
    if ((m = s.match(/^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/i)))
      return { provider: 'Google Drive', id: m[1], url: s, embed: 'https://drive.google.com/file/d/' + m[1] + '/preview' };
    return null;
  }

  function fromSaved(v) {
    if (!v) return null;
    if (v.kind === 'upload') return { provider: 'Upload', upload: true, url: v.url, name: v.name || 'Video', duration: v.duration || null };
    return parse(v.url);
  }
  function duration(sec) { sec = Math.round(+sec || 0); return sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : ''; }

  function player(v, o) {
    o = o || {};
    var face = o.photo ? '<span class="pv-face" aria-hidden="true"><img src="' + esc(o.photo) + '" alt=""></span>'
      : o.initials ? '<span class="pv-face" aria-hidden="true">' + esc(o.initials) + '</span>' : '';
    if (!v || v.sample) {
      return '<div class="pv"><div class="pv-poster is-static">' + face + '<span class="pv-play">' + PLAY + '</span>' +
        '<span class="pv-cap">' + esc(v ? 'Intro video · ' + (v.length || '1:00') : (o.soon || 'Video coming soon')) + '</span></div></div>' +
        (v ? '<p class="pv-src">No video added yet.</p>' : '');
    }
    if (v.upload) {
      return '<div class="pv" data-pv-file="' + esc(v.url) + '" data-pv-title="' + esc(o.title || 'Video') + '">' +
        '<button type="button" class="pv-poster" data-pv-play aria-label="' + esc('Play ' + (o.title || 'video')) + '">' + face +
          '<span class="pv-play">' + PLAY + '</span><span class="pv-cap">' + esc(o.label || 'Play video') + '</span></button></div>' +
        '<p class="pv-src">Uploaded video' + (v.duration ? ' · ' + duration(v.duration) : '') + '</p>';
    }
    return '<div class="pv" data-pv-embed="' + esc(v.embed) + '" data-pv-title="' + esc(o.title || 'Video') + '">' +
      '<button type="button" class="pv-poster" data-pv-play aria-label="' + esc('Play ' + (o.title || 'video')) + '">' + face +
        '<span class="pv-play">' + PLAY + '</span><span class="pv-cap">' + esc(o.label || 'Play video') + '</span></button></div>' +
      '<p class="pv-src"><a href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer nofollow">Watch on ' + v.provider + ' ↗</a></p>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pv-play]'); if (!b) return;
    var box = b.closest('.pv'), file = box.getAttribute('data-pv-file');
    if (file) {
      box.innerHTML = '<video src="' + esc(file) + '" controls autoplay playsinline title="' + esc(box.getAttribute('data-pv-title')) + '"></video>';
      var vd = box.querySelector('video'); if (vd) vd.focus();
      return;
    }
    box.innerHTML = '<iframe src="' + esc(box.getAttribute('data-pv-embed')) + '" title="' + esc(box.getAttribute('data-pv-title')) + '" ' +
      'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    var f = box.querySelector('iframe'); if (f) f.focus();
  });

  return { parse: parse, fromSaved: fromSaved, duration: duration, player: player };
})();

/* ===== PAKLANCE PROFILE: completion tracker, profile page, video introduction =====
   1. Tracker (top of the dashboard): a progress ring plus six profile steps. Each step shows a red ✕
      until it's done and a green ✓ after; its button opens a short form.
   2. Profile page: header with star rating, About me, video introduction, skills, services, portfolio,
      experience, education, certificates, reviews (as a freelancer and as a client), seller/buyer stats.
   3. Video introduction: a link to the user's video, plus help to record one: the video guide (a blog
      article) and free seminars people can register for.
   Everything saves through PaklanceAuth.profile / PaklanceAuth.seminars (the preview's in-browser
   stand-in, or the API on the live site).

   Public API
     PaklanceProfile.init({ notify(msg), onUpdate(summary) })
     PaklanceProfile.mount(el, { video: el2 })   dashboard: tracker into el, video card into el2
     PaklanceProfile.mountPage(el)                the signed-in user's own profile page (with edit buttons)
     PaklanceProfile.renderPage(el, model)        anyone else's profile page, from data you pass in (see model below)
     PaklanceProfile.summary()                    → { done, total, percent, steps: { intro: bool, portfolio: bool, … } }
     PaklanceProfile.open(key)                    'intro' | 'portfolio' | 'services' | 'education' | 'experience' |
                                                  'certificates' | 'video' | 'video-help' | 'photo'
     PaklanceProfile.avatar(user, cls)            avatar HTML: the user's photo, or their initials
   Profile page model
     { name, initials, headline, city, rate, availability, bio, skills[], verified, sample, memberSince 'YYYY-MM-DD',
       video: PaklanceVideo.parse(url) | { sample, length } | null, items: [{ kind, title, subtitle, url, amount, startYear, endYear, description }],
       rating: { freelancer: [n5, n4, n3, n2, n1], client: [n5 … n1] },
       reviews: [{ role: 'freelancer' | 'client', stars, project, text, by, date 'YYYY-MM', sample }],
       seller: { earned, projects, services, clients, refunds }, buyer: { spent, posted, hires }, delivery: [completion, onTime, repeat] | null }
*/
window.PaklanceProfile = (function () {
  'use strict';

  var YEAR = new Date().getFullYear();
  var CATEGORIES = ['Development', 'Design', 'Marketing', 'Writing', 'Video', 'AI & Data', 'Business & Support'];
  var AVAILABILITY = ['Available now', 'Dedicated', 'Open to opportunities', 'Busy'];
  function yr(name, label, empty, extra) {
    return Object.assign({ name: name, label: label, empty: empty, type: 'year', min: 1960, max: YEAR, half: true, required: true, placeholder: 'e.g. ' + (YEAR - 2) }, extra || {});
  }

  // Field names match the API: intro → PUT /me/profile; the others → POST /me/profile/items { kind, … }
  var STEPS = [
    { key: 'intro', title: 'Elevate profile impact', button: 'Update introduction',
      heading: 'Your introduction', sub: 'Tell clients who you are and what you do best. This appears at the top of your public profile.',
      submit: 'Save introduction', saved: 'Introduction saved.',
      fields: [
        { name: 'headline', label: 'Headline', empty: 'a headline', type: 'text', min: 5, max: 100, required: true, placeholder: 'e.g. Shopify developer for fashion brands' },
        { name: 'bio', label: 'About you', empty: 'a few lines about you', type: 'textarea', min: 30, max: 2000, required: true, placeholder: 'What you do, who you work with and the results you deliver.', hint: 'At least 30 characters.' },
        { name: 'city', label: 'City', empty: 'your city', type: 'text', min: 2, max: 60, required: true, half: true, placeholder: 'e.g. Lahore' },
        { name: 'category', label: 'Main category', empty: 'a category', type: 'select', options: CATEGORIES, required: true, half: true },
        { name: 'hourlyRate', label: 'Hourly rate (PKR)', noun: 'Hourly rate', empty: 'your hourly rate', type: 'int', min: 300, max: 100000, required: true, half: true, placeholder: 'e.g. 2,500' },
        { name: 'availability', label: 'Availability', empty: 'your availability', type: 'select', options: AVAILABILITY, required: true, half: true }
      ] },
    { key: 'portfolio', title: 'Showcase your work', button: 'Add portfolio',
      heading: 'Add a portfolio project', sub: 'Show a project you’re proud of. A link lets clients see the real thing.',
      list: 'Your portfolio', submit: 'Add project', saved: 'Project added to your portfolio.',
      fields: [
        { name: 'title', label: 'Project title', empty: 'a project title', type: 'text', min: 3, max: 100, required: true, placeholder: 'e.g. Online store for a clothing brand' },
        { name: 'url', label: 'Link', type: 'url', max: 300, placeholder: 'https://' },
        { name: 'description', label: 'What you did', type: 'textarea', min: 0, max: 500, placeholder: 'Your role, the tools you used and the result.' }
      ] },
    { key: 'services', title: 'Highlight your offerings', button: 'Add services',
      heading: 'Add a service', sub: 'Describe something clients can hire you for, with a starting price.',
      list: 'Your services', submit: 'Add service', saved: 'Service added.',
      fields: [
        { name: 'title', label: 'Service', empty: 'a service name', type: 'text', min: 3, max: 100, required: true, placeholder: 'e.g. Logo and brand identity' },
        { name: 'amount', label: 'Starting price (PKR)', noun: 'Starting price', empty: 'a starting price', type: 'int', min: 500, max: 10000000, required: true, placeholder: 'e.g. 15,000' },
        { name: 'description', label: 'What’s included', type: 'textarea', min: 0, max: 500, placeholder: 'Deliverables, revisions and delivery time.' }
      ] },
    { key: 'education', title: 'Showcase your qualifications', button: 'Add education',
      heading: 'Add education', sub: 'Add a degree, diploma or course.',
      list: 'Your education', submit: 'Add education', saved: 'Education added.',
      fields: [
        { name: 'title', label: 'Degree or course', empty: 'your degree or course', type: 'text', min: 2, max: 100, required: true, placeholder: 'e.g. BS Computer Science' },
        { name: 'subtitle', label: 'Institution', empty: 'the institution', type: 'text', min: 2, max: 120, required: true, placeholder: 'e.g. COMSATS University Islamabad' },
        yr('startYear', 'Start year', 'the start year'),
        yr('endYear', 'End year (or expected)', 'the end year', { noun: 'End year', max: YEAR + 7 })
      ] },
    { key: 'experience', title: 'Highlight your expertise', button: 'Add experience',
      heading: 'Add work experience', sub: 'Add a job, internship or long-term client role.',
      list: 'Your experience', submit: 'Add experience', saved: 'Experience added.',
      fields: [
        { name: 'title', label: 'Role', empty: 'your role', type: 'text', min: 2, max: 100, required: true, placeholder: 'e.g. Frontend developer' },
        { name: 'subtitle', label: 'Company', empty: 'the company', type: 'text', min: 2, max: 120, required: true, placeholder: 'e.g. Systems Ltd' },
        yr('startYear', 'Start year', 'the start year'),
        yr('endYear', 'End year', 'the end year', { required: false, hint: 'Leave empty if you still work here.' }),
        { name: 'description', label: 'What you did', type: 'textarea', min: 0, max: 500, placeholder: 'Main responsibilities and results.' }
      ] },
    { key: 'certificates', title: 'Demonstrate your credibility', button: 'Add certificates',
      heading: 'Add a certificate', sub: 'Add a certification or licence clients can check.',
      list: 'Your certificates', submit: 'Add certificate', saved: 'Certificate added.',
      fields: [
        { name: 'title', label: 'Certificate', empty: 'the certificate name', type: 'text', min: 2, max: 120, required: true, placeholder: 'e.g. Google Data Analytics' },
        { name: 'subtitle', label: 'Issued by', empty: 'who issued it', type: 'text', min: 2, max: 120, required: true, placeholder: 'e.g. Coursera' },
        yr('endYear', 'Year issued', 'the year issued'),
        { name: 'url', label: 'Credential link', type: 'url', max: 300, placeholder: 'https://', half: true }
      ] }
  ];
  var VIDEO = { key: 'video', heading: 'Add your video introduction',
    sub: 'Upload a video from your phone or computer, or paste a link from YouTube, Vimeo, Loom or Google Drive. It plays at the top of your profile.',
    submit: 'Save video', saved: 'Video introduction saved.',
    prefill: function () { return data && data.video && data.video.kind !== 'upload' ? { url: data.video.url } : {}; },
    fields: [{ name: 'url', label: 'Video link', empty: 'a link to your video', type: 'video', max: 300, required: true, placeholder: 'e.g. https://youtu.be/…',
      hint: 'On YouTube you can upload it as “Unlisted”, so only people with the link can find it.' }] };
  var HELP = { key: 'video-help' }, PHOTO = { key: 'photo' };
  var GUIDE = '#blog/how-to-record-your-video-introduction';
  var BY_KEY = { video: VIDEO, 'video-help': HELP, photo: PHOTO };
  STEPS.forEach(function (s) { BY_KEY[s.key] = s; });

  var ICON_TODO = '<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="12.6"/><path d="M10.6 10.6l8.8 8.8M19.4 10.6l-8.8 8.8"/></svg>';
  var ICON_DONE = '<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13.4"/><path d="M9.6 15.4l3.7 3.7 7.1-7.6"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  function svg(d, cls) { return '<svg class="' + (cls || 'pp-i') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }
  var I = {
    check: svg('M5 12.5l4.2 4.2L19 7', 'pp-i pp-i-check'),
    pin: svg('M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z'),
    clock: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2'),
    cal: svg('M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4'),
    play: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10.2 8.6v6.8l5.4-3.4z'),
    link: svg('M10 14a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.5 6M14 10a4.5 4.5 0 0 0-6.4 0L5 12.6A4.5 4.5 0 0 0 11.4 19l1.1-1.1'),
    work: svg('M4 8h16v11H4zM9 8V5.5h6V8'),
    bars: svg('M5 20V11M10 20V5M15 20v-7M20 20V9', 'pp-i pp-i-bars'),
    cam: svg('M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4zM12 16.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z'),
    upload: svg('M12 15V4.5M7.5 9 12 4.5 16.5 9M4.5 15v4.5h15V15'),
    star: '<svg class="pp-i pp-i-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.6l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z"/></svg>'
  };
  var RING = 2 * Math.PI * 36;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var opts = {}, host = null, videoHost = null, pageHost = null;
  var data = null, dataUser = null, loadingFor = null, loadRun = 0, waiters = [];
  var modal = null, current = null, lastFocus = null, saving = false;
  var ph = null;                                   // photo editor: { img, url, zoom, x, y }
  var vu = null;                                   // video upload: { file, url, duration }
  var VU_TYPES = /^video\/(mp4|quicktime|webm|x-m4v)$/i, VU_EXT = /\.(mp4|mov|webm|m4v)$/i, VU_MAX_MB = 100, VU_MAX_SEC = 15, VU_MIN_SEC = 10;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pkr(n) { return 'PKR ' + Number(n || 0).toLocaleString('en-US'); }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function focusEl(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  function notify(msg) { if (opts.notify) opts.notify(msg); }
  function user() { return window.PaklanceAuth ? PaklanceAuth.getUser() : null; }
  function itemsOf(key) { return data ? data.items.filter(function (i) { return i.kind === key; }) : []; }
  function initialsOf(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function avatar(u, cls) {
    u = u || {};
    return '<span class="avatar' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
      (u.photo ? '<img src="' + esc(u.photo) + '" alt="">' : esc(u.initials || initialsOf(u.fullName || u.name || u.email))) + '</span>';
  }
  function camButton(has, cls) {
    return '<button type="button" class="pc-cam' + (cls ? ' ' + cls : '') + '" data-pc-open="photo" aria-label="' + (has ? 'Change profile photo' : 'Add a profile photo') + '">' + I.cam + '</button>';
  }
  function monthYear(iso) { var p = String(iso || '').split('-'); return p[1] ? MONTHS[+p[1] - 1] + ' ' + p[0] : ''; }
  function fullDate(iso) { var p = String(iso || '').split('-'); return p[2] ? (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0] : monthYear(iso); }
  // Pakistan time (UTC+5, no daylight saving), in the site's date style: "Sat 26 Sep", "7:00 PM"
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function pkt(d) { var x = new Date(d.getTime() + 5 * 3600000); return { day: x.getUTCDate(), month: MONTHS[x.getUTCMonth()], weekday: DAYS[x.getUTCDay()], h: x.getUTCHours(), m: x.getUTCMinutes() }; }
  function pkTime(d) { var t = pkt(d); return ((t.h % 12) || 12) + ':' + (t.m < 10 ? '0' : '') + t.m + ' ' + (t.h < 12 ? 'AM' : 'PM'); }
  function hostOf(url) { return String(url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''); }

  function summary() {
    var steps = {}, done = 0;
    STEPS.forEach(function (s) {
      var ok = !!data && (s.key === 'intro' ? !!(data.profile && data.profile.headline && data.profile.bio) : itemsOf(s.key).length > 0);
      steps[s.key] = ok; if (ok) done++;
    });
    return { done: done, total: STEPS.length, percent: Math.round((done / STEPS.length) * 100), steps: steps };
  }

  /* ---------- loading the signed-in user's profile (shared by the dashboard and the profile page) ---------- */
  function flush(kind, arg) { var w = waiters; waiters = []; w.forEach(function (x) { if (x[kind]) x[kind](arg); }); }
  function ensure(u, done, fail) {
    if (data && dataUser === u.id) { done(); return; }
    waiters.push({ done: done, fail: fail });
    if (loadingFor === u.id) return;                  // already loading for this user
    var run = ++loadRun; loadingFor = u.id;
    PaklanceAuth.profile.load().then(function (r) {
      if (run !== loadRun) return;
      loadingFor = null;
      data = { profile: (r && r.profile) || null, items: (r && r.items) || [], video: (r && r.video) || null,
               page: r && r.rating ? { rating: r.rating, reviews: r.reviews || [], seller: r.seller || {}, buyer: r.buyer || {}, delivery: r.delivery || null } : null }; dataUser = u.id;
      flush('done');
    }).catch(function (err) {
      if (run !== loadRun) return;
      loadingFor = null; flush('fail', err);
    });
  }
  function errorHtml(err) {
    return '<div class="pc-error"><span>' + esc((err && err.message) || 'We couldn’t load your profile.') + '</span><button type="button" class="pc-btn" data-pc-retry>Try again</button></div>';
  }

  /* ---------- dashboard: tracker + video card ---------- */
  function trackerHtml() {
    var sm = summary(), all = sm.done === sm.total;
    var h = '<div class="pc-col pc-progress">' +
      '<div class="pc-ring" role="progressbar" aria-label="Profile completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + sm.percent + '">' +
        '<svg viewBox="0 0 84 84" aria-hidden="true"><circle class="trk" cx="42" cy="42" r="36"/>' +
        '<circle class="val" cx="42" cy="42" r="36" stroke-dasharray="' + RING.toFixed(2) + '" stroke-dashoffset="' + (RING * (1 - sm.percent / 100)).toFixed(2) + '"' + (sm.percent ? '' : ' visibility="hidden"') + '/></svg>' +
        '<b>' + sm.percent + '%</b></div>' +
      '<p>' + (all ? 'Your profile is complete and ready for clients.' : 'Complete your profile to attract potential clients') + '</p></div>';
    STEPS.forEach(function (s) {
      var ok = sm.steps[s.key];
      h += '<div class="pc-col pc-step' + (ok ? ' is-done' : '') + '">' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<span class="pc-ico">' + (ok ? ICON_DONE : ICON_TODO) + '<span class="pa-sr">' + (ok ? 'Done' : 'Not done yet') + '</span></span>' +
        '<button type="button" class="pc-btn" data-pc-open="' + s.key + '">' + esc(s.button) + '</button></div>';
    });
    return h;
  }
  function helpLinks() {
    return '<div class="pc-vhelp"><strong>Need help recording?</strong><div class="pc-vopts">' +
      '<a class="pc-vopt" href="' + GUIDE + '">' + I.play + '<span><b>Watch the video guide</b><small>Step by step, recorded on a phone</small></span></a>' +
      '<button type="button" class="pc-vopt" data-pc-open="video-help">' + I.cal + '<span><b>Join a free seminar</b><small>Online and in person, with our team</small></span></button>' +
    '</div></div>';
  }
  function videoCardHtml() {
    var u = user() || {}, v = PaklanceVideo.fromSaved(data.video);
    return '<div class="cc-top"><h3 style="font-size:19px">Video introduction</h3>' +
        (v ? '<span class="chip chip-verified">Added</span>' : '<span class="chip chip-muted">Optional</span>') + '</div>' +
      (v ? '<div class="pc-vmini">' + PaklanceVideo.player(v, { title: 'your video introduction', initials: initialsOf(u.fullName || u.email), photo: u.photo, label: 'Play your video' }) + '</div>' +
           '<div class="pc-vactions"><button type="button" class="pc-btn" data-pc-open="video">Change video</button><a class="pc-btn" href="#profile">See it on your profile</a></div>'
         : '<p class="pc-vtext">A 10–15 second video lets clients see and hear you before they hire. It plays at the top of your profile.</p>' +
           '<button type="button" class="btn btn-primary btn-sm" data-pc-open="video">Add video</button>') +
      helpLinks();
  }
  function paint() {
    if (!data) return;
    if (host) { host.innerHTML = trackerHtml(); host.hidden = false; host.removeAttribute('aria-busy'); }
    if (videoHost) { videoHost.innerHTML = videoCardHtml(); videoHost.hidden = false; }
    if (pageHost) paintPage();
    if (opts.onUpdate) opts.onUpdate(summary());
  }
  function mount(el, extras) {
    host = el || host;
    if (extras && extras.video) videoHost = extras.video;
    var u = user();
    if (!u) { if (host) host.hidden = true; if (videoHost) videoHost.hidden = true; return; }
    if (data && dataUser === u.id) { paint(); return; }
    if (host) { host.hidden = true; host.setAttribute('aria-busy', 'true'); }
    if (videoHost) videoHost.hidden = true;
    ensure(u, paint, function (err) { if (!host) return; host.innerHTML = errorHtml(err); host.hidden = false; host.removeAttribute('aria-busy'); });
  }

  /* ---------- profile page ---------- */
  function ratingOf(dist) {
    dist = dist || [0, 0, 0, 0, 0];
    var n = 0, sum = 0;
    dist.forEach(function (c, i) { n += c; sum += c * (5 - i); });
    return { count: n, avg: n ? Math.round((sum / n) * 10) / 10 : 0, dist: dist };
  }
  function stars(avg, cls) {
    return '<span class="stars' + (cls ? ' ' + cls : '') + '" style="--r:' + (avg || 0) + '" role="img" aria-label="' +
      (avg ? 'Rated ' + avg.toFixed(1) + ' out of 5' : 'No rating yet') + '"></span>';
  }
  function sec(id, title, body, action) {
    return '<section class="pp-sec" id="pp-' + id + '" aria-labelledby="pp-h-' + id + '">' +
      '<div class="pp-sec-head"><h2 id="pp-h-' + id + '">' + esc(title) + '</h2>' + (action || '') + '</div>' + body + '</section>';
  }
  function tab(key, label, on) {
    return '<button type="button" role="tab" class="pp-tab" data-pp-tab="' + key + '" aria-selected="' + on + '">' + label + '</button>';
  }
  function years(i) { return i.startYear ? i.startYear + ' – ' + (i.endYear || 'Present') : (i.endYear ? String(i.endYear) : ''); }
  function extLink(url, label) {
    return url ? '<a class="pp-ext" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">' + I.link + esc(label || hostOf(url)) + '</a>' : '';
  }
  function serviceCard(i) {
    return '<article class="pp-card"><h3>' + esc(i.title) + '</h3>' + (i.description ? '<p>' + esc(i.description) + '</p>' : '') +
      '<p class="pp-price">From <strong>' + pkr(i.amount) + '</strong></p></article>';
  }
  function workCard(i) {
    return '<article class="pp-card pp-work"><span class="pp-work-ico">' + I.work + '</span><h3>' + esc(i.title) + '</h3>' +
      (i.description ? '<p>' + esc(i.description) + '</p>' : '') + extLink(i.url) + '</article>';
  }
  function listItem(i, withLink) {
    var meta = [i.subtitle, years(i)].filter(Boolean).join(' · ');
    return '<li><strong>' + esc(i.title) + '</strong>' + (meta ? '<span>' + esc(meta) + '</span>' : '') +
      (i.description ? '<p>' + esc(i.description) + '</p>' : '') + (withLink ? extLink(i.url, 'View credential') : '') + '</li>';
  }
  function reviewHtml(r) {
    return '<li class="pp-review"><div class="pp-rv-top">' + stars(r.stars, 'sm') + '<strong>' + Number(r.stars).toFixed(1) + '</strong>' +
        '<span class="pp-rv-date">' + esc(monthYear(r.date)) + '</span></div>' +
      '<p class="pp-rv-proj">' + esc(r.project) + '</p><p class="pp-rv-text">“' + esc(r.text) + '”</p><p class="pp-rv-by">' + esc(r.by) + '</p></li>';
  }
  function reviewsHtml(m, fr, cr, owner) {
    var list = m.reviews || [];
    function panel(role, r) {
      if (!r.count) return '<p class="pp-none">' + (role === 'freelancer'
        ? (owner ? 'No reviews yet. Clients can rate you after you finish a contract with them.' : 'No reviews yet.')
        : (owner ? 'No reviews as a client yet. Freelancers can rate you after a contract you hired them for is finished.' : 'No reviews as a client yet.')) + '</p>';
      var rv = list.filter(function (x) { return x.role === role; });
      return '<div class="pp-rsum"><div class="pp-ravg"><strong>' + r.avg.toFixed(1) + '</strong>' + stars(r.avg) +
          '<span>' + r.count + ' review' + (r.count === 1 ? '' : 's') + '</span></div>' +
        '<ul class="pp-dist" aria-label="Ratings breakdown">' + [5, 4, 3, 2, 1].map(function (n, i) {
          var c = r.dist[i], w = r.count ? Math.round((c / r.count) * 100) : 0;
          return '<li><span class="pp-dist-n">' + n + I.star + '</span><span class="pp-bar"><i style="width:' + w + '%"></i></span><span class="pp-dist-c">' + c + '</span></li>';
        }).join('') + '</ul></div>' +
        (rv.length ? '<ul class="pp-reviews">' + rv.map(reviewHtml).join('') + '</ul>' : '') +
        (rv.length && rv.length < r.count ? '<p class="pp-more">Showing the ' + rv.length + ' most recent of ' + r.count + ' reviews.</p>' : '');
    }
    return sec('reviews', 'Reviews',
      '<div data-pp-tabs><div class="pp-tabs pp-tabs-line" role="tablist" aria-label="Reviews">' +
        tab('freelancer', 'As a freelancer <span>' + fr.count + '</span>', true) + tab('client', 'As a client <span>' + cr.count + '</span>', false) + '</div>' +
        '<div data-pp-panel="freelancer" role="tabpanel">' + panel('freelancer', fr) + '</div>' +
        '<div data-pp-panel="client" role="tabpanel" hidden>' + panel('client', cr) + '</div></div>');
  }
  function kvRows(rows) {
    return '<dl class="pp-kv">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>';
  }
  function deliveryHtml(d) {
    var v = function (x) { return x == null ? '—' : x + '%'; };
    d = d || [null, null, null];
    return '<div class="t-stats"><div class="t-stat"><strong>' + v(d[0]) + '</strong><span>Completion</span></div>' +
      '<div class="t-stat"><strong>' + v(d[1]) + '</strong><span>On-time</span></div>' +
      '<div class="t-stat"><strong>' + v(d[2]) + '</strong><span>Repeat clients</span></div></div>' +
      (d[0] == null ? '<p class="pp-note">Shown after the first finished contracts.</p>' : '');
  }

  function renderPage(el, m, o) {
    o = o || {};
    if (!el) return;
    if (el === pageHost && !o.owner) pageHost = null;           // someone else's profile now uses this area
    var owner = !!o.owner, first = String(m.name || '').split(' ')[0];
    var fr = ratingOf(m.rating && m.rating.freelancer), cr = ratingOf(m.rating && m.rating.client);
    var items = m.items || [], by = function (k) { return items.filter(function (i) { return i.kind === k; }); };
    var act = function (key, label) { return owner ? '<button type="button" class="pp-act" data-pc-open="' + key + '">' + esc(label) + '</button>' : ''; };
    var empty = function (text, key, label) { return '<div class="pp-empty"><p>' + esc(text) + '</p><button type="button" class="pc-btn" data-pc-open="' + key + '">' + esc(label) + '</button></div>'; };
    var s = m.seller || {}, b = m.buyer || {};

    var chips = (m.verified ? '<span class="chip chip-verified">' + I.check + 'Verified</span>' : (owner ? '<span class="chip chip-verified">' + I.check + 'Email verified</span>' : '')) +
      (owner ? '<span class="chip chip-muted">This is how clients see you</span>' : '');
    var meta = [m.city ? I.pin + esc(m.city) + ', Pakistan' : '', I.clock + esc(pkTime(new Date())) + ' local time',
      m.memberSince ? I.cal + 'Member since ' + esc(monthYear(m.memberSince)) : ''].filter(Boolean);

    var head = '<section class="card pp-head">' +
      '<div class="pc-avwrap">' + avatar(m, 'pp-avatar') + (owner ? camButton(!!m.photo) : '') + '</div>' +
      '<div class="pp-id"><div class="pp-name"><h1>' + esc(m.name) + '</h1><div class="chip-row">' + chips + '</div></div>' +
        '<p class="pp-role">' + (m.headline ? esc(m.headline) : (owner ? '<span class="muted">Add a headline so clients know what you do</span>' : '')) + '</p>' +
        '<p class="pp-meta">' + meta.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</p>' +
        '<button type="button" class="pp-rating" data-pp-go="reviews">' + stars(fr.avg) +
          (fr.count ? '<strong>' + fr.avg.toFixed(1) + '</strong><span>(' + fr.count + ' review' + (fr.count === 1 ? '' : 's') + ')</span>' : '<span>No reviews yet</span>') + '</button>' +
      '</div>' +
      '<div class="pp-cta">' + (m.rate ? '<strong class="pp-rate">' + pkr(m.rate) + '<small>/hr</small></strong>' : '') +
        (m.availability ? '<span class="pp-avail"><i aria-hidden="true"></i>' + esc(m.availability) + '</span>' : '') +
        (owner ? '<button class="btn btn-primary" type="button" data-pc-open="intro">Edit profile</button>'
               : '<button class="btn btn-primary" type="button" data-open="auth" data-signup>Hire ' + esc(first) + '</button>' +
                 (m.userId ? '<button class="btn btn-outline pk-contact-btn" type="button" data-msg-user-id="' + esc(m.userId) + '" data-msg-user-name="' + esc(m.name || '') + '" data-msg-user-role="' + esc(m.headline || '') + '">Message</button>' : '')) + '</div>' +
    '</section>';

    var main = '';
    main += sec('about', 'About me', m.bio ? '<p class="pp-bio">' + esc(m.bio) + '</p>'
      : (owner ? empty('Add a headline and a few lines about you, so clients know what you do and how you work.', 'intro', 'Update introduction') : '<p class="pp-none">No introduction yet.</p>'),
      m.bio ? act('intro', 'Edit') : '');
    if (m.video || owner) main += sec('video', 'Video introduction', m.video
      ? '<div class="pp-video">' + PaklanceVideo.player(m.video, { title: (m.name || '') + '’s video introduction', initials: m.initials, photo: m.photo, label: 'Meet ' + first + ' · play video' }) + '</div>'
      : '<div class="pp-empty pp-empty-video"><p>Add a 10–15 second video so clients can see and hear you before they hire.</p>' +
          '<button type="button" class="pc-btn" data-pc-open="video">Add video</button>' + helpLinks() + '</div>',
      m.video ? act('video', 'Change') : '');
    main += sec('skills', 'My expertise', (m.skills || []).length ? '<div class="tags">' + m.skills.map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join('') + '</div>' : '<p class="pp-none">No skills added yet.</p>',
      owner ? '<button type="button" class="pp-act" data-edit-skills>Edit skills</button>' : '');
    [['services', 'My services', 'Add a service clients can hire you for, with a starting price.', 'Add services', function (l) { return '<div class="pp-cards">' + l.map(serviceCard).join('') + '</div>'; }],
     ['portfolio', 'Portfolio', 'Show a project you’re proud of, with a link clients can open.', 'Add portfolio', function (l) { return '<div class="pp-cards">' + l.map(workCard).join('') + '</div>'; }],
     ['experience', 'Work experience', 'Add a job, internship or long-term client role.', 'Add experience', function (l) { return '<ul class="pp-list">' + l.map(function (i) { return listItem(i); }).join('') + '</ul>'; }],
     ['education', 'Education', 'Add a degree, diploma or course.', 'Add education', function (l) { return '<ul class="pp-list">' + l.map(function (i) { return listItem(i); }).join('') + '</ul>'; }],
     ['certificates', 'Certificates', 'Add a certification or licence clients can check.', 'Add certificates', function (l) { return '<ul class="pp-list">' + l.map(function (i) { return listItem(i, true); }).join('') + '</ul>'; }]
    ].forEach(function (c) {
      var l = by(c[0]);
      if (l.length || owner) main += sec(c[0], c[1], l.length ? c[4](l) : empty(c[2], c[0], c[3]), l.length ? act(c[0], 'Add or remove') : '');
    });
    main += reviewsHtml(m, fr, cr, owner);

    var side = '<aside class="side pp-side">' +
      '<div class="card pp-stats" data-pp-tabs>' +
        '<div class="pp-tabs pp-tabs-stats" role="tablist" aria-label="Stats">' + tab('seller', I.bars + 'Seller stats', true) + tab('buyer', I.bars + 'Buyer stats', false) + '</div>' +
        '<div data-pp-panel="seller" role="tabpanel">' + (m.rate ? '<p class="pp-stats-rate">' + pkr(m.rate) + '<small>/hr</small></p>' : '') +
          kvRows([['Total earned', pkr(s.earned)], ['Projects completed', num(s.projects)], ['Services delivered', num(s.services)],
            ['Clients worked with', num(s.clients)], ['Reviews', fr.count ? fr.avg.toFixed(1) + ' ★ · ' + fr.count : '0'], ['Refunds', num(s.refunds)]]) + '</div>' +
        '<div data-pp-panel="buyer" role="tabpanel" hidden>' +
          kvRows([['Total spent', pkr(b.spent)], ['Jobs posted', num(b.posted)], ['Freelancers hired', num(b.hires)],
            ['Reviews as a client', cr.count ? cr.avg.toFixed(1) + ' ★ · ' + cr.count : '0']]) + '</div>' +
        (m.memberSince ? '<p class="pp-since">Member since ' + esc(fullDate(m.memberSince)) + '</p>' : '') +
      '</div>' +
      '<div class="card"><h3 class="pp-side-h">Delivery record</h3>' + deliveryHtml(m.delivery) + '</div>' +
      (owner ? '<a class="btn btn-outline btn-block" href="#dashboard">Back to dashboard</a>' : '<a class="btn btn-outline btn-block" href="#match">Get matched instead</a>') +
    '</aside>';

    el.innerHTML = head + '<div class="card pp-main">' + main + '</div>' + side;
  }
  function ownModel() {
    var u = user() || {}, p = data.profile || {};
    return {
      name: u.fullName || 'Your name', initials: initialsOf(u.fullName || u.email), photo: u.photo || null, headline: p.headline || '', city: p.city || '',
      rate: p.hourlyRate || null, availability: p.availability || '', bio: p.bio || '', skills: u.skills || [], verified: !!u.identityVerified,
      memberSince: u.memberSince, video: PaklanceVideo.fromSaved(data.video), items: data.items, reviews: (data.page && data.page.reviews) || [],
      rating: (data.page && data.page.rating) || { freelancer: [0, 0, 0, 0, 0], client: [0, 0, 0, 0, 0] }, seller: (data.page && data.page.seller) || {},
      buyer: (data.page && data.page.buyer) || {}, delivery: (data.page && data.page.delivery) || null
    };
  }
  function paintPage() { if (pageHost && data) renderPage(pageHost, ownModel(), { owner: true }); }
  function mountPage(el) {
    pageHost = el;
    var u = user(); if (!u || !el) return;
    if (data && dataUser === u.id) { paintPage(); return; }
    el.innerHTML = '<div class="card pp-loading" aria-busy="true">Loading your profile…</div>';
    ensure(u, paint, function (err) { if (pageHost === el) el.innerHTML = '<div class="card">' + errorHtml(err) + '</div>'; });
  }

  /* ---------- forms and the recording help (one dialog) ---------- */
  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'pa-modal pc-modal'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'pc-h');
    modal.innerHTML = '<div class="pa-card"><div class="pa-top"><span class="pa-brand"><svg class="logo-mark" aria-hidden="true" focusable="false"><use href="#pk-logo"/></svg>Paklance</span>' +
      '<button class="pa-x" type="button" data-pc-close aria-label="Close">' + ICON_X + '</button></div><div class="pc-body"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', onModalClick);
    modal.addEventListener('submit', onSubmit);
    // a photo dropped anywhere on the dialog is used (and never opens in the browser tab)
    modal.addEventListener('dragover', function (e) { e.preventDefault(); });
    modal.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (current === PHOTO) phLoad(f); else if (current === VIDEO && !saving) vuLoad(f);
    });
    modal.addEventListener('input', function (e) { if (e.target.getAttribute('aria-invalid')) setErr(e.target, ''); });
    modal.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT' && e.target.getAttribute('aria-invalid')) setErr(e.target, ''); });
  }
  function itemLine(it) {
    var yrs = years(it);
    var sub = it.kind === 'services' ? 'From ' + pkr(it.amount)
      : it.kind === 'portfolio' ? (it.url ? hostOf(it.url) : (it.description || ''))
      : [it.subtitle, yrs].filter(Boolean).join(' · ');
    return '<li class="pc-item"><div><strong>' + esc(it.title) + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
      '<button type="button" class="pc-remove" data-pc-remove="' + esc(it.id) + '" aria-label="Remove ' + esc(it.title) + '">Remove</button></li>';
  }
  function fieldHtml(f, value, first) {
    var id = 'pc-f-' + f.name, v = value == null ? '' : String(value);
    if (f.type === 'int' && v) v = Number(v).toLocaleString('en-US');
    var attrs = ' id="' + id + '" name="' + f.name + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
      (f.hint ? ' data-hint="' + id + '-hint"' : '') + (f.hint ? ' aria-describedby="' + id + '-hint"' : '') + (first ? ' data-pc-focus' : '');
    var ctl;
    if (f.type === 'textarea') ctl = '<textarea' + attrs + ' rows="4" maxlength="' + f.max + '">' + esc(v) + '</textarea>';
    else if (f.type === 'select') ctl = '<select' + attrs + '><option value="">Choose…</option>' +
      f.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    else ctl = '<input' + attrs + ' value="' + esc(v) + '"' +
      (f.type === 'url' || f.type === 'video' ? ' type="url" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false"'
        : f.type === 'int' ? ' inputmode="numeric" autocomplete="off"'
        : f.type === 'year' ? ' inputmode="numeric" autocomplete="off" maxlength="4"' : ' autocomplete="off"') +
      (f.type === 'text' || f.type === 'url' || f.type === 'video' ? ' maxlength="' + f.max + '"' : '') + '>';
    return '<div class="pa-field' + (f.half ? ' pc-half' : '') + '"><label for="' + id + '">' + esc(f.label) +
      (f.required ? '' : ' <span class="pc-opt">(optional)</span>') + '</label>' + ctl +
      (f.hint ? '<p class="pc-hint" id="' + id + '-hint">' + esc(f.hint) + '</p>' : '') +
      '<p class="pa-err" id="' + id + '-err" hidden></p></div>';
  }
  function paintEditor() {
    vuReset();
    var s = current, isIntro = s.key === 'intro', isVideo = s.key === 'video', list = s.list ? itemsOf(s.key) : [];
    var pre = s.prefill ? s.prefill() : (isIntro && data.profile ? data.profile : {});
    var tab = isVideo && data.video && data.video.kind !== 'upload' ? 'link' : 'upload';   // video: open on the kind they already use
    var h = '<h2 class="pa-h" id="pc-h" tabindex="-1">' + esc(isVideo && data.video ? 'Change your video introduction' : s.heading) + '</h2><p class="pa-sub">' + esc(s.sub) + '</p>';
    if (list.length) h += '<p class="pa-label">' + esc(s.list) + ' (' + list.length + ')</p><ul class="pc-items">' + list.map(itemLine).join('') + '</ul>' +
      '<p class="pa-label">Add another</p>';
    if (isVideo && data.video) {
      var cv = PaklanceVideo.fromSaved(data.video) || {}, up = data.video.kind === 'upload';
      h += '<p class="pa-label">Current video</p><ul class="pc-items"><li class="pc-item"><div><strong>' + esc(up ? (data.video.name || 'Uploaded video') : (cv.provider || 'Video')) + '</strong>' +
        '<span>' + esc(up ? ['Uploaded from your device', fileSize(data.video.size), PaklanceVideo.duration(data.video.duration)].filter(Boolean).join(' · ') : hostOf(data.video.url)) + '</span></div>' +
        '<button type="button" class="pc-remove" data-pc-remove-video>Remove</button></li></ul><p class="pa-label">Replace it</p>';
    }
    var form = '<form class="pa-form pc-form" novalidate' + (!isVideo && list.length ? ' style="margin-top:0"' : '') + '><div class="pa-alert" role="alert" hidden></div>' +
      s.fields.map(function (f, i) { return fieldHtml(f, pre[f.name], i === 0 && !(isVideo && tab === 'upload')); }).join('') +
      '<button class="pa-btn pa-btn-primary" type="submit">' + esc(s.submit) + '</button></form>';
    if (isVideo) {
      h += '<div class="tabs vu-tabs" role="tablist" aria-label="How to add your video"' + (data.video ? ' style="margin-top:0"' : '') + '>' +
          '<button type="button" role="tab" id="vu-tab-upload" aria-controls="vu-panel-upload" data-vu-tab="upload"' + (tab === 'upload' ? ' class="on" aria-selected="true"' : ' aria-selected="false" tabindex="-1"') + '>Upload from device</button>' +
          '<button type="button" role="tab" id="vu-tab-link" aria-controls="vu-panel-link" data-vu-tab="link"' + (tab === 'link' ? ' class="on" aria-selected="true"' : ' aria-selected="false" tabindex="-1"') + '>Paste a link</button>' +
        '</div>' +
        '<div class="vu-panel" id="vu-panel-upload" role="tabpanel" aria-labelledby="vu-tab-upload" data-vu-panel="upload"' + (tab === 'upload' ? '' : ' hidden') + '>' +
          '<input type="file" id="pc-video-file" class="pa-sr vu-file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm">' +
          '<label class="ph-drop vu-drop" for="pc-video-file">' + I.upload + '<span><b>Choose a video</b><small>or drag it here · MP4, MOV or WebM, up to ' + VU_MAX_MB + ' MB, 10 to ' + VU_MAX_SEC + ' seconds</small></span></label>' +
          '<div class="vu-picked" hidden>' +
            '<video class="vu-preview" controls playsinline preload="metadata"></video>' +
            '<div class="vu-meta"><strong class="vu-name"></strong><span class="vu-info"></span></div>' +
            '<div class="vu-bar" hidden><i></i></div>' +
            '<p class="pc-hint vu-status" role="status"></p>' +
          '</div>' +
          '<p class="pa-err" id="pc-video-err" role="alert" hidden></p>' +
          '<div class="vu-actions" hidden><button type="button" class="pa-btn pa-btn-primary" data-vu-upload disabled>Upload video</button></div>' +
        '</div>' +
        '<div class="vu-panel" id="vu-panel-link" role="tabpanel" aria-labelledby="vu-tab-link" data-vu-panel="link"' + (tab === 'link' ? '' : ' hidden') + '>' + form + '</div>' +
        '<p class="pc-hint pc-vlinks">Not recorded yet? <a class="pa-link" href="' + GUIDE + '">Watch the video guide</a> or ' +
        '<button type="button" class="pa-link" data-pc-open="video-help">join a free seminar</button>.</p>';
    } else h += form;
    modal.querySelector('.pc-body').innerHTML = h;
    if (isVideo) {
      var file = modal.querySelector('#pc-video-file'), drop = modal.querySelector('.vu-drop');
      file.addEventListener('change', function () { vuLoad(file.files[0]); file.value = ''; });
      ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
    }
  }

  /* ---------- video introduction: upload a file from the device ---------- */
  function fileSize(b) { b = +b || 0; return !b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function vuErr(msg) { var p = modal && modal.querySelector('#pc-video-err'); if (p) { p.textContent = msg || ''; p.hidden = !msg; } }
  function vuStatus(msg) { var p = modal && modal.querySelector('.vu-status'); if (p) p.textContent = msg || ''; }
  function vuReset() {
    if (vu && vu.url) URL.revokeObjectURL(vu.url);
    if (vu && vu.timer) clearTimeout(vu.timer);
    vu = null;
  }
  function vuTab(key) {
    if (!modal) return;
    modal.querySelectorAll('[data-vu-tab]').forEach(function (b) {
      var on = b.getAttribute('data-vu-tab') === key;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
      if (on) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    });
    modal.querySelectorAll('[data-vu-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-vu-panel') !== key; });
  }
  function vuInfo() {
    var el = modal.querySelector('.vu-info'); if (!el || !vu) return;
    el.textContent = [fileSize(vu.file.size), vu.duration ? PaklanceVideo.duration(vu.duration) + ' long' : ''].filter(Boolean).join(' · ');
  }
  function vuLoad(file) {
    vuErr('');
    if (!file) return;
    vuTab('upload');
    if (!VU_TYPES.test(file.type || '') && !VU_EXT.test(file.name || '')) { vuErr('Choose an MP4, MOV or WebM video.'); return; }
    if (file.size > VU_MAX_MB * 1048576) { vuErr('This video is ' + fileSize(file.size) + '. Videos can be up to ' + VU_MAX_MB + ' MB: trim it or export it at a lower quality, then try again.'); return; }
    vuReset();
    var url = URL.createObjectURL(file);
    vu = { file: file, url: url, duration: null };
    var box = modal.querySelector('.vu-picked'), vid = box.querySelector('video'), btn = modal.querySelector('[data-vu-upload]');
    box.hidden = false; modal.querySelector('.vu-actions').hidden = false;
    modal.querySelector('.vu-drop b').textContent = 'Choose a different video';
    modal.querySelector('.vu-name').textContent = file.name;
    vuInfo(); btn.disabled = true; vuStatus('Checking the video…');
    var ready = function (note) { if (!vu || vu.url !== url) return; clearTimeout(vu.timer); vuStatus(note || ''); btn.disabled = false; };
    vid.hidden = false;
    vid.onloadedmetadata = function () {
      if (!vu || vu.url !== url) return;
      if (isFinite(vid.duration) && vid.duration > 0) vu.duration = Math.round(vid.duration);
      vuInfo();
      if (vu.duration && vu.duration > VU_MAX_SEC) { clearTimeout(vu.timer); vuStatus(''); vuErr('This video is ' + PaklanceVideo.duration(vu.duration) + ' long. Keep it between 10 and 15 seconds.'); return; }
      if (vu.duration && vu.duration < VU_MIN_SEC) { clearTimeout(vu.timer); vuStatus(''); vuErr('This video is only ' + vu.duration + ' seconds long. Record at least ' + VU_MIN_SEC + ' seconds.'); return; }
      ready();
    };
    vid.onerror = function () { vid.hidden = true; ready('Your browser can’t preview this file, but you can still upload it.'); };
    vu.timer = setTimeout(function () { ready('The preview is still loading. You can upload now.'); }, 5000);
    vid.src = url;
  }
  function vuUpload(btn) {
    if (!vu || saving) return;
    saving = true; vuErr('');
    btn.disabled = true; btn.innerHTML = '<span class="pa-spin-sm" aria-hidden="true"></span>Uploading…';
    var bar = modal.querySelector('.vu-bar'), fill = bar.querySelector('i');
    bar.hidden = false; fill.style.width = '0%';
    modal.querySelectorAll('[data-vu-tab]').forEach(function (b) { b.disabled = true; });
    PaklanceAuth.profile.uploadVideo(vu.file, { duration: vu.duration }, function (p) {
      var pc = Math.round(p * 100); fill.style.width = pc + '%'; vuStatus('Uploading… ' + pc + '%');
    }).then(function (r) {
      saving = false; data.video = r.video; paint(); close(); notify('Video introduction uploaded.');
    }).catch(function (err) {
      saving = false; btn.disabled = false; btn.textContent = 'Upload video'; bar.hidden = true; vuStatus('');
      modal.querySelectorAll('[data-vu-tab]').forEach(function (b) { b.disabled = false; });
      vuErr((err && err.message) || 'We couldn’t upload your video. Please try again.');
    });
  }
  function paintHelp() {
    modal.querySelector('.pc-body').innerHTML =
      '<h2 class="pa-h" id="pc-h" tabindex="-1">Record your video introduction</h2>' +
      '<p class="pa-sub">A short video lets clients see how you communicate before they hire you. Pick the help that suits you:</p>' +
      '<div class="vh-opts">' +
        '<a class="vh-opt" href="' + GUIDE + '">' + I.play + '<span><b>Watch the video guide</b><small>Light, sound, framing and what to say, step by step.</small></span></a>' +
        '<button type="button" class="vh-opt" data-pc-jump="pc-seminars">' + I.cal + '<span><b>Join a free seminar</b><small>Online and in-person sessions with the Paklance team.</small></span></button>' +
      '</div>' +
      '<p class="pa-label" id="pc-seminars" tabindex="-1">Upcoming seminars</p>' +
      '<div class="sem-list" aria-live="polite"><p class="pc-hint">Loading seminars…</p></div>' +
      '<p class="pa-label">Quick tips</p><ul class="vh-tips">' +
        '<li>Keep it between 10 and 15 seconds.</li>' +
        '<li>Face a window or a lamp, in a quiet room.</li>' +
        '<li>Hold your phone sideways, at eye level.</li>' +
        '<li>Say who you are, what you do, one result you’re proud of, and invite clients to message you.</li>' +
        '<li>Upload it straight from your phone or computer (MP4, MOV or WebM, up to 100 MB), or add a link from YouTube, Vimeo, Loom or Google Drive.</li></ul>' +
      (user() ? '<button class="pa-btn pa-btn-primary" type="button" data-pc-open="video" style="margin-top:20px">I have a video: add it</button>' : '');
    loadSeminars();
  }
  function seminarHtml(s) {
    var d = new Date(s.startsAt), t = pkt(d);
    var when = t.weekday + ' ' + t.day + ' ' + t.month + ' · ' + pkTime(d) + ' PKT';
    return '<li class="sem"><div class="sem-date" aria-hidden="true"><b>' + t.day + '</b><span>' + t.month + '</span></div>' +
      '<div class="sem-body"><div class="sem-tags"><span class="chip ' + (s.mode === 'Online' ? 'chip-verified' : 'chip-muted') + '">' + esc(s.mode) + '</span>' +
        '</div>' +
        '<strong>' + esc(s.title) + '</strong>' +
        '<span class="sem-meta">' + esc(when) + ' · ' + s.minutes + ' min</span><span class="sem-meta">' + esc(s.place) + '</span>' +
        '<p>' + esc(s.about) + '</p>' +
        '<div class="sem-foot"><span>' + (s.seatsLeft > 0 ? s.seatsLeft + ' seats left' : 'Full') + '</span>' +
          (s.registered ? '<span class="sem-done">' + I.check + 'You’re registered</span>'
            : '<button type="button" class="pa-btn pa-btn-primary pa-btn-sm" data-pc-seminar="' + esc(s.id) + '"' + (s.seatsLeft > 0 ? '' : ' disabled') + '>Register free</button>') +
        '</div></div></li>';
  }
  function loadSeminars() {
    var box = modal.querySelector('.sem-list'); if (!box) return;
    PaklanceAuth.seminars.list().then(function (r) {
      if (!box.isConnected) return;
      var list = (r && r.seminars) || [];
      box.innerHTML = list.length ? '<ul class="sem-ul">' + list.map(seminarHtml).join('') + '</ul>'
        : '<p class="pc-hint">No seminars are scheduled right now. New dates are announced on the blog.</p>';
    }).catch(function (err) { if (box.isConnected) box.innerHTML = '<p class="pc-hint">' + esc((err && err.message) || 'We couldn’t load the seminars.') + '</p>'; });
  }

  /* ---------- profile photo: choose, position and zoom inside a circle, save as a 400×400 JPEG ---------- */
  var PH_OUT = 400, PH_MAX_MB = 5;
  function photoErr(msg) { var p = modal.querySelector('#pc-photo-err'); if (p) { p.textContent = msg || ''; p.hidden = !msg; } }
  function phSize() { var c = modal.querySelector('.ph-canvas'); return (c && c.clientWidth) || 240; }
  function phClamp() {
    var S = phSize(), w = ph.img.naturalWidth, h = ph.img.naturalHeight, k = Math.max(S / w, S / h) * ph.zoom;
    var mx = Math.max(0, (w * k - S) / 2), my = Math.max(0, (h * k - S) / 2);
    ph.x = Math.max(-mx, Math.min(mx, ph.x)); ph.y = Math.max(-my, Math.min(my, ph.y));
    return k;
  }
  function phDraw(ctx, size) {
    var S = phSize(), k = phClamp(), f = size / S, w = ph.img.naturalWidth * k, h = ph.img.naturalHeight * k;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(ph.img, (S / 2 + ph.x - w / 2) * f, (S / 2 + ph.y - h / 2) * f, w * f, h * f);
  }
  function phRender() { var c = modal.querySelector('.ph-canvas'); if (c && ph && ph.img) phDraw(c.getContext('2d'), c.width); }
  function phLoad(file) {
    photoErr('');
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) { photoErr('Choose a JPG, PNG or WebP image.'); return; }
    if (file.size > PH_MAX_MB * 1048576) { photoErr('This photo is larger than 5 MB. Choose a smaller one.'); return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      if (!modal || current !== PHOTO) { URL.revokeObjectURL(url); return; }
      if (img.naturalWidth < 200 || img.naturalHeight < 200) { URL.revokeObjectURL(url); photoErr('This photo is too small. Use one at least 200 × 200 pixels.'); return; }
      if (ph && ph.url) URL.revokeObjectURL(ph.url);
      ph = { img: img, url: url, zoom: 1, x: 0, y: 0 };
      var c = modal.querySelector('.ph-canvas');
      c.hidden = false; modal.querySelector('.ph-current').hidden = true;
      modal.querySelector('.ph-zoom').hidden = false; modal.querySelector('.ph-hint').hidden = false;
      modal.querySelector('[data-ph-zoom]').value = '1';
      modal.querySelector('[data-ph-save]').disabled = false;
      modal.querySelector('.ph-drop b').textContent = 'Choose a different photo';
      phRender(); focusEl(c);
    };
    img.onerror = function () { URL.revokeObjectURL(url); photoErr('We couldn’t open this image. Try another photo.'); };
    img.src = url;
  }
  function paintPhoto() {
    var u = user() || {};
    ph = null;
    modal.querySelector('.pc-body').innerHTML =
      '<h2 class="pa-h" id="pc-h" tabindex="-1">' + (u.photo ? 'Change your profile photo' : 'Add a profile photo') + '</h2>' +
      '<p class="pa-sub">A clear photo of your face helps clients trust you. It shows on your profile and next to your name across Paklance.</p>' +
      '<div class="ph-wrap"><div class="ph-stage">' +
          '<canvas class="ph-canvas" width="480" height="480" tabindex="0" role="img" aria-label="Photo preview. Drag or use the arrow keys to move it; plus and minus to zoom." hidden></canvas>' +
          '<span class="ph-current">' + (u.photo ? '<img src="' + esc(u.photo) + '" alt="Your current profile photo">' : '<b aria-hidden="true">' + esc(initialsOf(u.fullName || u.email)) + '</b>') + '</span>' +
        '</div>' +
        '<label class="ph-zoom" hidden><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" data-ph-zoom></label>' +
        '<p class="pc-hint ph-hint" hidden>Drag the photo to position your face in the circle.</p>' +
      '</div>' +
      '<input type="file" id="pc-photo-file" class="pa-sr ph-file" accept="image/jpeg,image/png,image/webp">' +
      '<label class="ph-drop" for="pc-photo-file">' + I.upload + '<span><b>Choose a photo</b><small>or drag it here · JPG, PNG or WebP, up to 5 MB</small></span></label>' +
      '<p class="pa-err" id="pc-photo-err" role="alert" hidden></p>' +
      '<div class="ph-actions"><button type="button" class="pa-btn pa-btn-primary" data-ph-save disabled>Save photo</button>' +
        (u.photo ? '<button type="button" class="pa-btn pa-btn-outline" data-ph-remove>Remove photo</button>' : '') + '</div>' +
      '<p class="pa-label">What works best</p><ul class="vh-tips"><li>Just you, facing the camera.</li><li>Good light on your face and a plain background.</li><li>No logos, group photos or cartoons.</li></ul>';

    var file = modal.querySelector('#pc-photo-file'), drop = modal.querySelector('.ph-drop'), c = modal.querySelector('.ph-canvas'), zoom = modal.querySelector('[data-ph-zoom]');
    file.addEventListener('change', function () { phLoad(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
    zoom.addEventListener('input', function () { if (!ph) return; ph.zoom = +zoom.value; phRender(); });
    var drag = null;
    c.addEventListener('pointerdown', function (e) { if (!ph) return; drag = { x: e.clientX, y: e.clientY, ox: ph.x, oy: ph.y }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', function (e) { if (!drag) return; ph.x = drag.ox + e.clientX - drag.x; ph.y = drag.oy + e.clientY - drag.y; phRender(); });
    ['pointerup', 'pointercancel'].forEach(function (t) { c.addEventListener(t, function () { drag = null; }); });
    c.addEventListener('keydown', function (e) {
      if (!ph) return;
      var mv = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
      if (mv) { e.preventDefault(); ph.x += mv[0]; ph.y += mv[1]; phRender(); return; }
      if (e.key === '+' || e.key === '=' || e.key === '-') { e.preventDefault(); ph.zoom = Math.max(1, Math.min(3, ph.zoom + (e.key === '-' ? -0.1 : 0.1))); zoom.value = ph.zoom; phRender(); }
    });
  }
  function phSave(btn) {
    if (!ph || !ph.img) return;
    var out = document.createElement('canvas'); out.width = out.height = PH_OUT;
    phDraw(out.getContext('2d'), PH_OUT);
    btn.disabled = true; btn.innerHTML = '<span class="pa-spin-sm" aria-hidden="true"></span>Saving…'; photoErr('');
    out.toBlob(function (blob) {
      var fail = function (err) { btn.disabled = false; btn.textContent = 'Save photo'; photoErr((err && err.message) || 'We couldn’t save your photo. Please try again.'); };
      if (!blob) { fail(); return; }
      PaklanceAuth.profile.savePhoto(blob).then(function () { close(); notify('Profile photo updated.'); }).catch(fail);
    }, 'image/jpeg', 0.88);
  }

  function open(key) {
    var s = BY_KEY[key]; if (!s) return;
    if (s === PHOTO && !user()) { PaklanceAuth.open('login'); return; }
    if (s !== HELP && s !== PHOTO && !data) { var u = user(); if (u) ensure(u, function () { open(key); }); return; }   // forms need the profile first
    ensureModal();
    if (modal.hidden) lastFocus = document.activeElement;
    current = s; saving = false;
    if (s === HELP) paintHelp(); else if (s === PHOTO) paintPhoto(); else paintEditor();
    modal.hidden = false; document.body.style.overflow = 'hidden';
    modal.scrollTop = 0; modal.querySelector('.pa-card').scrollTop = 0;
    setTimeout(function () { focusEl(modal.querySelector('[data-pc-focus]') || modal.querySelector('#pc-h')); }, 40);
  }
  function close() {
    if (!modal || modal.hidden) return;
    var key = current && current.key;
    modal.hidden = true; document.body.style.overflow = ''; current = null;
    if (ph && ph.url) URL.revokeObjectURL(ph.url);
    ph = null;
    vuReset();
    // after a save the page is redrawn, so fall back to the same button in the new markup
    focusEl(lastFocus && document.contains(lastFocus) ? lastFocus : document.querySelector('[data-pc-open="' + key + '"]'));
  }

  function setErr(el, msg) {
    var p = document.getElementById(el.id + '-err'), hint = el.getAttribute('data-hint');
    if (msg) { el.setAttribute('aria-invalid', 'true'); p.textContent = msg; p.hidden = false; el.setAttribute('aria-describedby', (hint ? hint + ' ' : '') + p.id); }
    else { el.removeAttribute('aria-invalid'); p.hidden = true; if (hint) el.setAttribute('aria-describedby', hint); else el.removeAttribute('aria-describedby'); }
  }
  // Same rules as the server (src/routes/talent.js), so a form the UI accepts is never rejected.
  function check(f, raw) {
    var s = String(raw == null ? '' : raw);
    s = f.type === 'textarea' ? s.replace(/\r\n/g, '\n').trim() : s.replace(/\s+/g, ' ').trim();
    var noun = f.noun || f.label;
    if (!s) return f.required ? { error: (f.type === 'select' ? 'Choose ' : 'Enter ') + f.empty + '.' } : { value: null };
    if (f.type === 'select') return f.options.indexOf(s) > -1 ? { value: s } : { error: 'Choose ' + f.empty + '.' };
    if (f.type === 'video') { var v = PaklanceVideo.parse(s); return v ? { value: v.url } : { error: 'Use a link from YouTube, Vimeo, Loom or Google Drive.' }; }
    if (f.type === 'int' || f.type === 'year') {
      var t = s.replace(/[,\s]/g, '').replace(/^PKR/i, '');
      if (!/^\d+$/.test(t)) return { error: f.type === 'year' ? 'Enter a 4-digit year, like ' + (YEAR - 2) + '.' : noun + ' must be a whole number.' };
      var n = Number(t);
      if (f.type === 'year' && (n < f.min || n > f.max)) return { error: 'Enter a year from ' + f.min + ' to ' + f.max + '.' };
      if (n < f.min) return { error: noun + ' must be at least ' + pkr(f.min) + '.' };
      if (n > f.max) return { error: noun + ' must be ' + pkr(f.max) + ' or less.' };
      return { value: n };
    }
    if (f.type === 'url') {
      if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
      if (s.length > f.max || /\s/.test(s) || !/^https?:\/\/[^\/?#]+\.[^\/?#]{2,}/i.test(s)) return { error: 'Enter a valid link, like https://example.com.' };
      return { value: s };
    }
    if (s.length < f.min) return { error: noun + ' must be at least ' + f.min + ' characters.' };
    if (s.length > f.max) return { error: noun + ' must be ' + f.max + ' characters or fewer.' };
    return { value: s };
  }

  function onSubmit(e) {
    e.preventDefault();
    if (saving || !current || !current.fields) return;
    var s = current, form = e.target, out = {}, bad = null;
    var alertBox = form.querySelector('.pa-alert'); alertBox.hidden = true;
    s.fields.forEach(function (f) {
      var el = form.elements[f.name], r = check(f, el.value);
      setErr(el, r.error || ''); if (r.error && !bad) bad = el;
      if (!r.error && (f.type === 'url' || f.type === 'video') && r.value) el.value = r.value;
      out[f.name] = r.value;
    });
    if (!bad && out.startYear && out.endYear && out.endYear < out.startYear) { bad = form.elements.endYear; setErr(bad, 'The end year can’t be before the start year.'); }
    if (bad) { focusEl(bad); return; }

    var btn = form.querySelector('[type="submit"]'), label = btn.textContent;
    saving = true; btn.disabled = true; btn.innerHTML = '<span class="pa-spin-sm" aria-hidden="true"></span>Saving…';
    var req = s.key === 'intro' ? PaklanceAuth.profile.saveIntro(out).then(function (r) { data.profile = r.profile; })
      : s.key === 'video' ? PaklanceAuth.profile.saveVideo(out.url).then(function (r) { data.video = r.video; })
      : PaklanceAuth.profile.addItem(Object.assign({ kind: s.key }, out)).then(function (r) { data.items.push(r.item); });
    req.then(function () {
      saving = false; paint(); close(); notify(s.saved);
    }).catch(function (err) {
      saving = false; btn.disabled = false; btn.textContent = label;
      var first = null;
      if (err && err.fields) Object.keys(err.fields).forEach(function (k) { var el = form.elements[k]; if (el) { setErr(el, err.fields[k]); if (!first) first = el; } });
      if (first) { focusEl(first); return; }
      alertBox.textContent = (err && err.message) || 'Something went wrong. Please try again.'; alertBox.hidden = false;
    });
  }

  function onModalClick(e) {
    if (e.target === modal) { close(); return; }
    var a = e.target.closest('a[href^="#"]');
    if (a) { close(); return; }                                  // in-site link (e.g. the video guide): close, then follow it
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-pc-close')) { close(); return; }
    if (b.hasAttribute('data-pc-open')) { open(b.getAttribute('data-pc-open')); return; }
    if (b.hasAttribute('data-pc-jump')) { var t = document.getElementById(b.getAttribute('data-pc-jump')); if (t) { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); focusEl(t); } return; }
    var sid = b.getAttribute('data-pc-seminar');
    if (sid) {
      if (!user()) { close(); notify('Log in or sign up to register for a seminar.'); PaklanceAuth.open('login'); return; }
      b.disabled = true; b.textContent = 'Registering…';
      PaklanceAuth.seminars.register(sid).then(function (r) {
        var li = b.closest('.sem'); if (li) li.outerHTML = seminarHtml(r.seminar);
        notify('You’re registered for “' + r.seminar.title + '”. We’ll email you the joining details.');
      }).catch(function (err) { b.disabled = false; b.textContent = 'Register free'; notify((err && err.message) || 'Couldn’t register. Please try again.'); });
      return;
    }
    if (b.hasAttribute('data-vu-tab')) { vuTab(b.getAttribute('data-vu-tab')); var fx = modal.querySelector('[data-vu-panel]:not([hidden]) input:not([type="file"])'); focusEl(fx || b); return; }
    if (b.hasAttribute('data-vu-upload')) { vuUpload(b); return; }
    if (b.hasAttribute('data-ph-save')) { phSave(b); return; }
    if (b.hasAttribute('data-ph-remove')) {
      b.disabled = true; b.textContent = 'Removing…';
      PaklanceAuth.profile.removePhoto().then(function () { close(); notify('Profile photo removed.'); })
        .catch(function (err) { b.disabled = false; b.textContent = 'Remove photo'; photoErr((err && err.message) || 'Couldn’t remove the photo. Please try again.'); });
      return;
    }
    if (b.hasAttribute('data-pc-remove-video')) {
      b.disabled = true; b.textContent = 'Removing…';
      PaklanceAuth.profile.saveVideo(null).then(function () { data.video = null; paint(); close(); notify('Video introduction removed.'); })
        .catch(function (err) { b.disabled = false; b.textContent = 'Remove'; notify((err && err.message) || 'Couldn’t remove the video. Please try again.'); });
      return;
    }
    var id = b.getAttribute('data-pc-remove');
    if (id) {
      b.disabled = true; b.textContent = 'Removing…';
      PaklanceAuth.profile.removeItem(id).then(function () {
        data.items = data.items.filter(function (x) { return String(x.id) !== id; });
        paint(); if (current) { paintEditor(); focusEl(modal.querySelector('#pc-h')); }
        notify('Removed.');
      }).catch(function (err) {
        b.disabled = false; b.textContent = 'Remove';
        notify((err && err.message) || 'Couldn’t remove that. Please try again.');
      });
    }
  }
  function onKey(e) {
    if (!modal || modal.hidden) return;
    var tb = e.target && e.target.closest && e.target.closest('[data-vu-tab]');
    if (tb && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); var k = tb.getAttribute('data-vu-tab') === 'upload' ? 'link' : 'upload'; vuTab(k); focusEl(modal.querySelector('[data-vu-tab="' + k + '"]')); return; }
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'Tab') {
      var f = Array.prototype.slice.call(modal.querySelectorAll('button, input, select, textarea, [href], canvas[tabindex]')).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); focusEl(first); }
    }
  }

  function init(o) {
    opts = o || {};
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-pp-tab]');
      if (t) {                                                  // tabs: seller / buyer stats, reviews as freelancer / client
        var box = t.closest('[data-pp-tabs]'), key = t.getAttribute('data-pp-tab');
        box.querySelectorAll('[data-pp-tab]').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        box.querySelectorAll('[data-pp-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-pp-panel') !== key; });
        return;
      }
      var g = e.target.closest('[data-pp-go]');
      if (g) { var sct = document.getElementById('pp-' + g.getAttribute('data-pp-go')); if (sct) sct.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var b = e.target.closest('[data-pc-open],[data-pc-retry]'); if (!b || (modal && modal.contains(b))) return;
      if (b.hasAttribute('data-pc-retry')) { data = null; if (host) mount(host); if (pageHost) mountPage(pageHost); return; }
      open(b.getAttribute('data-pc-open'));
    });
    document.addEventListener('keydown', onKey, true);
    if (window.PaklanceAuth) PaklanceAuth.onChange(function (u) {   // signed out or a different account: forget the old data
      if (!u || (u.id !== dataUser && u.id !== loadingFor)) { data = null; dataUser = null; loadingFor = null; waiters = []; loadRun++; close(); return; }
      if (data && u.id === dataUser) paint();                       // name, skills or photo changed: redraw the dashboard parts and my profile
    });
  }

  return { init: init, mount: mount, mountPage: mountPage, renderPage: renderPage, summary: summary, open: open, avatar: avatar, steps: STEPS.map(function (s) { return s.key; }) };
})();
/* ===== PAKLANCE AUTH MODULE: JS END ===== */
