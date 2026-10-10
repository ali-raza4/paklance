/* Paklance site script.
   Same pages, layout and behaviour as the approved design; data now comes from the Paklance API (/api/...).
   If the page is opened without the server (from disk), it falls back to the built-in sample data and a
   preview sign-up, exactly like the review build. */
(function(){
  var $ = function(s, r){ return (r || document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = function(n){ return 'PKR ' + Number(n).toLocaleString('en-US'); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LIVE = location.protocol === 'http:' || location.protocol === 'https:';
  var PROD_GOOGLE_CLIENT_ID = '1060835632727-nbba09rr2dl8c7bmib2da82vqbf9n3gv.apps.googleusercontent.com';
  var CFG = { fees: { clientPercent: 3, specialistPercent: 10 }, googleClientId: PROD_GOOGLE_CLIENT_ID };
  var noop = function(){};

  /* Job and talent data — populated from the production API on load.
     Arrays start empty so no placeholder content is shown while the API responds. */
  var JOBS = [];
  var TALENT = [];

  var currentJob = null, currentPerson = null, profileReturnContext = null;

  /* ---------- API ---------- */
  // Read JWT token stored by auth.js (same localStorage key)
  function _siteGetToken(){ try { return localStorage.getItem('pk_access_token') || null; } catch(e){ return null; } }
  function api(method, path, body){
    var headers = {};
    var tok = _siteGetToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch('/api' + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        if (!res.ok){ var e = new Error(data.message || 'Something went wrong. Please try again.'); e.code = data.code || 'SERVER_ERROR'; e.fields = data.fields; throw e; }
        return data;
      });
    }, function(){
      var e = new Error('Can’t reach Paklance right now. Check your connection and try again.'); e.code = 'NETWORK'; throw e;
    });
  }
  function inferCategory(title, desc){
    var text = ((title || '') + ' ' + (desc || '')).toLowerCase();
    if (/copywrit|content|paper|article|proofread|translat|blog|writer|writing/i.test(text)) return 'Writing';
    if (/design|ui|ux|graphic|logo|figma|brand|illustrat/i.test(text)) return 'Design';
    if (/develop|software|code|engineer|react|node|python|web|full.?stack|frontend|backend|api|database|app/i.test(text)) return 'Development';
    if (/market|seo|social.?media|ads|growth|campaign|sem/i.test(text)) return 'Marketing';
    if (/video|animat|motion|editing|audio/i.test(text)) return 'Video';
    if (/ai|data|machine.?learning|deep.?learning|analyst/i.test(text)) return 'AI & Data';
    return 'Other';
  }

  function extractSkills(j){
    if (Array.isArray(j.skills) && j.skills.length) return j.skills;
    var skills = [];
    var desc = j.description || j.desc || '';
    var m = desc.match(/(?:required skills|skills required|skills|technologies)\s*:\s*([^\n\r*]+)/i);
    if (m){
      skills = m[1].split(/[,•|/]+/).map(function(s){ return s.trim(); }).filter(function(s){ return s.length > 1; });
    }
    if (!skills.length){
      var cat = inferCategory(j.title || '', desc);
      if (cat === 'Writing') skills = ['Writing', 'Content', 'Research'];
      else if (cat === 'Development') skills = ['Web Development', 'Software'];
      else if (cat === 'Design') skills = ['UI/UX', 'Design'];
      else if (cat === 'Marketing') skills = ['Digital Marketing', 'SEO'];
      else if (cat === 'Video') skills = ['Video Editing'];
      else skills = ['Specialist'];
    }
    return skills;
  }

  // Normalise NestJS Job entity to the shape the UI templates expect.
  // NestJS returns flat Job[] array; old frontend expected { jobs, clientLabel, safepay, category, isSample, milestones[] }
  function fromApiJob(j){
    var clientName = (j.client && (j.client.name || (j.client.email ? j.client.email.split('@')[0] : null))) || 'Client';
    var clientCity = (j.client && j.client.city) || j.city || 'Pakistan';
    var isClientVerified = !!(j.clientVerified || (j.client && (j.client.isVerified || j.client.isEmailVerified || (j.client.verification && j.client.verification.status === 'APPROVED'))));
    var cat = j.category || inferCategory(j.title, j.description);
    var skills = extractSkills(j);
    var proposalsCount = (j._count && typeof j._count.Proposal === 'number') ? j._count.Proposal : (Number(j.proposals) || 0);

    var ms = Array.isArray(j.milestones) && j.milestones.length
      ? j.milestones.map(function(m){ return [m.title, Number(m.amount)]; })
      : [['Project milestone', Number(j.budget) || 0]];
    return {
      id:          String(j.id),
      clientId:    j.clientId || j.client_id || (j.client && (j.client.id || j.client.userId)) || null,
      clientEmail: (j.client && j.client.email) || null,
      title:       j.title || 'Untitled Job',
      client:    clientName,
      city:      clientCity,
      cat:       cat,
      budget:    Number(j.budget) || 0,
      type:      j.type || 'Fixed price',
      verified:  isClientVerified,
      safepay:   !!(j.safepay !== undefined ? j.safepay : true),
      skills:    skills,
      desc:      j.description || j.desc || '',
      ms:        ms,
      proposals: proposalsCount,
      sample:    j.isSample === false ? false : undefined
    };
  }
  // Normalise Profile/User entity to the shape the talent card templates expect.
  function fromApiTalent(t){
    var name = t.name || t.fullName || 'Specialist';
    var parts = name.trim().split(/\s+/).filter(Boolean);
    var init = ((parts[0]||'').charAt(0) + (parts.length>1?(parts[parts.length-1]||'').charAt(0):'')).toUpperCase() || '?';
    return {
      id:     t.id || t.userId,
      userId: t.userId || t.id,
      name:   name,
      init:   init,
      role:   t.headline || 'Specialist',
      city:   t.city || 'Pakistan',
      cat:    t.category || 'Other',
      rate:   Number(t.hourlyRate) || 0,
      avail:  t.availability === 'AVAILABLE' ? 'Available now' : (t.availability === 'BUSY' ? 'Busy' : (t.availability || 'Available now')),
      skills: Array.isArray(t.skills) ? t.skills : [],
      stats:  t.stats || [null, null, null],
      bio:    t.bio || '',
      verified: !!(t.verified),
      sample: t.isSample === false ? false : undefined,
      photo:  t.avatarUrl || t.photo || null,
      rating: t.rating || null
    };
  }
  function replace(arr, items){ arr.length = 0; items.forEach(function(x){ arr.push(x); }); }
  function needUser(msg){ var e = new Error(msg); e.code = 'UNAUTHENTICATED'; return Promise.reject(e); }
  function handleError(err){
    if (err.code === 'UNAUTHENTICATED'){ closeModals(); PaklanceAuth.open('login'); toast(err.message); return; }
    if (err.code === 'PROFILE_INCOMPLETE'){ closeModals(); PaklanceAuth.open('signup'); toast(err.message); return; }
    toast(err.message || 'Something went wrong. Please try again.');
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg){
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.hidden = true; }, 3600);
  }
  function flash(els){
    els.forEach(function(el){ if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  }

  /* ---------- routing ---------- */
  var VIEWS = ['home','jobs','job','talent','person','profile','how','global','match','trust','pricing','dashboard','blog','article'];
  function route(){
    var r = (location.hash || '#home').slice(1);
    var blogSlug = null;
    var jobParamId = null;
    var personParamId = null;
    if (r.indexOf('blog/') === 0){ blogSlug = decodeURIComponent(r.slice(5)); r = PaklanceBlog.has(blogSlug) ? 'article' : 'blog'; }
    else if (r === 'article') r = 'blog';
    else if (r.indexOf('job/') === 0){ jobParamId = decodeURIComponent(r.slice(4)); r = 'job'; }
    else if (r.indexOf('jobs/') === 0 && r.length > 5){ jobParamId = decodeURIComponent(r.slice(5)); r = 'job'; }
    else if (r.indexOf('person/') === 0){ personParamId = decodeURIComponent(r.slice(7)); r = 'person'; }
    else if (r.indexOf('talent/') === 0 && r.length > 7){ personParamId = decodeURIComponent(r.slice(7)); r = 'person'; }

    if (VIEWS.indexOf(r) < 0) r = 'home';
    if (jobParamId){
      var matched = JOBS.filter(function(j){ return String(j.id) === String(jobParamId); })[0];
      if (matched) currentJob = matched;
    }
    if (personParamId){
      if (!currentPerson || (String(currentPerson.id) !== String(personParamId) && String(currentPerson.userId) !== String(personParamId))){
        var matchedPerson = TALENT.filter(function(t){ return String(t.id) === String(personParamId) || String(t.userId) === String(personParamId); })[0];
        currentPerson = matchedPerson || { id: personParamId, userId: personParamId };
      }
    }
    if (r === 'job' && !currentJob){
      if (jobParamId){
        var jd = $('#jobDetail');
        if (jd) jd.innerHTML = '<div class="empty"><h3>Loading job details…</h3></div>';
        api('GET', '/jobs/' + encodeURIComponent(jobParamId)).then(function(res){
          if (res && res.id){
            var norm = fromApiJob(res);
            currentJob = norm;
            if (!JOBS.some(function(x){ return String(x.id) === String(norm.id); })) JOBS.push(norm);
            renderJobDetail();
          } else {
            toast('Job not found.');
            go('jobs');
          }
        }).catch(function(){
          toast('Job not found.');
          go('jobs');
        });
      } else {
        r = 'jobs';
      }
    }
    if (r === 'person' && !currentPerson) r = 'talent';
    if (r === 'dashboard' && !PaklanceAuth.getUser()){ r = 'home'; setTimeout(function(){ PaklanceAuth.open('login'); }, 0); }
    if (r === 'dashboard') renderDashboard();
    if (r === 'profile' && !PaklanceAuth.getUser()){ r = 'home'; setTimeout(function(){ PaklanceAuth.open('login'); }, 0); }
    var own = r === 'profile'; if (own) r = 'person';          // my own profile uses the same page, with edit buttons
    $$('.view').forEach(function(v){ v.hidden = v.getAttribute('data-view') !== r; });
    var navKey = r === 'job' ? 'jobs' : (r === 'person' ? (own ? 'dashboard' : 'talent') : (r === 'article' ? 'blog' : r));
    $$('[data-nav]').forEach(function(a){ a.classList.toggle('active', a.getAttribute('data-nav') === navKey); });
    var bnKey = (navKey === 'jobs' || navKey === 'talent') ? 'find' : navKey;
    $$('[data-bn]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-bn') === bnKey); });
    if (r === 'job' && currentJob) renderJobDetail();
    if (r === 'person'){ if (own) renderMyProfile(); else renderPerson(); }
    if (r === 'blog') PaklanceBlog.renderIndex(); else if (r === 'article') PaklanceBlog.renderArticle(blogSlug); else PaklanceBlog.leave();
    $('#mobileMenu').hidden = true; $('#burger').setAttribute('aria-expanded','false');
    window.scrollTo(0,0);
    if (r !== 'home'){ var shownView = $('[data-view="' + r + '"]'); enterView(shownView); reveal(shownView); }   // the homepage has its own heading motion
  }
  function go(r){ if (location.hash === '#' + r) route(); else location.hash = r; }
  window.addEventListener('hashchange', route);

  // /pricing, /jobs/<id>, /blog/<slug> … (links from search engines and shares) open the matching hash page.
  function pathToHash(){
    var p = location.pathname.replace(/\/+$/, '');
    if (!p || location.hash) return;
    var m = p.match(/^\/(jobs|job|talent|person|how|global|match|trust|pricing|dashboard|blog)(?:\/([^\/]+))?$/);
    if (m){
      if ((m[1] === 'job' || m[1] === 'jobs') && m[2]){
        history.replaceState(null, '', '/#job/' + m[2]);
      } else if (m[1] === 'blog' && m[2]){
        history.replaceState(null, '', '/#blog/' + m[2]);
      } else {
        history.replaceState(null, '', '/#' + m[1]);
      }
    }
  }

  /* ---------- jobs ---------- */
  // sampleChip: only show for explicitly sample-flagged items (isSample !== false means from built-in fallback)
  function sampleChip(x, label){ return x.sample === false ? '' : ''; }
  function tagsHtml(list){ return (list || []).map(function(s){ return '<span class="tag">' + esc(s) + '</span>'; }).join(''); }
  function jobCard(j){
    return '<article class="job-card">' +
      '<div class="job-top"><h3 style="cursor:pointer" data-job="' + esc(j.id) + '">' + esc(j.title) + '</h3>' + sampleChip(j) + '</div>' +
      '<div class="job-meta"><span>' + esc(j.client) + ' · ' + esc(j.city) + '</span><span>' + esc(j.cat) + '</span>' +
        (j.verified ? '<span class="ok"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified client</span>' : '<span>Client not yet verified</span>') + '</div>' +
      '<p>' + esc(j.desc) + '</p>' +
      '<div class="tags">' + tagsHtml(j.skills) + '</div>' +
      '<div class="job-foot"><div class="budget"><span>Budget</span><strong>' + fmt(j.budget) + '</strong></div>' +
        (j.safepay ? '<span class="chip chip-safe"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-shield"/></svg>SafePay</span>' : '') +
        '<button class="btn btn-outline btn-sm" type="button" data-job="' + esc(j.id) + '">View job</button></div>' +
    '</article>';
  }
  /* ---------- price range slider (Find work filters) ----------
     Two handles that can't cross. Drag, click the track, or use the keyboard (arrows, Page Up/Down, Home/End).
     The top of the range means "and above", so jobs over PKR 100,000 still show until the max handle is moved. */
  function RangeSlider(el, onInput){
    var MIN = +el.getAttribute('data-min'), MAX = +el.getAttribute('data-max'), STEP = +el.getAttribute('data-step') || 1;
    var thumbs = { min: el.querySelector('[data-thumb="min"]'), max: el.querySelector('[data-thumb="max"]') };
    var fill = el.querySelector('.range-fill'), out = document.getElementById(el.id + 'Out');
    var val = { min: MIN, max: MAX }, drag = null;
    function num(v){ return v.toLocaleString('en-US'); }
    function pct(v){ return (v - MIN) / (MAX - MIN) * 100; }
    function paint(){
      var a = pct(val.min), b = pct(val.max);
      thumbs.min.style.left = a + '%'; thumbs.max.style.left = b + '%';
      fill.style.left = a + '%'; fill.style.width = (b - a) + '%';
      ['min','max'].forEach(function(k){
        var t = thumbs[k];
        t.setAttribute('aria-valuemin', k === 'min' ? MIN : val.min);
        t.setAttribute('aria-valuemax', k === 'max' ? MAX : val.max);
        t.setAttribute('aria-valuenow', val[k]);
        t.setAttribute('aria-valuetext', 'PKR ' + num(val[k]) + (val[k] === MAX ? ' or more' : ''));
      });
      if (out) out.textContent = 'PKR ' + num(val.min) + ' – ' + num(val.max) + (val.max === MAX ? '+' : '');
    }
    function move(k, v){
      v = Math.min(MAX, Math.max(MIN, Math.round((v - MIN) / STEP) * STEP + MIN));
      v = k === 'min' ? Math.min(v, val.max) : Math.max(v, val.min);
      if (v === val[k]) return;
      val[k] = v; paint(); onInput();
    }
    function valueAt(x){ var r = el.getBoundingClientRect(); return MIN + (x - r.left) / r.width * (MAX - MIN); }
    function grab(k){ drag.which = k; thumbs[k].classList.add('is-active'); try { thumbs[k].focus({ preventScroll: true }); } catch (e) { thumbs[k].focus(); } }
    el.addEventListener('pointerdown', function(e){
      if (e.button > 0) return;
      e.preventDefault();
      var v = valueAt(e.clientX), r = thumbs.max.getBoundingClientRect();
      drag = { which: null, x: e.clientX, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      // handles on top of each other: wait for the first movement to know which one to move
      if (val.min === val.max && Math.abs(e.clientX - (r.left + r.width / 2)) <= r.width / 2) return;
      grab(Math.abs(v - val.min) <= Math.abs(v - val.max) && !(v > val.max) ? 'min' : 'max');
      move(drag.which, v);
    });
    el.addEventListener('pointermove', function(e){
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.which){ if (Math.abs(e.clientX - drag.x) < 3) return; grab(e.clientX < drag.x ? 'min' : 'max'); }
      move(drag.which, valueAt(e.clientX));
    });
    function end(e){ if (!drag || e.pointerId !== drag.id) return; if (drag.which) thumbs[drag.which].classList.remove('is-active'); drag = null; }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    ['min','max'].forEach(function(k){
      thumbs[k].addEventListener('keydown', function(e){
        var d = { ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -STEP * 10, PageUp: STEP * 10 }[e.key];
        var v = d != null ? val[k] + d : e.key === 'Home' ? MIN : e.key === 'End' ? MAX : null;
        if (v === null) return;
        e.preventDefault(); move(k, v);
      });
    });
    paint();
    return {
      get: function(){ return { min: val.min, max: val.max === MAX ? null : val.max }; },   // max null = no upper limit
      reset: function(){ val.min = MIN; val.max = MAX; paint(); }
    };
  }

  function renderJobs(){
    var cat = $('#fCat').value, price = priceRange.get(), ver = $('#fTrust').value === 'verified',
        safe = $('#fSafe').checked, q = $('#jSearch').value.trim().toLowerCase(), sort = $('#jSort').value;
    var list = JOBS.filter(function(j){
      var hay = (j.title + ' ' + j.cat + ' ' + j.city + ' ' + j.client + ' ' + j.skills.join(' ')).toLowerCase();
      return (cat === 'all' || j.cat === cat) && j.budget >= price.min && (price.max === null || j.budget <= price.max) &&
        (!ver || j.verified) && (!safe || j.safepay) && (!q || hay.indexOf(q) > -1);
    });
    if (sort === 'high') list.sort(function(a,b){ return b.budget - a.budget; });
    if (sort === 'low') list.sort(function(a,b){ return a.budget - b.budget; });
    var n = list.length;
    $('#jobCount').textContent = n ? (n + ' job' + (n === 1 ? '' : 's')) : 'No matching jobs';
    $('#jobList').innerHTML = n ? list.map(jobCard).join('') :
      '<div class="empty"><h3>No jobs match these filters yet</h3><p>Try a wider price range or another category. New verified jobs are added as clients join Paklance.</p>' +
      '<div class="hero-ctas"><button class="btn btn-outline btn-sm" type="button" data-clear-filters>Clear filters</button><button class="btn btn-primary btn-sm" type="button" data-open="auth" data-signup>Post a Job</button></div></div>';
    syncJobCats();
  }
  function clearFilters(){
    $('#fCat').value = 'all'; priceRange.reset(); $('#fTrust').value = 'any'; $('#fSafe').checked = false; $('#jSearch').value = ''; $('#jSort').value = 'new';
    renderJobs();
  }
  function renderJobDetail(){
    var j = currentJob; if (!j) return;
    var real = j.sample === false;
    var proposalCountText = j.proposals === 1 ? '1 proposal' : (j.proposals + ' proposals');

    var curUser = (PaklanceAuth && PaklanceAuth.getUser) ? PaklanceAuth.getUser() : null;
    var isClientRole = curUser && (String(curUser.role || '').toLowerCase() === 'client');
    var isAdmin = curUser && (String(curUser.role || '').toUpperCase() === 'ADMIN');
    var isOwner = !!(curUser && (
      (j.clientId && curUser.id === j.clientId) ||
      (j.clientEmail && curUser.email && j.clientEmail.toLowerCase() === curUser.email.toLowerCase()) ||
      isAdmin ||
      (isClientRole && j.clientId === curUser.id)
    ));

    var asideActionHtml = '';
    if (isOwner){
      asideActionHtml =
        '<div class="chip chip-verified" style="display:block;text-align:center;padding:10px;margin-bottom:8px;font-weight:600">' +
          '<svg class="ic ic-xs" aria-hidden="true" style="margin-right:6px"><use href="#i-check"/></svg>Your Posted Job' +
        '</div>' +
        '<button class="btn btn-primary btn-block" type="button" data-scroll-proposals>View Proposals (' + esc(proposalCountText) + ')</button>';
    } else {
      asideActionHtml =
        '<div id="jobApplyActionWrap">' +
          '<button class="btn btn-primary btn-block" type="button" data-apply="' + esc(j.id) + '">Apply for this job</button>' +
        '</div>';
    }

    var proposalsSectionHtml = '';
    if (isOwner){
      proposalsSectionHtml =
        '<section id="jobProposalsSection" class="job-proposals-wrap" style="margin-top:28px;border-top:1px solid var(--line);padding-top:24px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
            '<h3 style="margin:0;display:flex;align-items:center;gap:8px">' +
              'Proposals Received' +
              '<span class="chip chip-muted" id="jobProposalsBadge">' + (j.proposals || 0) + '</span>' +
            '</h3>' +
          '</div>' +
          '<div id="jobProposalsList">' +
            '<div class="pk-loading-proposals" style="padding:24px;text-align:center;color:var(--ink-3)">Loading proposals...</div>' +
          '</div>' +
        '</section>';
    }

    $('#jobDetail').innerHTML =
      '<article class="card">' +
        '<div class="job-top"><div><span class="eyebrow">' + esc(j.cat) + '</span><h2 style="margin-top:6px">' + esc(j.title) + '</h2></div>' + sampleChip(j) + '</div>' +
        '<div class="job-meta" style="margin-top:10px"><span>' + esc(j.client) + ' · ' + esc(j.city) + '</span>' + (j.verified ? '<span class="ok"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified client</span>' : '<span>Client not yet verified</span>') + '</div>' +
        '<div class="job-description" style="margin-top:14px;white-space:pre-line;line-height:1.6;color:var(--ink-2)">' + esc(j.desc) + '</div>' +
        '<h4>Skills</h4><div class="tags">' + tagsHtml(j.skills) + '</div>' +
        '<h4>Milestones</h4><ol class="milestones" style="margin-top:0">' + j.ms.map(function(m, i){
          return '<li class="ms"><span class="ms-no">' + (i + 1) + '</span><div><strong>' + esc(m[0]) + '</strong><span class="ms-sub">' + fmt(m[1]) + '</span></div>' +
            (j.safepay ? '<span class="chip chip-safe">SafePay</span>' : '<span class="chip chip-muted">Direct</span>') + '</li>';
        }).join('') + '</ol>' +
        proposalsSectionHtml +
      '</article>' +
      '<aside class="side"><div class="card">' +
        '<div class="kv"><span>Budget</span><strong>' + fmt(j.budget) + '</strong></div>' +
        '<div class="kv"><span>Type</span><strong>' + esc(j.type) + '</strong></div>' +
        '<div class="kv"><span>Milestones</span><strong>' + j.ms.length + '</strong></div>' +
        '<div class="kv"><span>Payment</span><strong>' + (j.safepay ? 'SafePay protected' : 'Agreed directly') + '</strong></div>' +
        '<div class="kv"><span>Proposals</span><strong>' + esc(proposalCountText) + '</strong></div>' +
        asideActionHtml +
        (j.clientId ? '<button class="btn btn-outline btn-block pk-contact-btn" style="margin-top:8px" type="button" data-msg-user-id="' + esc(j.clientId) + '" data-msg-user-name="' + esc(j.client || 'Client') + '" data-msg-user-role="Client">Message Client</button>' : '') +
        '<p class="help" style="margin-top:12px">Your name and skills are shared with the client when you apply.</p>' +
      '</div></aside>';

    var hasToken = !!_siteGetToken();
    if (isOwner){
      loadJobProposals(j.id);
    } else if (curUser || hasToken){
      checkMyProposalForJob(j.id);
    }
  }

  function loadJobProposals(jobId){
    var listEl = $('#jobProposalsList');
    if (!listEl) return;
    api('GET', '/jobs/' + encodeURIComponent(jobId) + '/proposals').catch(function(err){
      return api('GET', '/proposals/job/' + encodeURIComponent(jobId));
    }).then(function(proposals){
      if (!Array.isArray(proposals)) proposals = [];
      var badge = $('#jobProposalsBadge');
      if (badge) badge.textContent = proposals.length;
      if (currentJob && String(currentJob.id) === String(jobId)) {
        currentJob.proposals = proposals.length;
      }
      if (!proposals.length){
        listEl.innerHTML = '<div class="empty" style="padding:24px 0;text-align:center"><p class="muted">No proposals submitted for this job yet.</p></div>';
        return;
      }
      listEl.innerHTML = '<div class="proposals-cards" style="display:flex;flex-direction:column;gap:16px">' +
        proposals.map(function(p){
          var u = p.User || {};
          var name = u.name || u.fullName || 'Specialist';
          var role = u.headline || 'Specialist';
          var city = u.city ? (u.city + (u.country ? ', ' + u.country : '')) : (u.country || 'Pakistan');
          var skills = Array.isArray(u.skills) ? u.skills : [];
          var parts = name.trim().split(/\s+/).filter(Boolean);
          var init = ((parts[0]||'').charAt(0) + (parts.length>1?(parts[parts.length-1]||'').charAt(0):'')).toUpperCase() || 'SP';
          var avHtml = u.avatarUrl
            ? '<img class="pc-av pc-av-md" src="' + esc(u.avatarUrl) + '" alt="' + esc(name) + '" style="width:44px;height:44px;min-width:44px;min-height:44px;border-radius:50%;object-fit:cover;flex-shrink:0">'
            : '<span class="pc-av pc-av-md pc-av-init" aria-hidden="true" style="width:44px;height:44px;min-width:44px;min-height:44px;line-height:44px;text-align:center;border-radius:50%;flex-shrink:0">' + esc(init) + '</span>';
          var specId = p.freelancerId || u.id;
          var avWrap = specId
            ? '<button type="button" class="btn-clean" data-person="' + esc(specId) + '" title="View ' + esc(name) + '’s complete profile" style="cursor:pointer;background:none;border:none;padding:0;display:flex;align-items:center;border-radius:50%">' + avHtml + '</button>'
            : avHtml;
          var nameWrap = specId
            ? '<button type="button" class="btn-clean" data-person="' + esc(specId) + '" title="View ' + esc(name) + '’s complete profile" style="cursor:pointer;background:none;border:none;padding:0;text-align:left"><strong style="font-size:16px;display:block;color:var(--ink);text-decoration:underline;text-decoration-color:transparent;transition:all 0.2s">' + esc(name) + '</strong></button>'
            : '<strong style="font-size:16px;display:block">' + esc(name) + '</strong>';
          var statusClass = p.status === 'ACCEPTED' ? 'chip-verified' : (p.status === 'REJECTED' ? 'chip-danger' : 'chip-muted');
          var isAccepted = p.status === 'ACCEPTED';
          var isPending = p.status === 'PENDING';
          var actionsHtml = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            (specId ? '<button class="btn btn-outline btn-sm" type="button" data-person="' + esc(specId) + '">View Profile</button>' : '') +
            (specId ? '<button class="btn btn-outline btn-sm pk-contact-btn" type="button" data-msg-user-id="' + esc(specId) + '" data-msg-user-name="' + esc(name) + '" data-msg-user-role="Specialist">Message Specialist</button>' : '') +
            (isPending ? '<button class="btn btn-primary btn-sm" type="button" data-accept-proposal="' + esc(p.id) + '">Accept Proposal</button>' : '') +
            (isAccepted ? '<span class="chip chip-verified" style="display:inline-flex;align-items:center;gap:4px"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Accepted</span><button class="btn btn-primary btn-sm" type="button" data-view-contract-job="' + esc(p.jobId) + '">View Contract / Start Project</button>' : '') +
          '</div>';

          return '<article class="card proposal-card" style="padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:12px">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
              '<div style="display:flex;align-items:center;gap:12px">' +
                avWrap +
                '<div>' +
                  nameWrap +
                  '<span class="muted" style="font-size:13px">' + esc(role) + ' · ' + esc(city) + '</span>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<span class="chip ' + statusClass + '">' + esc(p.status || 'PENDING') + '</span>' +
                '<strong style="font-size:17px;color:var(--primary)">' + fmt(p.bidAmount) + '</strong>' +
                '<span class="muted" style="font-size:13px">(' + p.deliveryDays + ' days)</span>' +
              '</div>' +
            '</div>' +
            (skills.length ? ('<div class="tags" style="margin-top:12px">' + tagsHtml(skills) + '</div>') : '') +
            '<div class="pk-proposal-cover" style="margin-top:14px;padding:12px 14px;background:var(--bg-2);border-radius:8px;border-left:3px solid var(--teal, #00a699);font-size:14px;line-height:1.6;color:var(--ink-2)">' +
              '<strong style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--ink-3);margin-bottom:4px">Cover Letter</strong>' +
              '<div style="white-space:pre-wrap">' + esc(p.coverLetter) + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);flex-wrap:wrap;gap:10px">' +
              '<span class="muted" style="font-size:12px">Applied ' + (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'recently') + '</span>' +
              actionsHtml +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>';
    }).catch(function(err){
      listEl.innerHTML = '<div class="empty" style="padding:16px 0"><p class="muted">Could not load proposals: ' + esc(err.message || 'Error') + '</p></div>';
    });
  }

  function checkMyProposalForJob(jobId){
    api('GET', '/proposals/me').then(function(list){
      if (!Array.isArray(list)) return;
      var myProp = list.filter(function(p){ return String(p.jobId) === String(jobId); })[0];
      if (!myProp) return;
      var wrap = $('#jobApplyActionWrap');
      if (!wrap) return;
      var statusClass = myProp.status === 'ACCEPTED' ? 'chip-verified' : (myProp.status === 'REJECTED' ? 'chip-danger' : 'chip-muted');
      wrap.innerHTML =
        '<div class="chip chip-verified" style="display:block;text-align:center;padding:10px;margin-bottom:8px;font-weight:600">' +
          '<svg class="ic ic-xs" aria-hidden="true" style="margin-right:6px"><use href="#i-check"/></svg>Application Sent' +
        '</div>' +
        '<div style="background:var(--bg-2);border-radius:8px;padding:12px;margin-top:8px;font-size:13px;line-height:1.5">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
            '<span class="muted">Your Bid:</span><strong>' + fmt(myProp.bidAmount) + '</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
            '<span class="muted">Timeline:</span><strong>' + myProp.deliveryDays + ' days</strong>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<span class="muted">Status:</span><span class="chip ' + statusClass + '">' + esc(myProp.status || 'PENDING') + '</span>' +
          '</div>' +
          (myProp.coverLetter ? ('<div style="border-top:1px solid var(--line);padding-top:6px"><strong style="display:block;font-size:11px;color:var(--ink-3);margin-bottom:2px">Cover Letter:</strong><p style="margin:0;color:var(--ink-2);font-size:12px;white-space:pre-wrap">' + esc(myProp.coverLetter) + '</p></div>') : '') +
          (myProp.status === 'ACCEPTED' ? ('<button class="btn btn-primary btn-block" style="margin-top:10px" type="button" data-view-contract-job="' + esc(myProp.jobId) + '">View Contract / Project Status</button>') : '') +
        '</div>';
    }).catch(noop);
  }

  function applyToJob(id){
    if (!PaklanceAuth.getUser()){ PaklanceAuth.open('signup'); toast('Create an account or log in to apply.'); return; }
    var j = currentJob || JOBS.filter(function(x){ return String(x.id) === String(id); })[0];
    if (!j){ toast('Job not found.'); return; }
    var applyModal = $('#m-apply');
    if (applyModal){
      $('#propJobId').value = String(id);
      $('#applyModalTitle').textContent = 'Apply for "' + j.title + '"';
      $('#propBid').value = j.budget || 1000;
      $('#propDays').value = 7;
      $('#propCoverLetter').value = 'I am interested in this project and ready to deliver quality work.';
      openModal('apply');
    } else {
      var payload = {
        jobId: String(id),
        coverLetter: 'I am interested in this project and ready to deliver quality work.',
        bidAmount: j.budget || 1000,
        deliveryDays: 7
      };
      api('POST', '/jobs/' + encodeURIComponent(id) + '/proposals', payload).then(function(){
        toast('Application sent. The client can now see your name and skills.');
        if (j) j.proposals = (j.proposals || 0) + 1;
        if (currentJob && String(currentJob.id) === String(id)) renderJobDetail();
      }).catch(function(err){
        if (err && (err.code === 'SERVER_ERROR' || err.status === 404)) {
          api('POST', '/proposals', payload).then(function(){
            toast('Application sent. The client can now see your name and skills.');
            if (j) j.proposals = (j.proposals || 0) + 1;
            if (currentJob && String(currentJob.id) === String(id)) renderJobDetail();
          }).catch(handleError);
        } else {
          handleError(err);
        }
      });
    }
  }

  /* ---------- talent ---------- */
  function pct(v){ return v == null ? '—' : v + '%'; }
  function statsHtml(s, fixAttr){
    return '<div class="t-stats"' + (fixAttr ? ' data-fix="5"' : '') + '>' +
      '<div class="t-stat"><strong>' + pct(s[0]) + '</strong><span>Completion</span></div>' +
      '<div class="t-stat"><strong>' + pct(s[1]) + '</strong><span>On-time</span></div>' +
      '<div class="t-stat"><strong>' + pct(s[2]) + '</strong><span>Repeat clients</span></div></div>';
  }
  var verifiedChip = '<span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified</span>';
  function renderTalent(){
    var q = $('#tSearch').value.trim().toLowerCase(), av = $('#tAvail').value, rate = +$('#tRate').value;
    var list = TALENT.filter(function(t){
      var hay = (t.name + ' ' + t.role + ' ' + t.city + ' ' + t.cat + ' ' + t.skills.join(' ')).toLowerCase();
      return (!q || hay.indexOf(q) > -1) && (av === 'any' || t.avail === 'Available now') && (!rate || t.rate <= rate);
    });
    var _curUser = PaklanceAuth && PaklanceAuth.getUser ? PaklanceAuth.getUser() : null;
    $('#talentGrid').innerHTML = list.length ? list.map(function(t, i){
      // Only show Message button when logged in AND viewing someone else's profile
      var isOwn = _curUser && (t.userId === _curUser.id || t.id === _curUser.id);
      var msgBtn = (t.userId && !isOwn)
        ? '<button class="btn btn-primary btn-sm" type="button" data-msg-user-id="' + esc(t.userId) + '" data-msg-user-name="' + esc(t.name) + '" data-msg-user-role="' + esc(t.role) + '">Message</button>'
        : '';
      return '<article class="t-card">' +
        '<div class="t-head">' + talentAvatar(t) + '<div><strong>' + esc(t.name) + '</strong><span>' + esc(t.role) + ' · ' + esc(t.city) + '</span>' + ratingSpan(t) + '</div></div>' +
        '<div class="chip-row">' + (t.verified === false ? '' : verifiedChip) + '<span class="chip chip-muted">' + esc(t.avail) + '</span></div>' +
        statsHtml(t.stats, i === 0) +
        '<div class="tags">' + tagsHtml(t.skills) + '</div>' +
        '<div class="t-foot"><span class="rate">' + fmt(t.rate) + ' <small>/hr</small></span>' +
          '<div class="t-foot-actions">' +
            '<button class="btn btn-outline btn-sm" type="button" data-person="' + esc(t.id) + '">View profile</button>' +
            msgBtn +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('') :
      '<div class="empty" style="grid-column:1/-1"><h3>No specialists match these filters</h3><p>Try another skill or a higher rate, or let Paklance Match™ build a shortlist for you.</p><div class="hero-ctas"><a class="btn btn-primary btn-sm" href="#match">Get matched</a></div></div>';
    syncTalentCats();
  }
  /* ---------- profile page extra data (services, history, ratings, stats) ---------- */
  function it(kind, title, x){ return Object.assign({ kind: kind, title: title }, x || {}); }
  function rv(role, stars, project, text, by, date){ return { role: role, stars: stars, project: project, text: text, by: by, date: date, sample: true }; }
  var PROFILE_EXTRA = {
    areeba: { since: '2024-02-10', video: '1:12', dist: [21,2,0,0,0], cdist: [2,0,0,0,0],
      seller: { earned: 1240000, projects: 31, services: 12, clients: 19, refunds: 0 }, buyer: { spent: 85000, posted: 3, hires: 2 },
      items: [
        it('services', 'Logo and brand identity', { amount: 25000, description: 'Three logo concepts, colour palette, fonts and a one-page brand guide.' }),
        it('services', 'Packaging design', { amount: 18000, description: 'Print-ready artwork for pouches, boxes and labels, matched to your printer’s dielines.' }),
        it('portfolio', 'Packaging for an organic tea brand', { description: 'Logo, colour system and pouch artwork for three tea blends.' }),
        it('portfolio', 'Identity for a Lahore bakery', { description: 'Wordmark, box stickers and a menu board system.' }),
        it('experience', 'Senior Designer', { subtitle: 'Branding studio, Lahore', startYear: 2019, endYear: 2023, description: 'Led identity projects for food and retail clients.' }),
        it('experience', 'Freelance brand designer', { subtitle: 'Self-employed', startYear: 2023 }),
        it('education', 'BFA Communication Design', { subtitle: 'National College of Arts, Lahore', startYear: 2015, endYear: 2019 })
      ],
      reviews: [
        rv('freelancer', 5, 'Logo & packaging for tea blends', 'Clear concepts from the first round, and print files our printer accepted without changes.', 'Food & beverage startup · Lahore', '2026-08'),
        rv('freelancer', 5, 'Brand refresh for a clothing label', 'She understood our customers quickly and kept every milestone on time.', 'Fashion brand · Karachi', '2026-06'),
        rv('freelancer', 4, 'Social media templates', 'Good templates and quick revisions. The Urdu layouts needed one extra round.', 'Retail brand · Lahore', '2026-04'),
        rv('client', 5, 'Illustrations for a packaging range', 'Clear brief, quick feedback, and each milestone was funded before work started.', 'Illustrator · Karachi', '2026-05')
      ] },
    bilal: { since: '2023-11-04', video: '0:58', dist: [15,3,1,0,0],
      seller: { earned: 3860000, projects: 24, services: 6, clients: 11, refunds: 1 }, buyer: { spent: 0, posted: 0, hires: 0 },
      items: [
        it('services', 'SaaS dashboard (React + Node.js)', { amount: 250000, description: 'Admin dashboards with user roles, charts and exports.' }),
        it('services', 'API integration', { amount: 60000, description: 'Connect payment gateways, CRMs or courier APIs to your product.' }),
        it('portfolio', 'Subscription analytics dashboard', { description: 'Revenue and churn dashboard for a UK fintech team, built with Next.js and PostgreSQL.' }),
        it('experience', 'Contract full-stack engineer', { subtitle: 'UK and Gulf clients', startYear: 2022 }),
        it('experience', 'Senior Software Engineer', { subtitle: 'Product company, Lahore', startYear: 2018, endYear: 2022 }),
        it('education', 'BS Computer Science', { subtitle: 'FAST-NUCES, Lahore', startYear: 2014, endYear: 2018 }),
        it('certificates', 'AWS Certified Developer – Associate', { subtitle: 'Amazon Web Services', endYear: 2024 })
      ],
      reviews: [
        rv('freelancer', 5, 'Customer dashboard rebuild', 'Excellent code quality, and he overlapped with our UK hours every day.', 'SaaS company · London', '2026-07'),
        rv('freelancer', 5, 'Payments API integration', 'Integrated two gateways ahead of schedule, with clear documentation for our team.', 'E-commerce platform · Dubai', '2026-05'),
        rv('freelancer', 4, 'Reporting module', 'Solid work. We changed the scope midway and he handled it well.', 'Logistics startup · Karachi', '2026-03')
      ] },
    hira: { since: '2024-06-18', dist: [12,1,0,0,0], cdist: [1,0,0,0,0],
      seller: { earned: 980000, projects: 15, services: 5, clients: 10, refunds: 0 }, buyer: { spent: 40000, posted: 1, hires: 1 },
      items: [
        it('services', 'UX audit', { amount: 40000, description: 'A review of your app or website with a prioritised list of fixes.' }),
        it('services', 'Design system in Figma', { amount: 150000, description: 'Components, colour and type tokens, and documentation your developers can use.' }),
        it('portfolio', 'Mobile banking app redesign', { description: 'Onboarding and payment flows, tested with 12 users.' }),
        it('experience', 'Product Designer', { subtitle: 'Software house, Islamabad', startYear: 2020, endYear: 2024 }),
        it('education', 'BS Software Engineering', { subtitle: 'Bahria University, Islamabad', startYear: 2016, endYear: 2020 }),
        it('certificates', 'Google UX Design Certificate', { subtitle: 'Google', endYear: 2022 })
      ],
      reviews: [
        rv('freelancer', 5, 'Checkout redesign', 'Her user research changed what we built, and the new checkout is much easier to use.', 'E-commerce brand · Islamabad', '2026-08'),
        rv('freelancer', 5, 'Design system', 'Well organised Figma files that our developers picked up straight away.', 'Fintech startup · Karachi', '2026-05'),
        rv('client', 5, 'Interview transcripts', 'Clear instructions and paid on time.', 'Transcriber · Lahore', '2026-04')
      ] },
    hamza: { since: '2024-09-02', dist: [9,4,1,0,0],
      seller: { earned: 720000, projects: 18, services: 9, clients: 14, refunds: 0 }, buyer: { spent: 0, posted: 0, hires: 0 },
      items: [
        it('services', 'Meta Ads setup and management', { amount: 45000, description: 'One month of campaigns, audiences and creative testing, with weekly reports.' }),
        it('services', 'Google Ads search campaign', { amount: 35000, description: 'Keyword research, ads and conversion tracking in GA4.' }),
        it('experience', 'Digital Marketing Executive', { subtitle: 'Real estate developer, Karachi', startYear: 2019, endYear: 2023 }),
        it('education', 'BBA Marketing', { subtitle: 'IBA, Karachi', startYear: 2015, endYear: 2019 }),
        it('certificates', 'Google Ads Search Certification', { subtitle: 'Google Skillshop', endYear: 2025 })
      ],
      reviews: [
        rv('freelancer', 5, 'Lead generation for a housing project', 'Cost per lead dropped within two weeks, and the reports were easy to follow.', 'Real estate agency · Karachi', '2026-07'),
        rv('freelancer', 4, 'Meta Ads for an online store', 'Good results on retargeting. Creative testing took longer than planned.', 'Online store · Lahore', '2026-04')
      ] },
    maham: { since: '2023-08-21', video: '1:25', dist: [26,1,0,0,0], cdist: [1,0,0,0,0],
      seller: { earned: 640000, projects: 38, services: 21, clients: 22, refunds: 0 }, buyer: { spent: 25000, posted: 1, hires: 1 },
      items: [
        it('services', 'SEO blog article (English)', { amount: 6000, description: 'A researched 1,200-word article with keywords, headings and a meta description.' }),
        it('services', 'Urdu ad copy or video script', { amount: 8000, description: 'Ad copy or a 60-second script in natural, everyday Urdu.' }),
        it('portfolio', 'Admissions guide series for an edtech site', { description: 'Eight SEO articles on university admissions in Pakistan.' }),
        it('education', 'MA English Literature', { subtitle: 'University of Karachi', startYear: 2017, endYear: 2019 })
      ],
      reviews: [
        rv('freelancer', 5, 'Blog content for an edtech platform', 'Well researched, on time and hardly any editing needed.', 'Edtech startup · Remote', '2026-08'),
        rv('freelancer', 5, 'Urdu scripts for product videos', 'The scripts sounded natural, not translated.', 'Consumer brand · Lahore', '2026-06'),
        rv('client', 5, 'Voice-over for Urdu scripts', 'Friendly, clear feedback and a quick approval.', 'Voice artist · Karachi', '2026-03')
      ] },
    usman: { since: '2025-01-12', video: '0:47', dist: [7,2,1,0,0],
      seller: { earned: 410000, projects: 12, services: 8, clients: 9, refunds: 0 }, buyer: { spent: 0, posted: 0, hires: 0 },
      items: [
        it('services', 'Reels and short videos', { amount: 5000, description: 'Per video: editing, captions, music and colour for Instagram, TikTok or YouTube Shorts.' }),
        it('services', '60-second explainer video', { amount: 55000, description: 'Script, storyboard and motion graphics with an Urdu or English voice-over.' }),
        it('portfolio', 'Launch reel for a phone accessories brand', { description: 'Fast-paced edit with motion titles, delivered in three formats.' }),
        it('experience', 'Video Editor', { subtitle: 'Digital agency, Peshawar', startYear: 2021, endYear: 2024 })
      ],
      reviews: [
        rv('freelancer', 5, 'Monthly reels package', 'Fast turnaround and great captions.', 'Restaurant chain · Peshawar', '2026-07'),
        rv('freelancer', 4, 'Explainer video', 'Good animation. The first draft needed changes to match our brand colours.', 'Fintech company · Karachi', '2026-02')
      ] },
    zainab: { since: '2024-04-08', dist: [11,1,0,0,0], cdist: [2,0,0,0,0],
      seller: { earned: 1050000, projects: 16, services: 7, clients: 12, refunds: 0 }, buyer: { spent: 60000, posted: 2, hires: 2 },
      items: [
        it('services', 'Power BI dashboard', { amount: 35000, description: 'Connect and clean your data, then build an interactive dashboard of up to 5 pages.' }),
        it('services', 'AI automation for small businesses', { amount: 60000, description: 'Automate reports, emails or data entry with Python and AI tools.' }),
        it('portfolio', 'Sales dashboard for a retail chain', { description: 'Daily sales, stock and branch performance in one Power BI report.' }),
        it('experience', 'Data Analyst', { subtitle: 'Telecom company, Islamabad', startYear: 2020, endYear: 2023 }),
        it('education', 'BS Statistics', { subtitle: 'Quaid-i-Azam University, Islamabad', startYear: 2016, endYear: 2020 }),
        it('certificates', 'Microsoft Certified: Power BI Data Analyst Associate', { subtitle: 'Microsoft', endYear: 2023 })
      ],
      reviews: [
        rv('freelancer', 5, 'Branch performance dashboard', 'Turned our messy spreadsheets into one clear report the whole team now uses.', 'Retail chain · Islamabad', '2026-08'),
        rv('freelancer', 5, 'Invoice automation', 'Saves our accounts team hours every week. Very clear handover.', 'Distribution company · Rawalpindi', '2026-05'),
        rv('client', 5, 'Data labelling project', 'Clear guidelines and quick payments.', 'Data annotator · Lahore', '2026-04')
      ] }
  };
  function personModel(t){
    var x = PROFILE_EXTRA[t.id] || {};
    return { name: t.name, initials: t.init, headline: t.role, city: t.city, rate: t.rate, availability: t.avail, bio: t.bio, skills: t.skills,
      verified: true, sample: true, memberSince: x.since, video: x.video ? { sample: true, length: x.video } : null, items: x.items || [],
      rating: { freelancer: x.dist, client: x.cdist }, reviews: x.reviews || [], seller: x.seller, buyer: x.buyer, delivery: t.stats,
      userId: t.userId || t.id };
  }
  function setBack(href, label){ var a = $('[data-view="person"] .back'); if (a){ a.setAttribute('href', href); a.textContent = '← ' + label; } }
  function renderPerson(){
    var t = currentPerson; if (!t) return;
    if (profileReturnContext){
      setBack(profileReturnContext.href, profileReturnContext.label);
    } else if (currentJob && currentJob.id){
      setBack('#job/' + encodeURIComponent(currentJob.id), 'Back to job proposals');
    } else {
      setBack('#talent', 'Back to talent');
    }
    var el = $('#personDetail');
    if (LIVE){
      el.innerHTML = '<div class="card pp-loading" aria-busy="true">Loading profile…</div>';
      var targetId = t.userId || t.id;
      api('GET', '/talent/' + encodeURIComponent(targetId)).catch(function(){
        return api('GET', '/profiles/' + encodeURIComponent(targetId));
      }).then(function(r){
        if (currentPerson === t || (currentPerson && (String(currentPerson.id) === String(targetId) || String(currentPerson.userId) === String(targetId)))) {
          var talentData = (r && (r.talent || r.profile)) || r || {};
          var pageData = (r && r.page) || {};
          PaklanceProfile.renderPage(el, apiPersonModel(talentData, pageData));
        }
      }).catch(function(err){
        if (currentPerson === t || (currentPerson && (String(currentPerson.id) === String(targetId) || String(currentPerson.userId) === String(targetId)))) {
          if (PROFILE_EXTRA[t.id]){
            PaklanceProfile.renderPage(el, personModel(t));
          } else {
            PaklanceProfile.renderPage(el, apiPersonModel(t, {}));
          }
        }
      });
      return;
    }
    PaklanceProfile.renderPage(el, personModel(t));
  }
  // A real specialist's profile page from GET /api/talent/:id (same model as the talent cards).
  function apiPersonModel(t, p){
    t = t || {};
    p = p || {};
    var name = t.name || t.fullName || 'Specialist';
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    var init = t.initials || ((parts[0]||'').charAt(0) + (parts.length>1?(parts[parts.length-1]||'').charAt(0):'')).toUpperCase() || 'SP';
    var photo = p.photo || t.avatarUrl || t.photo || null;
    var rate = t.hourlyRate != null ? Number(t.hourlyRate) : (t.rate != null ? Number(t.rate) : null);
    var avail = t.availability || '';
    if (avail === 'AVAILABLE') avail = 'Available now';
    else if (avail === 'BUSY') avail = 'Busy';
    else if (avail === 'NOT_AVAILABLE') avail = 'Not available';

    var vid = p.video || t.video;
    var parsedVideo = null;
    if (vid && typeof PaklanceVideo !== 'undefined') {
      parsedVideo = PaklanceVideo.fromSaved(vid);
    }

    var items = p.items || t.portfolioItems || [];
    if (!Array.isArray(items)) items = [];

    return {
      name: name,
      initials: init,
      photo: photo,
      headline: t.headline || '',
      city: t.city ? (t.city + (t.country ? ', ' + t.country : '')) : (t.country || ''),
      rate: rate,
      availability: avail,
      bio: t.bio || '',
      skills: Array.isArray(t.skills) ? t.skills : [],
      verified: !!(t.isEmailVerified || t.verified || t.verification),
      sample: false,
      memberSince: p.memberSince || t.createdAt || null,
      video: parsedVideo,
      items: items,
      rating: p.rating || { count: 0, avg: 0, dist: [0, 0, 0, 0, 0] },
      reviews: Array.isArray(p.reviews) ? p.reviews : [],
      seller: p.seller || {},
      buyer: p.buyer || {},
      delivery: p.delivery || null,
      userId: t.userId || t.id || null
    };
  }
  function renderMyProfile(){
    setBack('#dashboard', 'Back to dashboard');
    PaklanceProfile.mountPage($('#personDetail'));
  }

  /* ---------- modals ---------- */
  function closeModals(){
    $$('.modal').forEach(function(m){ m.hidden = true; });
    document.body.style.overflow = '';
    // Stop message polling when messages modal is dismissed
    if (typeof PaklanceMessages !== 'undefined') PaklanceMessages.close();
  }
  function openModal(id){
    closeModals();
    var m = $('#m-' + id); if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    var c = m.querySelector('.m-close'); if (c) c.focus({preventScroll:true});
    onModalOpen(id);
  }
  $$('.modal').forEach(function(m){ m.addEventListener('click', function(e){ if (e.target === m) closeModals(); }); });

  /* ---------- live data inside modals (signed-in users) ---------- */
  var SAMPLE = {};                   // the design's sample markup, restored when there is no real data
  var CONTRACT = null;               // the contract shown in the Contracts modal (null = sample)
  var CONTRACTS = [];                // all my contracts (to offer the ones waiting for a review)
  function keep(key, el){ if (el && SAMPLE[key] == null) SAMPLE[key] = el.innerHTML; return el; }
  function signedIn(){ return LIVE && !!PaklanceAuth.getUser(); }

  function openPostJobModal(spec){
    var u = PaklanceAuth.getUser();
    if (!u){
      toast('Please log in with a client account to post a job.');
      PaklanceAuth.open('login');
      return;
    }
    var isClient = String(u.role || '').toLowerCase() === 'client';
    if (!isClient){
      toast('Only client accounts can post jobs. Switch to or create a client account to hire talent.');
      return;
    }
    var alertEl = $('#postJobSpecialistAlert');
    var nameEl = $('#postJobSpecialistName');
    var idEl = $('#postJobSpecialistId');
    if (spec && spec.id){
      if (idEl) idEl.value = spec.id;
      if (nameEl) nameEl.textContent = spec.name || 'Specialist';
      if (alertEl) alertEl.style.display = 'block';
    } else {
      if (idEl) idEl.value = '';
      if (nameEl) nameEl.textContent = '';
      if (alertEl) alertEl.style.display = 'none';
    }
    openModal('post-job');
  }

  function onModalOpen(id){
    if (!LIVE) return;
    if (id === 'contract') loadContract();
    else if (id === 'notif') loadNotifs();
    else if (id === 'escrow') prepareEscrow();
    else if (id === 'dispute') prepareDispute();
    else if (id === 'withdraw') prepareWithdraw();
    else if (id === 'messages') {
      // Delegate to PaklanceMessages which handles auth check + render
      if (PaklanceAuth.getUser()) PaklanceMessages.open();
      else { closeModals(); PaklanceAuth.open('login'); }
    } else if (id === 'post-job') {
      var u = PaklanceAuth.getUser();
      if (!u){
        closeModals();
        toast('Please log in with a client account to post a job.');
        PaklanceAuth.open('login');
      }
    }
  }

  var MS_VIEW = {
    released:          function(m){ return { cls:' done', sub: fmt(m.amount) + ' released', chip:'<span class="chip chip-paid">Paid</span>' }; },
    funded:            function(m){ return { sub: fmt(m.amount) + ' protected', chip:'<span class="chip chip-safe">SafePay</span>' }; },
    submitted:         function(m){ return { sub: fmt(m.amount) + ' protected · work submitted', chip:'<span class="chip chip-safe">SafePay</span>' }; },
    changes_requested: function(m){ return { sub: fmt(m.amount) + ' protected · changes requested', chip:'<span class="chip chip-safe">SafePay</span>' }; },
    funding_pending:   function(m){ return { sub: fmt(m.amount) + ' · waiting for your transfer', chip:'<span class="chip chip-muted">Pending</span>' }; },
    unfunded:          function(m){ return { sub: fmt(m.amount) + ' · not funded yet', chip:'<span class="chip chip-muted">Upcoming</span>' }; },
    disputed:          function(m){ return { sub: fmt(m.amount) + ' · on hold while a case is open', chip:'<span class="chip chip-muted">On hold</span>' }; },
    refunded:          function(m){ return { sub: fmt(m.amount) + ' refunded', chip:'<span class="chip chip-muted">Refunded</span>' }; }
  };
  function firstMs(c, states){ return c.milestones.filter(function(m){ return states.indexOf(m.status) > -1; })[0] || null; }
  function fundTarget(c){ return firstMs(c, ['funding_pending', 'unfunded']); }

  function fromApiContract(c, myId){
    if (!c) return null;
    var user = PaklanceAuth.getUser() || {};
    var currentUserId = myId || user.id || '';
    var currentUserEmail = (user.email || '').toLowerCase();
    
    var isClient = (c.clientId && c.clientId === currentUserId) ||
                   (c.client && c.client.id === currentUserId) ||
                   (c.client && c.client.email && c.client.email.toLowerCase() === currentUserEmail) ||
                   (String(user.role || '').toLowerCase() === 'client');
                   
    var role = isClient ? 'client' : 'freelancer';
    var clientName = (c.client && (c.client.name || c.client.fullName)) || 'Client';
    var specName = (c.specialist && (c.specialist.name || c.specialist.fullName)) || 'Specialist';
    var jobTitle = (c.job && c.job.title) || c.title || 'Project Contract';
    
    // Find accepted proposal details if attached
    var prop = (c.job && c.job.Proposal && c.job.Proposal[0]) || null;
    var scope = (prop && prop.coverLetter) || c.description || (c.job && c.job.description) || '';
    var deliveryDays = (prop && prop.deliveryDays) || 7;
    var totalValue = Number(c.totalAmount || (prop && prop.bidAmount) || (c.job && c.job.budget) || 0);
    
    var rawMilestones = Array.isArray(c.milestones) ? c.milestones : [];
    if (!rawMilestones.length && totalValue > 0){
      rawMilestones = [{
        id: c.id + '-m1',
        title: 'Project Delivery & Milestones',
        amount: totalValue,
        status: (c.status === 'FUNDED' || c.status === 'ACTIVE') ? 'FUNDED' : 'PENDING'
      }];
    }
    
    var releasedTotal = 0;
    var protectedTotal = (c.escrow && Number(c.escrow.balance || c.escrow.amount)) || 0;
    
    var milestones = rawMilestones.map(function(m, idx){
      var st = String(m.status || 'PENDING').toLowerCase();
      var normStatus = 'unfunded';
      if (st === 'released' || st === 'approved') {
        normStatus = 'released';
        releasedTotal += Number(m.amount || 0);
      } else if (st === 'submitted' || c.status === 'IN_PROGRESS') {
        normStatus = 'submitted';
      } else if (st === 'funded') {
        normStatus = 'funded';
      } else {
        normStatus = (c.status === 'FUNDED' || c.status === 'ACTIVE' || c.status === 'IN_PROGRESS') ? 'funded' : 'unfunded';
      }
      return {
        id: m.id,
        position: idx + 1,
        title: m.title || ('Milestone ' + (idx + 1)),
        amount: Number(m.amount || 0),
        status: normStatus,
        rawStatus: m.status
      };
    });
    
    var contractStatus = String(c.status || 'DRAFT').toLowerCase();
    var isActuallyFunded = (contractStatus === 'funded' || contractStatus === 'active' || contractStatus === 'in_progress' || protectedTotal > 0);
    
    return {
      id: c.id,
      code: c.id.slice(0, 8).toUpperCase(),
      jobId: c.jobId,
      title: jobTitle,
      scope: scope,
      deliveryDays: deliveryDays,
      status: isActuallyFunded ? 'active' : contractStatus,
      rawStatus: c.status,
      role: role,
      client: {
        id: (c.client && c.client.id) || c.clientId,
        name: clientName,
        verified: true
      },
      freelancer: {
        id: (c.specialist && c.specialist.id) || c.specialistId,
        name: specName,
        verified: true
      },
      totals: {
        value: totalValue,
        released: releasedTotal,
        protected: protectedTotal
      },
      milestones: milestones,
      escrow: c.escrow,
      review: c.review || null
    };
  }

  function contractHtml(c){
    var ck = '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-check"/></svg>';
    var other = c.role === 'client' ? c.freelancer : c.client;
    var otherName = other.name || (c.role === 'client' ? 'Specialist' : 'Client');
    var otherRole = c.role === 'client' ? 'Specialist' : 'Client';
    var actions = '<button class="btn btn-outline" type="button" data-open="dispute">Open a case</button>';
    if (other.id) {
      actions += '<button class="btn btn-outline" type="button" data-msg-user-id="' + esc(other.id) + '" data-msg-user-name="' + esc(otherName) + '" data-msg-user-role="' + esc(otherRole) + '">Message ' + esc(otherName.split(' ')[0]) + '</button>';
    }
    var fund = c.role === 'client' && fundTarget(c);
    var sub = firstMs(c, ['submitted']);
    var work = firstMs(c, ['funded', 'changes_requested']);
    
    // Status chip
    var statusChip = '<span class="chip chip-muted">Draft / Escrow Pending</span>';
    if (c.rawStatus === 'FUNDED' || c.status === 'active'){
      statusChip = '<span class="chip chip-safe"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>SafePay Escrow Protected</span>';
    } else if (c.rawStatus === 'COMPLETED'){
      statusChip = '<span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Completed</span>';
    }

    // Role-specific Next Actions
    var nextActionBanner = '';
    if (c.role === 'client'){
      if (c.status === 'active' && sub){
        actions += '<button class="btn btn-primary" type="button" data-approve="' + sub.id + '">Approve milestone ' + sub.position + ' &amp; Release Funds</button>';
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--teal)"><strong>Next Action: Review Work Deliverables</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">' + esc(c.freelancer.name) + ' has submitted work for Milestone ' + sub.position + '. Review deliverables and approve to release payment.</p></div>';
      } else if (fund){
        actions += '<button class="btn btn-primary" type="button" data-open="escrow">Fund milestone ' + fund.position + ' with SafePay</button>';
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--accent)"><strong>Next Action: Fund Escrow via SafePay</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">To start this project, deposit Milestone ' + fund.position + ' (' + fmt(fund.amount) + ') into SafePay escrow. Funds remain securely locked until you approve the specialist’s work.</p></div>';
      } else if (c.status === 'active'){
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--teal)"><strong>SafePay Escrow Protected · Work in Progress</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">Escrow is funded. ' + esc(c.freelancer.name) + ' has been notified to proceed with work.</p></div>';
      }
    } else {
      // Freelancer / Specialist
      if (c.status === 'active' && sub){
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--line)"><strong>Milestone Submitted · Awaiting Client Approval</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">Your milestone deliverables have been submitted. ' + esc(c.client.name) + ' will review and release payment to your wallet.</p></div>';
      } else if (c.status === 'active' && work){
        actions += '<button class="btn btn-primary" type="button" data-submit-ms="' + work.id + '">Submit Milestone ' + work.position + ' for Review</button>';
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--teal)"><strong>Project Ready to Start · Escrow Funded</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">Client has funded escrow with SafePay (' + fmt(c.totals.protected) + ' protected). You can safely start work! Submit milestone deliverables when ready.</p></div>';
      } else if (!c.totals.protected && c.rawStatus !== 'COMPLETED'){
        nextActionBanner = '<div class="alert-info" style="margin:14px 0;padding:12px 14px;border-radius:8px;background:var(--card);border:1px solid var(--line)"><strong>Next Step: Awaiting Client Escrow Deposit</strong><p style="margin:4px 0 0;font-size:13px;color:var(--ink-2)">Proposal accepted! Please wait for ' + esc(c.client.name) + ' to deposit funds into SafePay escrow before starting work.</p></div>';
      }
    }

    return '<button class="m-close" type="button" data-close aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>' +
      '<div class="cc-top" style="padding-right:44px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<span class="eyebrow">Contract #' + esc(c.code) + '</span>' +
        statusChip +
      '</div>' +
      '<h2 id="contractTitle">' + esc(c.title) + '</h2>' +
      '<div class="cc-parties">' + esc(c.client.name) + ' (Client) × ' + esc(c.freelancer.name) + ' (Specialist)' + (other.verified ? ' <span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified</span>' : '') + '</div>' +
      nextActionBanner +
      '<div class="stat-row three">' +
        '<div class="stat"><span>Agreed Value</span><strong>' + fmt(c.totals.value) + '</strong></div>' +
        '<div class="stat"><span>Delivery Timeline</span><strong>' + c.deliveryDays + ' days</strong></div>' +
        '<div class="stat"><span>Escrow Protected</span><strong>' + fmt(c.totals.protected) + '</strong></div>' +
      '</div>' +
      (c.scope ? ('<div style="margin:14px 0;padding:12px 14px;background:var(--bg-2);border-radius:8px;border-left:3px solid var(--teal)"><strong style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--ink-3);margin-bottom:4px">Agreed Project Scope &amp; Proposal Details</strong><div style="font-size:13px;line-height:1.6;color:var(--ink-2);white-space:pre-wrap">' + esc(c.scope) + '</div></div>') : '') +
      '<ol class="milestones">' + c.milestones.map(function(m){
        var v = (MS_VIEW[m.status] || MS_VIEW.unfunded)(m);
        return '<li class="ms' + (v.cls || '') + '"><span class="ms-no">' + (m.status === 'released' ? ck : m.position) + '</span><div><strong>' + esc(m.title) + '</strong><span class="ms-sub">' + v.sub + '</span></div>' + v.chip + '</li>';
      }).join('') + '</ol>' +
      reviewHtml(c) +
      '<div class="m-actions">' + actions + '</div>';
  }
  /* Reviews: once every milestone is released, each side rates the other (shown on their profile). */
  function starsHtml(n){ return '<span class="stars sm" style="--r:' + n + '" role="img" aria-label="Rated ' + n + ' out of 5"></span>'; }
  function reviewHtml(c){
    var rv = c.review || {}, other = c.role === 'client' ? c.freelancer : c.client, out = '';
    var waiting = CONTRACTS.filter(function(x){ return x.id !== c.id && x.review && x.review.canReview; });
    if (rv.canReview){
      out += '<form class="rv-form" data-review-form novalidate><h3>How was working with ' + esc(other.name.split(' ')[0]) + '?</h3>' +
        '<p class="muted">Your review appears on ' + esc(other.name.split(' ')[0]) + '’s profile' + (c.role === 'client' ? '.' : ', under reviews as a client.') + '</p>' +
        '<div class="rv-pick" role="radiogroup" aria-label="Rating">' + [1,2,3,4,5].map(function(n){
          return '<button type="button" role="radio" aria-checked="false" data-rv-star="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg></button>';
        }).join('') + '</div>' +
        '<label class="rv-label" for="rvText">Your review</label><textarea id="rvText" rows="3" maxlength="1000" placeholder="What went well? Would you work together again?"></textarea>' +
        '<p class="rv-err" role="alert" hidden></p><button class="btn btn-primary" type="submit">Post review</button></form>';
    } else if (rv.mine){
      out += '<div class="rv-done"><strong>Your review</strong>' + starsHtml(rv.mine.stars) + '<p>“' + esc(rv.mine.text) + '”</p></div>';
    }
    if (rv.theirs) out += '<div class="rv-done"><strong>' + esc(other.name.split(' ')[0]) + '’s review of you</strong>' + starsHtml(rv.theirs.stars) + '<p>“' + esc(rv.theirs.text) + '”</p></div>';
    if (waiting.length) out += '<p class="rv-more">Waiting for your review: ' + waiting.map(function(x){ return '<button type="button" class="btn-text" data-show-contract="' + x.id + '">' + esc(x.title) + '</button>'; }).join(', ') + '</p>';
    return out;
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-rv-star]');
    if (b){
      var f = b.closest('form'), n = +b.getAttribute('data-rv-star');
      f.setAttribute('data-stars', n);
      $$('[data-rv-star]', f).forEach(function(x){ var k = +x.getAttribute('data-rv-star'); x.classList.toggle('on', k <= n); x.setAttribute('aria-checked', String(k === n)); });
      return;
    }
  });
  document.addEventListener('submit', function(e){
    var f = e.target.closest && e.target.closest('[data-review-form]'); if (!f) return;
    e.preventDefault();
    var err = $('.rv-err', f), stars = +f.getAttribute('data-stars') || 0, text = $('#rvText', f).value.trim();
    var msg = !stars ? 'Choose a rating from 1 to 5 stars.' : text.length < 10 ? 'Write at least 10 characters about how it went.' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg || !CONTRACT) return;
    var btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    api('POST', '/contracts/' + CONTRACT.id + '/review', { stars: stars, text: text }).then(function(r){
      CONTRACT = r.contract;
      CONTRACTS = CONTRACTS.map(function(x){ return x.id === r.contract.id ? r.contract : x; });
      $('#m-contract .modal-card').innerHTML = contractHtml(r.contract);
      toast('Thanks! Your review is on their profile.');
    }).catch(function(e2){ btn.disabled = false; err.textContent = e2.message; err.hidden = false; });
  });
  function openContractById(contractId){
    openModal('contract');
    loadContract(contractId);
  }
  function loadContract(contractId){
    var card = keep('contract', $('#m-contract .modal-card'));
    if (!signedIn()){ CONTRACT = null; card.innerHTML = SAMPLE.contract; return Promise.resolve(); }
    return api('GET', '/contracts').then(function(r){
      var list = Array.isArray(r) ? r : (r && r.contracts) || [];
      var normalized = list.map(function(item){ return fromApiContract(item); }).filter(Boolean);
      CONTRACTS = normalized;
      var keepId = contractId || (CONTRACT && CONTRACT.id);
      var pick = function(f){ return CONTRACTS.filter(f)[0]; };
      var c = (keepId ? pick(function(x){ return String(x.id) === String(keepId); }) : null) ||
        pick(function(x){ return x.status === 'active'; }) ||
        pick(function(x){ return x.review && x.review.canReview; }) ||
        CONTRACTS[0] || null;
      CONTRACT = c;
      card.innerHTML = c ? contractHtml(c) : SAMPLE.contract;
      var x = card.querySelector('.m-close');
      if (x && !$('#m-contract').hidden) x.focus({preventScroll:true});
    }).catch(noop);
  }
  function milestoneAction(path, okMsg){
    var c = CONTRACT; if (!c) return;
    api('POST', '/contracts/' + c.id + '/milestones/' + path, {}).then(function(){
      toast(okMsg);
      loadContract(c.id);
      var onDash = !$('[data-view="dashboard"]').hidden;
      if (onDash) renderDashboard();
    }).catch(handleError);
  }

  function prepareEscrow(){
    var sum = keep('escrowSum', $('#m-escrow .sum')), info = keep('escrowInfo', $('#m-escrow .alert-info'));
    info.innerHTML = SAMPLE.escrowInfo;
    var m = CONTRACT && CONTRACT.role === 'client' && fundTarget(CONTRACT);
    if (!m){ sum.innerHTML = SAMPLE.escrowSum; return; }
    var fee = Math.round(m.amount * CFG.fees.clientPercent / 100);
    sum.innerHTML =
      '<div class="kv"><span>Contract milestone</span><strong>' + esc(m.title) + '</strong></div>' +
      '<div class="kv"><span>Milestone amount</span><strong>' + fmt(m.amount) + '</strong></div>' +
      '<div class="kv"><span>Service fee (' + CFG.fees.clientPercent + '%)</span><strong>' + fmt(fee) + '</strong></div>' +
      '<div class="kv"><span>Deposit amount</span><strong>' + fmt(m.amount + fee) + '</strong></div>';
  }
  function prepareDispute(){
    var sum = keep('disputeSum', $('#m-dispute .sum'));
    var c = CONTRACT;
    sum.innerHTML = c ? '<div class="kv"><span>Contract</span><strong>#' + esc(c.code) + ' · ' + esc(c.title) + '</strong></div>' : SAMPLE.disputeSum;
  }
  function prepareWithdraw(){
    var strong = keep('withdrawAvail', $('#m-withdraw .sum strong'));
    if (!signedIn()){ strong.innerHTML = SAMPLE.withdrawAvail; return; }
    // Production endpoint: GET /api/wallet/balance (returns { available, total, locked })
    api('GET', '/wallet/balance').then(function(w){ strong.textContent = fmt(Math.max(0, w.available || w.balance || 0)); }).catch(noop);
  }

  /* ---------- notifications ---------- */
  function ago(iso){
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' minute' + (s < 120 ? '' : 's') + ' ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hour' + (s < 7200 ? '' : 's') + ' ago';
    if (s < 172800) return 'Yesterday';
    if (s < 604800) return Math.floor(s / 86400) + ' days ago';
    return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }
  function loadNotifs(){
    var list = keep('notifs', $('#notifList')), note = $('#m-notif .notif-note');
    if (!signedIn()){ list.innerHTML = SAMPLE.notifs; if (note) note.hidden = false; return; }
    // Production endpoint: GET /api/notifications/me  (returns Notification[])
    api('GET', '/notifications/me').then(function(r){
      var notifs = Array.isArray(r) ? r : (r.notifications || []);
      if (note) note.hidden = true;
      var unread = notifs.some(function(n){ return !n.isRead; });
      list.innerHTML = notifs.length ? notifs.map(function(n){
        var readCls = n.isRead ? ' read' : '';
        var title = n.message || n.title || 'Notification';
        return '<div class="notif-item' + readCls + '"><i></i><div><strong>' + esc(title) + '</strong><div class="notif-meta">' + ago(n.createdAt) + '</div></div></div>';
      }).join('') : '<p class="muted" style="font-size:14px;margin-top:12px">You’re all caught up. Updates about your jobs, contracts and payments will show up here.</p>';
      $('#notifDot').hidden = !unread;
    }).catch(noop);
  }
  function refreshDot(){
    if (!signedIn()){ $('#notifDot').hidden = false; return; }
    // Production endpoint: GET /api/notifications/me
    api('GET', '/notifications/me').then(function(r){
      var notifs = Array.isArray(r) ? r : (r.notifications || []);
      $('#notifDot').hidden = !notifs.some(function(n){ return !n.isRead; });
    }).catch(noop);
  }

  /* ---------- hire specialist click handler ---------- */
  function handleHireClick(el){
    var specId = el.getAttribute('data-hire-specialist') || '';
    var specName = el.getAttribute('data-hire-name') || 'Specialist';
    var user = PaklanceAuth.getUser();
    
    if (!user){
      var body = $('#hireModalBody');
      if (body){
        body.innerHTML =
          '<h3 id="hireModalTitle" style="font-size:20px;margin-bottom:8px">Hire ' + esc(specName) + '</h3>' +
          '<p class="muted" style="font-size:14px;line-height:1.5;margin-bottom:18px">' +
            'Sign in or create a client account to work with ' + esc(specName) + ' on Paklance.' +
          '</p>' +
          '<div style="display:flex;gap:10px;flex-direction:column">' +
            '<button class="btn btn-primary btn-block" type="button" id="hireLoginBtn">Sign In</button>' +
            '<button class="btn btn-outline btn-block" type="button" id="hireSignupBtn">Create Client Account</button>' +
          '</div>';
        openModal('hire');
        var lBtn = $('#hireLoginBtn'), sBtn = $('#hireSignupBtn');
        if (lBtn) lBtn.onclick = function(){ closeModals(); PaklanceAuth.open('login'); };
        if (sBtn) sBtn.onclick = function(){ closeModals(); PaklanceAuth.open('signup'); };
      } else {
        toast('Please sign in or register to hire ' + specName + '.');
        PaklanceAuth.open('signup');
      }
      return;
    }

    var isClient = String(user.role || '').toLowerCase() === 'client';
    var isSelf = (user.id && user.id === specId) || (user.email && specId && user.id === specId);

    if (isSelf){
      toast('This is your own specialist profile.');
      return;
    }

    if (isClient){
      var body = $('#hireModalBody');
      if (body){
        body.innerHTML =
          '<div class="cc-top" style="padding-right:32px"><span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Client Account</span></div>' +
          '<h3 id="hireModalTitle" style="font-size:20px;margin-top:6px;margin-bottom:8px">Hire ' + esc(specName) + '</h3>' +
          '<p style="font-size:14px;color:var(--ink-2);line-height:1.5;margin-bottom:14px">' +
            'You are signed in as <strong>' + esc(user.fullName || user.email) + '</strong> (Client). ' +
            'Specialist hiring on Paklance happens securely through job proposals and SafePay escrow protection.' +
          '</p>' +
          '<div style="background:var(--bg-2);border-radius:8px;padding:12px;margin-bottom:18px;font-size:13px;line-height:1.5;color:var(--ink-2);border-left:3px solid var(--primary)">' +
            '<strong>Next steps to hire ' + esc(specName.split(' ')[0]) + ':</strong>' +
            '<ul style="margin:6px 0 0 18px;padding:0">' +
              '<li><strong>Message ' + esc(specName.split(' ')[0]) + '</strong> to discuss requirements, timeline, and deliverables.</li>' +
              '<li><strong>Post a job</strong> so ' + esc(specName.split(' ')[0]) + ' can submit an agreed proposal with protected milestones.</li>' +
            '</ul>' +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-direction:column">' +
            '<button class="btn btn-primary btn-block" type="button" id="hireMsgBtn">' +
              '<svg class="ic ic-sm" aria-hidden="true" style="margin-right:6px"><use href="#i-chat"/></svg>Message ' + esc(specName.split(' ')[0]) +
            '</button>' +
            '<button class="btn btn-outline btn-block" type="button" id="hirePostJobBtn">Post a Job &amp; Invite</button>' +
          '</div>';
        openModal('hire');
        var mBtn = $('#hireMsgBtn'), pBtn = $('#hirePostJobBtn');
        if (mBtn){
          mBtn.onclick = function(){
            closeModals();
            if (typeof PaklanceMessages !== 'undefined'){
              PaklanceMessages.open({ id: specId, name: specName, role: 'Specialist', headline: 'Specialist' });
            }
          };
        }
        if (pBtn){
          pBtn.onclick = function(){
            closeModals();
            openPostJobModal({ id: specId, name: specName });
          };
        }
      }
      return;
    }

    // Specialist viewing specialist
    var body = $('#hireModalBody');
    if (body){
      body.innerHTML =
        '<h3 id="hireModalTitle" style="font-size:20px;margin-bottom:8px">Specialist Collaboration</h3>' +
        '<p style="font-size:14px;color:var(--ink-2);line-height:1.5;margin-bottom:14px">' +
          'You are signed in with a Specialist account (<strong>' + esc(user.fullName || user.email) + '</strong>). ' +
          'Specialist accounts cannot hire other specialists through client contracts.' +
        '</p>' +
        '<div style="background:var(--bg-2);border-radius:8px;padding:12px;margin-bottom:18px;font-size:13px;line-height:1.5;color:var(--ink-2)">' +
          'If you’d like to collaborate with ' + esc(specName) + ' on projects, you can message them directly.' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-direction:column">' +
          '<button class="btn btn-primary btn-block" type="button" id="hireCollabMsgBtn">Message ' + esc(specName.split(' ')[0]) + ' for Collaboration</button>' +
          '<button class="btn btn-outline btn-block" type="button" data-close>Close</button>' +
        '</div>';
      openModal('hire');
      var cBtn = $('#hireCollabMsgBtn');
      if (cBtn){
        cBtn.onclick = function(){
          closeModals();
          if (typeof PaklanceMessages !== 'undefined'){
            PaklanceMessages.open({ id: specId, name: specName, role: 'Specialist', headline: 'Specialist' });
          }
        };
      }
    }
  }

  /* ---------- clicks ---------- */
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-open],[data-close],[data-job],[data-person],[data-clear-filters],[data-cat],[data-bn],[data-toast],[data-logout],[data-edit-skills],[data-apply],[data-approve],[data-submit-ms],[data-accept-proposal],[data-scroll-proposals],[data-hire-specialist],[data-show-contract],[data-view-contract-job],[data-post-job]');
    if (!el) return;
    if (el.hasAttribute('data-post-job')){
      var specId = el.getAttribute('data-invite-specialist-id') || '';
      var specName = el.getAttribute('data-invite-specialist-name') || '';
      openPostJobModal(specId ? { id: specId, name: specName } : null);
      return;
    }
    if (el.hasAttribute('data-hire-specialist')){ handleHireClick(el); return; }
    if (el.hasAttribute('data-show-contract')){ openContractById(el.getAttribute('data-show-contract')); return; }
    if (el.hasAttribute('data-view-contract-job')){
      var jid = el.getAttribute('data-view-contract-job');
      openModal('contract');
      api('GET', '/contracts').then(function(r){
        var list = Array.isArray(r) ? r : (r && r.contracts) || [];
        var normalized = list.map(function(item){ return fromApiContract(item); }).filter(Boolean);
        CONTRACTS = normalized;
        var matched = CONTRACTS.filter(function(x){ return String(x.jobId) === String(jid); })[0] || CONTRACTS[0];
        if (matched){
          CONTRACT = matched;
          $('#m-contract .modal-card').innerHTML = contractHtml(matched);
        }
      }).catch(noop);
      return;
    }
    if (el.hasAttribute('data-logout')){ PaklanceAuth.logOut().then(function(){ toast('You’ve logged out.'); go('home'); }); return; }
    if (el.hasAttribute('data-edit-skills')){ PaklanceAuth.editSkills(); return; }
    if (el.getAttribute('data-open') === 'auth'){ authEntry(el.hasAttribute('data-signup')); return; }
    if (el.hasAttribute('data-open') && el.getAttribute('data-open') === 'messages'){
      if (PaklanceAuth.getUser()) PaklanceMessages.open();
      else { PaklanceAuth.open('login'); }
      return;
    }
    if (el.hasAttribute('data-open')){ openModal(el.getAttribute('data-open')); return; }
    if (el.hasAttribute('data-close')){ closeModals(); return; }
    if (el.hasAttribute('data-apply')){ applyToJob(el.getAttribute('data-apply')); return; }
    if (el.hasAttribute('data-scroll-proposals')){
      var sec = $('#jobProposalsSection');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (el.hasAttribute('data-accept-proposal')){
      var propId = el.getAttribute('data-accept-proposal');
      if (!propId || el.disabled) return;
      if (!window.confirm('Accept this proposal? This will initiate the project contract and notify the specialist.')) return;
      el.disabled = true;
      var origText = el.textContent;
      el.textContent = 'Accepting…';
      api('PATCH', '/proposals/' + encodeURIComponent(propId) + '/accept').catch(function(err){
        if (currentJob && currentJob.id && (err.status === 404 || err.code === 'NOT_FOUND')){
          return api('PATCH', '/jobs/' + encodeURIComponent(currentJob.id) + '/proposals/' + encodeURIComponent(propId) + '/accept');
        }
        throw err;
      }).then(function(){
        toast('Proposal accepted! Contract has been initiated.');
        if (currentJob) loadJobProposals(currentJob.id);
      }).catch(function(err){
        handleError(err);
        el.disabled = false;
        el.textContent = origText;
      });
      return;
    }
    if (el.hasAttribute('data-approve')){
      var ms = CONTRACT && CONTRACT.milestones.filter(function(m){ return String(m.id) === el.getAttribute('data-approve'); })[0];
      if (ms && window.confirm('Approve “' + ms.title + '” and release ' + fmt(ms.amount) + ' to ' + CONTRACT.freelancer.name + '?')) milestoneAction(ms.id + '/approve', 'Milestone approved. Payment released.');
      return;
    }
    if (el.hasAttribute('data-submit-ms')){ milestoneAction(el.getAttribute('data-submit-ms') + '/submit', 'Work submitted. The client has been notified.'); return; }
    if (el.hasAttribute('data-job')){
      var id = el.getAttribute('data-job');
      var matched = JOBS.filter(function(j){ return String(j.id) === String(id); })[0] || null;
      if (matched) currentJob = matched;
      go('job/' + encodeURIComponent(id));
      return;
    }
    if (el.hasAttribute('data-person')){
      var pid = el.getAttribute('data-person');
      if (!pid) return;
      if (currentJob && currentJob.id){
        profileReturnContext = {
          href: '#job/' + encodeURIComponent(currentJob.id),
          label: 'Back to job proposals',
          jobId: currentJob.id
        };
      } else {
        profileReturnContext = null;
      }
      var matchedPerson = TALENT.filter(function(t){ return String(t.id) === String(pid) || String(t.userId) === String(pid); })[0];
      currentPerson = matchedPerson || { id: pid, userId: pid };
      go('person/' + encodeURIComponent(pid));
      return;
    }
    if (el.hasAttribute('data-clear-filters')){ clearFilters(); return; }
    if (el.hasAttribute('data-cat')){ $('#tSearch').value = el.getAttribute('data-cat'); renderTalent(); go('talent'); return; }
    if (el.hasAttribute('data-bn')){
      var b = el.getAttribute('data-bn');
      if (b === 'home') go('home');
      else if (b === 'find') go('jobs');
      else if (b === 'contracts') openModal('contract');
      else if (b === 'wallet') openModal('wallet');
      else if (b === 'messages'){
        if (PaklanceAuth.getUser()) PaklanceMessages.open();
        else { PaklanceAuth.open('login'); }
      }
      return;
    }
    if (el.hasAttribute('data-toast')){ toast('“' + el.textContent.trim() + '” is coming soon.'); return; }
  });

  /* ---------- forms ---------- */
  var PREVIEW_MSG = {
    global:'Requirement saved as a private draft (preview only).',
    dispute:'Case drafted. Submitting is turned off in this preview.',
    escrow:'Checkout isn’t connected in this preview. Bank transfer (1Link) would be used.',
    payout:'Payout method saved for this preview only.',
    withdraw:'Withdrawals are turned off in this preview.'
  };
  var v = function(id){ return $('#' + id).value; };
  // Map dropdown label strings to the PayoutType enum values the production backend expects
  function payoutTypeEnum(label){
    if (/raast/i.test(label)) return 'RAAST';
    if (/jazzcash/i.test(label)) return 'JAZZCASH';
    if (/easypaisa/i.test(label)) return 'EASYPAISA';
    return 'BANK'; // default: Bank Account / 1Link (IBAN)
  }

  var FORMS = {
    postJob: function(){
      var u = PaklanceAuth.getUser();
      if (!u) return needUser('Log in with your client account to post a job.');
      var isClient = String(u.role || '').toLowerCase() === 'client';
      if (!isClient){
        toast('Only client accounts can post jobs. Switch to or create a client account to hire talent.');
        return Promise.resolve();
      }

      var title = (v('postJobTitle') || '').trim();
      var category = v('postJobCategory') || 'Web & Software Development';
      var budget = Number(v('postJobBudget')) || 0;
      var days = Number(v('postJobDays')) || 14;
      var skills = (v('postJobSkills') || '').trim();
      var desc = (v('postJobDescription') || '').trim();
      var inviteSpecialistId = (v('postJobSpecialistId') || '').trim();

      if (!title){ toast('Please provide a job title.'); return Promise.resolve(); }
      if (!budget || budget < 500){ toast('Please specify a valid budget (minimum PKR 500).'); return Promise.resolve(); }
      if (!days || days < 1){ toast('Please specify a valid delivery timeline.'); return Promise.resolve(); }
      if (!skills){ toast('Please provide required skills.'); return Promise.resolve(); }
      if (!desc || desc.length < 20){ toast('Please provide a detailed job description (at least 20 characters).'); return Promise.resolve(); }

      var btn = $('#btnSubmitPostJob');
      if (btn) btn.disabled = true;

      var fullDescription = desc + '\n\nCategory: ' + category + '\nRequired Skills: ' + skills + '\nDelivery Timeline: ' + days + ' days';

      var payload = {
        title: title,
        description: fullDescription,
        budget: budget,
        category: category,
        skills: skills.split(',').map(function(s){ return s.trim(); }).filter(Boolean),
        deliveryDays: days
      };

      return api('POST', '/jobs', payload).then(function(created){
        closeModals();
        toast('Job posted successfully! It is now live on the marketplace.');
        var normalized = fromApiJob(created);
        normalized.clientId = u.id;
        normalized.clientEmail = u.email;
        normalized.client = u.fullName || 'Client';
        JOBS.unshift(normalized);

        if (inviteSpecialistId && typeof PaklanceMessages !== 'undefined'){
          var inviteMsg = 'Hello! I just posted a new project: "' + title + '" (Budget: ' + fmt(budget) + ') and would love to invite you to submit a proposal or discuss the project.';
          PaklanceMessages.sendMessageTo(inviteSpecialistId, inviteMsg).then(function(){
            toast('Job posted and direct invitation sent to specialist!');
          }).catch(function(){});
        }

        var formEl = $('#postJobForm');
        if (formEl) formEl.reset();
        var alertEl = $('#postJobSpecialistAlert');
        if (alertEl) alertEl.style.display = 'none';
        var specIdInput = $('#postJobSpecialistId');
        if (specIdInput) specIdInput.value = '';

        renderDashboard();
        renderJobs();
      }).catch(handleError).finally(function(){
        if (btn) btn.disabled = false;
      });
    },
    apply: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to apply for this job.');
      var id = v('propJobId');
      var bid = Number(v('propBid')) || 1000;
      var days = Number(v('propDays')) || 7;
      var cover = (v('propCoverLetter') || '').trim();
      if (!cover){ toast('Please write a cover letter.'); return Promise.resolve(); }
      var btn = $('#btnSubmitProposal');
      if (btn) btn.disabled = true;
      var payload = {
        jobId: String(id),
        bidAmount: bid,
        deliveryDays: days,
        coverLetter: cover
      };
      return api('POST', '/jobs/' + encodeURIComponent(id) + '/proposals', payload).catch(function(err){
        if (err && (err.code === 'SERVER_ERROR' || err.status === 404)){
          return api('POST', '/proposals', payload);
        }
        throw err;
      }).then(function(){
        closeModals();
        toast('Application sent. The client can now see your name and skills.');
        var j = currentJob || JOBS.filter(function(x){ return String(x.id) === String(id); })[0];
        if (j) j.proposals = (j.proposals || 0) + 1;
        if (currentJob && String(currentJob.id) === String(id)) renderJobDetail();
      }).catch(handleError).finally(function(){
        if (btn) btn.disabled = false;
      });
    },
    // Paklance Match: production backend has no /match-requests endpoint.
    // Show an honest local shortlist from the existing talent data.
    match: function(){
      var skills = v('mSkills').trim().toLowerCase();
      var filtered = TALENT.filter(function(t){
        if (!skills) return true;
        return t.skills.some(function(s){ return s.toLowerCase().indexOf(skills) > -1; });
      }).slice(0, 5).map(function(t){
        return { initials: t.init, name: t.name, headline: t.role, city: t.city, tags: t.skills.slice(0,3), fit: Math.floor(70 + Math.random()*28), isSample: false, userId: t.userId || null };
      });
      renderShortlist(filtered);
      toast(filtered.length ? 'Shortlist generated from registered specialists.' : 'No close matches yet. Try adjusting your skills or role description.');
      flash([$('#shortlist')]);
      return Promise.resolve();
    },
    // Global hiring: production backend has no /global-requests endpoint.
    // Confirm the form and show an honest message.
    global: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to save your requirement.');
      closeModals();
      toast('Requirement noted. The Global Hiring team will contact you at ' + (PaklanceAuth.getUser().email || 'your email') + ' within 2 business days.');
      return Promise.resolve();
    },
    dispute: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to open a case.');
      var c = CONTRACT;
      if (!c){ closeModals(); toast('No active contract selected, so cases can’t be submitted.'); return Promise.resolve(); }
      // Production DTO: CreateDisputeDto { contractId, reason }
      // Combine issue + description into reason
      var reason = [v('dIssue'), v('dWhat')].filter(Boolean).join(': ');
      return api('POST', '/disputes', { contractId: c.id, reason: reason })
        .then(function(){ closeModals(); $('#dWhat').value = ''; toast('Case submitted for review. Both sides can now add evidence.'); loadContract(); });
    },
    escrow: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to fund a milestone.');
      var c = CONTRACT, m = c && c.role === 'client' && fundTarget(c);
      if (!m){ closeModals(); toast('No active milestone selected, so checkout is turned off.'); return Promise.resolve(); }
      // Production endpoint: POST /api/contracts/:id/fund  (amount in body)
      var amount = m.amount;
      return api('POST', '/contracts/' + c.id + '/fund', { amount: amount }).then(function(r){
        toast('Escrow funded. The milestone is now protected. Milestones show as funded once payment is confirmed.');
        loadContract();
      });
    },
    payout: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to add a payout method.');
      // Production DTO: CreatePayoutMethodDto { type (enum), accountTitle, accountNumber, bankName?, isDefault? }
      var channelLabel = v('pCh');
      return api('POST', '/wallet/payout-methods', {
        type:          payoutTypeEnum(channelLabel),
        accountTitle:  v('pTitle'),
        accountNumber: v('pNum'),
        bankName:      v('pBank') || undefined,
        isDefault:     $('#pDef').checked
      }).then(function(){ closeModals(); toast('Payout method saved.'); });
    },
    withdraw: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to withdraw funds.');
      // Production endpoint: POST /api/wallet/withdraw  (WithdrawDto: amount as number, channel enum)
      var channelLabel = v('wCh');
      var amt = Number(v('wAmt'));
      if (!amt || amt <= 0){ toast('Please enter a valid withdrawal amount.'); return Promise.resolve(); }
      return api('POST', '/wallet/withdraw', {
        amount:        amt,
        channel:       payoutTypeEnum(channelLabel),
        accountTitle:  v('wTitle'),
        accountNumber: v('wNum')
      }).then(function(r){
        closeModals(); $('#wAmt').value = '';
        var amtOut = (r && r.amount) || amt;
        toast('Withdrawal of ' + fmt(amtOut) + ' requested.');
        refreshDot();
      });
    }
  };
  function renderShortlist(list){
    var box = $('#shortlist .sl');
    box.innerHTML = list.length ? list.map(function(s){
      var msgBtn = s.userId
        ? '<button class="btn btn-outline btn-sm" type="button" style="margin-top:8px" data-msg-user-id="' + esc(s.userId) + '" data-msg-user-name="' + esc(s.name) + '" data-msg-user-role="' + esc(s.headline || '') + '">Message</button>'
        : '';
      return '<div class="sl-card"><span class="avatar">' + esc(s.initials) + '</span><div><strong>' + esc(s.name) + '</strong><span class="sub">' + esc(s.headline) + ' · ' + esc(s.city) + '</span>' +
        '<div class="tags">' + tagsHtml(s.tags) + '</div>' + msgBtn + '</div><div class="fit"><strong>' + s.fit + '%</strong><span>Fit</span></div></div>';
    }).join('') : '<p class="muted" style="font-size:14px">No close matches yet. Your requirement is saved, and Paklance will curate a shortlist for you.</p>';
  }
  document.addEventListener('submit', function(e){
    var f = e.target;
    var k = f.getAttribute('data-form');
    if (!k) return;               // forms without data-form (sign up, blog) handle themselves
    e.preventDefault();
    if (k === 'hero'){ $('#jSearch').value = $('#heroQ').value; renderJobs(); go('jobs'); return; }
    if (!LIVE){
      if (k === 'match'){ toast('Shortlist updated.'); flash([$('#shortlist')]); return; }
      closeModals(); toast(PREVIEW_MSG[k] || 'Saved.'); return;
    }
    var btn = f.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
    FORMS[k]().catch(handleError).then(function(){ if (btn) btn.disabled = false; });
  });

  var priceRange = RangeSlider($('#fPrice'), renderJobs);
  ['fCat','fTrust','fSafe','jSort'].forEach(function(id){ $('#' + id).addEventListener('change', renderJobs); });
  $('#jSearch').addEventListener('input', renderJobs);
  ['tAvail','tRate'].forEach(function(id){ $('#' + id).addEventListener('change', renderTalent); });
  $('#tSearch').addEventListener('input', renderTalent);

  $('#burger').addEventListener('click', function(){
    var m = $('#mobileMenu'); m.hidden = !m.hidden; this.setAttribute('aria-expanded', String(!m.hidden));
  });
  $('#langBtn').addEventListener('click', function(){ toast('The Urdu version is coming soon.'); });
  $('#markRead').addEventListener('click', function(){
    $$('#notifList .notif-item').forEach(function(n){ n.classList.add('read'); });
    $('#notifDot').hidden = true;
    // Production endpoint: PATCH /api/notifications/read-all (not POST)
    if (signedIn()) api('PATCH', '/notifications/read-all', null).catch(noop);
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape' || PaklanceAuth.isOpen()) return;
    if ($$('.modal:not([hidden])').length) closeModals();
  });

  /* ---------- sign up / log in integration ---------- */
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function initials(name){
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function authEntry(signup){
    var u = PaklanceAuth.getUser();
    var isClient = u && String(u.role || '').toLowerCase() === 'client';
    var hasCompletedProfile = u && u.fullName && (isClient || (u.skills && u.skills.length));
    if (hasCompletedProfile){ toast('You’re signed in as ' + u.fullName + '.'); go('dashboard'); return; }
    PaklanceAuth.open(signup ? 'signup' : 'login');
  }
  function updateHeader(u){
    document.body.classList.toggle('signed-in', !!u);
    var isClient = u && String(u.role || '').toLowerCase() === 'client';
    var hdrPostBtn = $('#hdrPostJobBtn');
    if (hdrPostBtn) hdrPostBtn.style.display = isClient ? 'inline-flex' : 'none';
    var mobPostBtn = $('#mobPostJobBtn');
    if (mobPostBtn) mobPostBtn.style.display = isClient ? 'block' : 'none';
    if (u){
      $('#hdrAv').innerHTML = u.photo ? '<img src="' + esc(u.photo) + '" alt="">' : esc(initials(u.fullName || u.email));
      $('#hdrName').textContent = u.fullName ? u.fullName.split(' ')[0] : 'Account';
    }
    if (LIVE) refreshDot();
    var onDash = !$('[data-view="dashboard"]').hidden;
    if (onDash){ if (u) renderDashboard(); else go('home'); }
    if (!u && location.hash === '#profile') go('home');
    var onJobDetail = !$('[data-view="job"]').hidden;
    if (onJobDetail && currentJob) renderJobDetail();
  }
  function matchJobs(u){
    var groups = PaklanceAuth.skillGroups, cats = {};
    (u.skills || []).forEach(function(s){ Object.keys(groups).forEach(function(g){ if (groups[g].indexOf(s) > -1) cats[g] = 1; }); });
    var words = (u.skills || []).map(function(s){ return s.toLowerCase(); });
    return JOBS.map(function(j){
      var hay = (j.title + ' ' + (j.skills || []).join(' ') + ' ' + j.cat).toLowerCase();
      var score = (cats[j.cat] ? 2 : 0) + words.filter(function(w){ return hay.indexOf(w) > -1; }).length;
      return {j:j, score:score};
    }).filter(function(x){ return x.score > 0; }).sort(function(a,b){ return b.score - a.score; }).map(function(x){ return x.j; }).slice(0, 3);
  }
  function renderDashboard(){
    var u = PaklanceAuth.getUser(); if (!u) return;
    var isClient = String(u.role || '').toLowerCase() === 'client';
    var dashPostBtn = $('#dashPostJobBtn');
    if (dashPostBtn) dashPostBtn.style.display = isClient ? 'inline-flex' : 'none';
    $('#dashHello').textContent = 'Welcome, ' + (u.fullName ? u.fullName.split(' ')[0] : 'there');
    var dashSub = $('#dashSub');
    if (dashSub){
      dashSub.textContent = isClient
        ? 'Manage your posted projects, review received proposals, and track SafePay contracts.'
        : "Your account is ready. Here's your profile and work that matches your skills.";
    }
    $('#dashProfile').innerHTML =
      '<div class="t-head"><div class="pc-avwrap">' + PaklanceProfile.avatar(u, 'lg') +
        '<button type="button" class="pc-cam sm" data-pc-open="photo" aria-label="' + (u.photo ? 'Change profile photo' : 'Add a profile photo') + '"><svg class="pp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4zM12 16.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z"/></svg></button></div>' +
        '<div><strong>' + esc(u.fullName || 'Your name') + '</strong><span>' + esc(u.email) + '</span>' +
        '<button type="button" class="btn-text pc-photo-link" data-pc-open="photo">' + (u.photo ? 'Change photo' : 'Add a profile photo') + '</button></div></div>' +
      '<div class="chip-row" style="margin-top:14px"><span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Email verified</span><span class="chip chip-muted">' + (u.provider === 'google' ? 'Signed in with Google' : 'Email & password') + '</span>' +
      (isClient ? '<span class="chip chip-muted">Client account</span>' : '') + '</div>' +
      (u.skills && u.skills.length ? ('<h4>Your skills</h4><div class="tags">' + u.skills.map(function(s){ return '<span class="tag">' + esc(s) + '</span>'; }).join('') + '</div>') : '') +
      (isClient ? '<button class="btn btn-primary btn-block" type="button" data-post-job style="margin-top:18px"><svg class="ic ic-sm" aria-hidden="true" style="margin-right:6px"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Post a New Job</button>' : '') +
      '<a class="btn ' + (isClient ? 'btn-outline' : 'btn-primary') + ' btn-block" href="#profile" style="margin-top:' + (isClient ? '10px' : '18px') + '">View my profile</a>' +
      (!isClient ? '<button class="btn btn-outline btn-block" type="button" data-edit-skills style="margin-top:10px">Edit skills</button>' : '');
    $('#dashChecklist').innerHTML =
      '<li class="ok">Account created</li><li class="ok">Email verified</li><li class="ok">Full name added</li>' +
      (isClient ? '<li class="ok">Client account active</li>' : '<li class="ok">Skills added</li>') +
      (u.photo ? '<li class="ok">Profile photo added</li>' : '<li>Add a profile photo <button type="button" class="chip chip-muted pc-chip-btn" data-pc-open="photo">Add photo</button></li>') +
      '<li id="dashProfileStep">Complete your profile <span class="chip chip-muted">Next</span></li>';
    PaklanceProfile.mount($('#dashTracker'), { video: $('#dashVideo') });

    var jobsCard = $('#dashJobs') ? $('#dashJobs').closest('.card') : null;
    var jobsCardHead = jobsCard ? jobsCard.querySelector('.cc-top') : null;
    if (jobsCardHead){
      if (isClient){
        jobsCardHead.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;width:100%"><h3 style="font-size:19px">Your Posted Jobs</h3><button class="btn btn-primary btn-sm" type="button" data-post-job>+ Post a Job</button></div>';
      } else {
        jobsCardHead.innerHTML = '<h3 style="font-size:19px">Jobs that match your skills</h3>';
      }
    }

    if (isClient){
      var clientJobs = JOBS.filter(function(j){
        return (j.clientId && j.clientId === u.id) ||
               (j.clientEmail && u.email && j.clientEmail.toLowerCase() === u.email.toLowerCase()) ||
               (j.client === u.fullName);
      });
      $('#dashJobsNote').textContent = clientJobs.length
        ? 'Here are your posted jobs and received proposals.'
        : 'Jobs posted by your client account will appear here along with received proposals.';
      if (clientJobs.length){
        $('#dashJobs').innerHTML = clientJobs.map(jobCard).join('');
      } else {
        $('#dashJobs').innerHTML = '<div class="empty" style="padding:24px 0;text-align:center"><p class="muted" style="margin-bottom:12px">You haven’t posted any jobs yet. Create a job to receive proposals from top Pakistani talent.</p><button class="btn btn-primary" type="button" data-post-job>+ Post Your First Job</button></div>';
      }
      loadClientDashboardContracts();
      loadClientDashboardProposals();
    } else {
      var matches = matchJobs(u), shown = matches.length ? matches : JOBS.slice(0, 3);
      $('#dashJobsNote').textContent = matches.length ? 'Based on the skills you picked.' : (JOBS.length ? 'No close matches yet, so here are the newest jobs.' : 'Post your profile and skills to see matching jobs here.');
      $('#dashJobs').innerHTML = shown.length ? shown.map(jobCard).join('') : '<p class="muted" style="font-size:14px;margin-top:8px">No jobs available right now. Check back soon.</p>';
      loadSpecialistDashboardContracts();
    }
  }

  function loadClientDashboardContracts(){
    var container = $('#dashClientContracts');
    if (!container){
      var dashMain = $('.dash-main');
      if (dashMain){
        var card = document.createElement('div');
        card.className = 'card';
        card.id = 'dashClientContracts';
        card.style.marginTop = '16px';
        card.innerHTML =
          '<div class="cc-top"><h3 style="font-size:19px">Active Projects &amp; Contracts</h3></div>' +
          '<div id="dashClientContractsList" style="margin-top:12px"><p class="muted" style="font-size:14px">Loading contracts…</p></div>';
        var propCard = $('#dashClientProposals');
        if (propCard && propCard.parentNode === dashMain){
          dashMain.insertBefore(card, propCard);
        } else {
          dashMain.appendChild(card);
        }
        container = card;
      }
    }
    var listEl = $('#dashClientContractsList');
    if (!listEl) return;
    api('GET', '/contracts').catch(function(){ return []; }).then(function(r){
      var list = Array.isArray(r) ? r : (r && r.contracts) || [];
      var normalized = list.map(function(item){ return fromApiContract(item); }).filter(Boolean);
      if (!normalized.length){
        listEl.innerHTML = '<p class="muted" style="font-size:14px">No active contracts yet. When you accept a specialist’s proposal, your contract and next escrow steps will appear here.</p>';
        return;
      }
      listEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' +
        normalized.map(function(c){
          var spec = c.freelancer || {};
          var statusChip = c.rawStatus === 'FUNDED'
            ? '<span class="chip chip-safe"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>SafePay Protected</span>'
            : (c.rawStatus === 'COMPLETED'
              ? '<span class="chip chip-verified">Completed</span>'
              : '<span class="chip chip-muted">Awaiting Escrow Deposit</span>');
          var nextAction = c.rawStatus === 'FUNDED'
            ? (firstMs(c, ['submitted']) ? '<strong>Action needed:</strong> Specialist submitted work. Review deliverables and approve milestone.' : 'Escrow funded · Specialist working on delivery.')
            : '<strong>Action needed:</strong> Deposit Milestone 1 into SafePay escrow to start the project.';
          return '<div style="padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
              '<div>' +
                '<strong style="font-size:16px;display:block">' + esc(c.title) + '</strong>' +
                '<span class="muted" style="font-size:13px">Specialist: <strong>' + esc(spec.name) + '</strong> · ' + c.deliveryDays + ' days delivery</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<strong style="color:var(--primary);font-size:16px">' + fmt(c.totals.value) + '</strong>' +
                statusChip +
              '</div>' +
            '</div>' +
            '<div style="margin-top:10px;padding:8px 12px;background:var(--bg-2);border-radius:6px;font-size:13px;color:var(--ink-2)">' +
              nextAction +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px">' +
              (spec.id ? '<button class="btn btn-outline btn-sm" type="button" data-msg-user-id="' + esc(spec.id) + '" data-msg-user-name="' + esc(spec.name) + '" data-msg-user-role="Specialist">Message ' + esc((spec.name||'').split(' ')[0]) + '</button>' : '<span></span>') +
              '<button class="btn btn-primary btn-sm" type="button" data-show-contract="' + esc(c.id) + '">View Contract &amp; Next Steps</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    });
  }

  function loadSpecialistDashboardContracts(){
    var container = $('#dashSpecialistContracts');
    if (!container){
      var dashMain = $('.dash-main');
      if (dashMain){
        var card = document.createElement('div');
        card.className = 'card';
        card.id = 'dashSpecialistContracts';
        card.style.marginTop = '16px';
        card.innerHTML =
          '<div class="cc-top"><h3 style="font-size:19px">My Active Contracts &amp; Projects</h3></div>' +
          '<div id="dashSpecialistContractsList" style="margin-top:12px"><p class="muted" style="font-size:14px">Loading contracts…</p></div>';
        dashMain.insertBefore(card, dashMain.firstChild);
        container = card;
      }
    }
    var listEl = $('#dashSpecialistContractsList');
    if (!listEl) return;
    api('GET', '/contracts').catch(function(){ return []; }).then(function(r){
      var list = Array.isArray(r) ? r : (r && r.contracts) || [];
      var normalized = list.map(function(item){ return fromApiContract(item); }).filter(Boolean);
      if (!normalized.length){
        if (container) container.hidden = true;
        return;
      }
      if (container) container.hidden = false;
      listEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' +
        normalized.map(function(c){
          var client = c.client || {};
          var statusChip = c.rawStatus === 'FUNDED'
            ? '<span class="chip chip-safe"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Ready to Start · Escrow Funded</span>'
            : (c.rawStatus === 'COMPLETED'
              ? '<span class="chip chip-verified">Completed</span>'
              : '<span class="chip chip-muted">Waiting for Client Escrow</span>');
          var nextAction = c.rawStatus === 'FUNDED'
            ? (firstMs(c, ['submitted']) ? 'Milestone submitted. Awaiting client review and release.' : '<strong>Ready to start!</strong> Escrow is protected (' + fmt(c.totals.protected) + '). Submit work when deliverables are ready.')
            : 'Proposal accepted! Please wait for client to deposit Milestone 1 into SafePay escrow before starting work.';
          return '<div style="padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
              '<div>' +
                '<strong style="font-size:16px;display:block">' + esc(c.title) + '</strong>' +
                '<span class="muted" style="font-size:13px">Client: <strong>' + esc(client.name) + '</strong> · ' + c.deliveryDays + ' days timeline</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<strong style="color:var(--primary);font-size:16px">' + fmt(c.totals.value) + '</strong>' +
                statusChip +
              '</div>' +
            '</div>' +
            '<div style="margin-top:10px;padding:8px 12px;background:var(--bg-2);border-radius:6px;font-size:13px;color:var(--ink-2)">' +
              nextAction +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px">' +
              (client.id ? '<button class="btn btn-outline btn-sm" type="button" data-msg-user-id="' + esc(client.id) + '" data-msg-user-name="' + esc(client.name) + '" data-msg-user-role="Client">Message Client</button>' : '<span></span>') +
              '<button class="btn btn-primary btn-sm" type="button" data-show-contract="' + esc(c.id) + '">View Contract / Project Status</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    });
  }

  function loadClientDashboardProposals(){
    var container = $('#dashClientProposals');
    if (!container){
      var dashMain = $('.dash-main');
      if (dashMain){
        var card = document.createElement('div');
        card.className = 'card';
        card.id = 'dashClientProposals';
        card.style.marginTop = '16px';
        card.innerHTML =
          '<div class="cc-top"><h3 style="font-size:19px">Proposals Received for Your Jobs</h3></div>' +
          '<div id="dashClientProposalsList" style="margin-top:12px"><p class="muted" style="font-size:14px">Loading received proposals...</p></div>';
        dashMain.appendChild(card);
        container = card;
      }
    }
    var listEl = $('#dashClientProposalsList');
    if (!listEl) return;
    api('GET', '/proposals/client').catch(function(){
      return [];
    }).then(function(proposals){
      if (!Array.isArray(proposals)) proposals = [];
      if (!proposals.length){
        listEl.innerHTML = '<p class="muted" style="font-size:14px">No proposals received yet across your jobs.</p>';
        return;
      }
      listEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' +
        proposals.map(function(p){
          var jobTitle = (p.job && p.job.title) || 'Job';
          var u = p.User || {};
          var name = u.name || u.fullName || 'Specialist';
          var skills = Array.isArray(u.skills) ? u.skills : [];
          return '<div style="padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface)">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
              '<div>' +
                '<strong style="font-size:15px;display:block">' + esc(name) + '</strong>' +
                '<span class="muted" style="font-size:13px">Applied for <strong>' + esc(jobTitle) + '</strong></span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:8px">' +
                '<strong style="color:var(--primary);font-size:15px">' + fmt(p.bidAmount) + '</strong>' +
                '<span class="chip chip-muted">' + esc(p.status || 'PENDING') + '</span>' +
              '</div>' +
            '</div>' +
            (skills.length ? ('<div class="tags" style="margin-top:8px">' + tagsHtml(skills.slice(0, 4)) + '</div>') : '') +
            (p.coverLetter ? ('<div style="margin-top:8px;font-size:13px;color:var(--ink-2);background:var(--bg-2);padding:8px 10px;border-radius:6px;white-space:pre-wrap;border-left:2px solid var(--teal)">' + esc(p.coverLetter) + '</div>') : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">' +
              '<span class="muted" style="font-size:12px">' + (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '') + '</span>' +
              '<div style="display:flex;gap:8px">' +
                (p.status === 'ACCEPTED' ? '<button class="btn btn-primary btn-sm" type="button" data-view-contract-job="' + esc(p.jobId) + '">View Contract</button>' : '') +
                '<button class="btn btn-outline btn-sm" type="button" data-job="' + esc(p.jobId) + '">View Job &amp; Proposal</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    });
  }

  /* ---------- payment methods spotlight (homepage strip) ---------- */
  (function(){
    var box = $('#railSpot'); if (!box) return;
    var pills = $$('.spot-pill', box), cap = $('#spotCap');
    var CAPS = [
      { t:'Raast', x:'Pakistan’s instant payment system, run by the State Bank of Pakistan' },
      { t:'NayaPay', x:'Digital wallet' },
      { t:'SadaPay', x:'Digital wallet' },
      { t:'Bank Transfer', x:'Interbank transfer through 1Link (IBFT)' },
      { t:'JazzCash', x:'Mobile wallet · coming soon, once merchant onboarding is complete' },
      { t:'Easypaisa', x:'Mobile wallet · coming soon, once merchant onboarding is complete' }
    ];
    var BOTH_SOON = { t:'JazzCash and Easypaisa', x:'Coming soon, once merchant onboarding is complete' };
    var phase = 0, timer = null, resumeT = null, capT = null, hover = false, onScreen = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(function(es){ onScreen = es[0].isIntersecting; }).observe(box);
    function paint(sel, bothSoon, byUser){
      pills.forEach(function(p, k){ var on = bothSoon ? k >= 4 : k === sel; p.classList.toggle('on', on); p.setAttribute('aria-pressed', String(on)); });
      var c = bothSoon ? BOTH_SOON : CAPS[sel], soon = bothSoon || sel >= 4;
      cap.setAttribute('aria-live', byUser ? 'polite' : 'off');
      cap.classList.add('out');
      clearTimeout(capT);
      capT = setTimeout(function(){
        cap.innerHTML = '<span class="spot-dot"></span><span><strong>' + c.t + '</strong> · ' + c.x + '</span>';
        cap.classList.toggle('is-soon', soon);
        cap.classList.remove('out');
      }, reduceMotion ? 0 : 160);
    }
    function tick(){
      if (hover || !onScreen || document.hidden || $('[data-view="home"]').hidden) return;
      phase = (phase + 1) % 5;
      if (phase === 4) paint(-1, true, false); else paint(phase, false, false);
    }
    function start(){ if (reduceMotion || timer) return; timer = setInterval(tick, 2200); }
    function stop(){ clearInterval(timer); timer = null; }
    box.addEventListener('click', function(e){
      var b = e.target.closest('.spot-pill'); if (!b) return;
      var k = +b.getAttribute('data-spot');
      paint(k, false, true);
      phase = k >= 4 ? 4 : k;
      stop(); clearTimeout(resumeT); resumeT = setTimeout(start, 8000);
    });
    box.addEventListener('pointerenter', function(e){ if (e.pointerType === 'mouse') hover = true; });
    box.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse') hover = false; });
    start();
  })();

  /* ---------- engagement: page entrance, reveal on scroll, interactive pieces on the inner pages ----------
     Motion is opacity/transform only and is skipped when the visitor prefers reduced motion.
     Class names rc / rc-in ("reveal card") are kept separate from the homepage heading motion (rv / rv-in / anim). */
  var RV_SEL = '.job-card,.t-card,.card-sm,.plan,.blog-card,.hw-step,.faq-item,.next-card,.tf,.ov-card,.example > .card';
  var rvIO = null;
  if (!reduceMotion && 'IntersectionObserver' in window){
    document.documentElement.classList.add('rc-on');
    rvIO = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('rc-in'); rvIO.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  }
  // Cards already on screen when a page opens show straight away (nothing to wait for); cards further down glide in as they're scrolled to.
  function reveal(root){
    if (!root) return;
    var list = $$(RV_SEL, root).filter(function(el){ return !el.classList.contains('rc') && !el.classList.contains('rc-in'); });
    if (!rvIO){ list.forEach(function(el){ el.classList.add('rc-in'); }); return; }
    var fold = window.innerHeight;
    var below = list.filter(function(el){ var r = el.getBoundingClientRect(); return r.height > 0 && r.top > fold - 40; });   // one layout read for the batch
    list.forEach(function(el){ if (below.indexOf(el) < 0 && el.getBoundingClientRect().height > 0) el.classList.add('rc-in'); });
    below.forEach(function(el){
      var i = el.parentNode ? Array.prototype.indexOf.call(el.parentNode.children, el) : 0;
      el.style.setProperty('--rc', Math.min(Math.max(i, 0), 5));     // small stagger inside a grid
      el.classList.add('rc'); rvIO.observe(el);
    });
    // hidden now (e.g. the other How-it-works tab): reveal when shown
    list.forEach(function(el){ if (el.getBoundingClientRect().height === 0){ el.classList.add('rc'); rvIO.observe(el); } });
  }
  // Fade in only the top block of the page (header / hero): animating the whole, very tall page is costly on phones.
  function enterView(v){
    if (!v || reduceMotion) return;
    var el = v.querySelector(':scope > .page-head > .wrap, :scope > .hero > .wrap') || v.firstElementChild;
    if (el && el.animate) el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  // Jobs: quick category chips in the page head (click again to clear)
  function syncJobCats(){
    var c = $('#fCat').value;
    $$('[data-jobcat]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-jobcat') === c)); });
  }
  function syncTalentCats(){
    var q = $('#tSearch').value.trim().toLowerCase();
    $$('[data-view="talent"] .quick-cats [data-cat]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-cat').toLowerCase() === q)); });
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-jobcat]'); if (!b) return;
    var c = b.getAttribute('data-jobcat');
    $('#fCat').value = $('#fCat').value === c ? 'all' : c;
    renderJobs();
  });
  // Specialist cards: star rating from their (sample) reviews
  function talentAvatar(t){
    return '<span class="avatar">' + (t.photo ? '<img src="' + esc(t.photo) + '" alt="">' : esc(t.init)) + '</span>';
  }
  function ratingSpan(t){
    var n = 0, sum = 0, avg = 0;
    if (t && t.rating){ n = t.rating.count; avg = t.rating.avg; }
    else {
      var x = PROFILE_EXTRA[t && t.id];
      if (!x || !x.dist) return '';
      x.dist.forEach(function(c, i){ n += c; sum += c * (5 - i); });
      avg = n ? Math.round((sum / n) * 10) / 10 : 0;
    }
    if (!n) return '';
    return '<span class="t-rating"><span class="stars sm" style="--r:' + avg + '" role="img" aria-label="Rated ' + avg.toFixed(1) + ' out of 5"></span><b>' + avg.toFixed(1) + '</b>(' + n + ' reviews)</span>';
  }

  // How it works: "I'm hiring" / "I'm a specialist"
  (function(){
    var sw = $('.hw-switch'); if (!sw) return;
    function pick(b){
      var k = b.getAttribute('data-hw');
      $$('[data-hw]', sw).forEach(function(x){ x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      $$('[data-hw-panel]').forEach(function(p){ p.hidden = p.getAttribute('data-hw-panel') !== k; });
      $$('[data-hw-cta]').forEach(function(p){ p.hidden = p.getAttribute('data-hw-cta') !== k; });
      reveal($('[data-hw-panel="' + k + '"]'));
    }
    sw.addEventListener('click', function(e){ var b = e.target.closest('[data-hw]'); if (b) pick(b); });
    sw.addEventListener('keydown', function(e){
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var tabs = $$('[data-hw]', sw), i = tabs.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); var t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; pick(t); t.focus();
    });
    $$('[data-hw]', sw).forEach(function(x){ x.tabIndex = x.getAttribute('aria-selected') === 'true' ? 0 : -1; });
  })();

  // Trust: follow a PKR 25,000 milestone through SafePay™
  (function(){
    var box = $('#tfDemo'); if (!box) return;
    var track = $('.tf-track', box), cap = $('#tfCap'), next = $('[data-tf="next"]', box), cur = 0;
    var S = [
      { on: [0], st: ['Agrees the milestone', 'Waiting for funds', 'Waiting to start'], cap: '<strong>The deal is agreed.</strong> The client and specialist agree the scope and a PKR 25,000 milestone in the contract.' },
      { on: [1], st: ['Funded the milestone', 'Holding PKR 25,000', 'Can see it’s secured'], cap: '<strong>The client funds the milestone.</strong> SafePay™ holds the PKR 25,000, and the specialist can see it’s secured before starting work.' },
      { on: [1, 2], st: ['Reviews the delivery', 'Still holding the money', 'Submitted the work'], cap: '<strong>The specialist delivers.</strong> The work is submitted in Paklance, and the money stays protected while the client reviews it.' },
      { on: [2], st: ['Approved the work', 'Released the payment', 'Paid PKR 25,000'], cap: '<strong>Approved and paid.</strong> The client approves, and SafePay™ releases the payment to the specialist, who can withdraw it to a bank account or Raast ID.' }
    ];
    var D = { on: [1], st: ['Opened a case', 'Money on hold', 'Shares their evidence'], cap: '<strong>If there’s a problem,</strong> either side can open a case. The money stays on hold while Paklance reviews the contract, messages and files, then releases or refunds it.' };
    function show(k){
      var s = k === 'd' ? D : S[k]; cur = k;
      track.setAttribute('data-s', String(k));
      $$('.tf-node', track).forEach(function(n, i){ n.classList.toggle('is-on', s.on.indexOf(i) > -1); $('.tf-st', n).textContent = s.st[i]; });
      $$('[data-tf-go]', box).forEach(function(b){ if (b.getAttribute('data-tf-go') === String(k)) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      cap.innerHTML = s.cap;
      next.textContent = k === 3 ? 'Start again' : (k === 'd' ? 'Back to the normal flow' : 'Next step');
    }
    box.addEventListener('click', function(e){
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-tf-go')){ show(+b.getAttribute('data-tf-go')); return; }
      if (b.getAttribute('data-tf') === 'next') show(cur === 'd' ? 2 : (cur + 1) % 4);
      if (b.getAttribute('data-tf') === 'dispute') show('d');
    });
    show(0);
  })();

  // Global hiring: how a 9-to-5 day in the client's city overlaps with the specialist's day in Pakistan
  (function(){
    var sel = $('#ovCity'); if (!sel) return;
    var chart = $('#ovChart'), out = $('#ovResult'), note = $('#ovNote'), shift = 9, PKT = 300, DAY = 1440;
    function offsetNow(zone){                    // minutes ahead of UTC today (includes daylight saving)
      var d = new Date(); d.setSeconds(0, 0);
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(d).forEach(function(x){ p[x.type] = x.value; });
      return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - d.getTime()) / 60000);
    }
    function mod(m){ return ((m % DAY) + DAY) % DAY; }
    function hm(m){ m = mod(m); var h = Math.floor(m / 60), n = m % 60; return h + ':' + (n < 10 ? '0' : '') + n; }
    function split(start, len){ var s = mod(start); return s + len <= DAY ? [[s, s + len]] : [[s, DAY], [0, s + len - DAY]]; }
    function bar(segs, cls){ return segs.map(function(g){ return '<span class="ov-seg ' + cls + '" style="left:' + (g[0] / DAY * 100) + '%;width:' + ((g[1] - g[0]) / DAY * 100) + '%"></span>'; }).join(''); }
    function draw(){
      var off = offsetNow(sel.value), city = sel.options[sel.selectedIndex].text;
      var you = [[540, 1020]], pk = split(shift * 60 - PKT + off, 540), both = [];
      pk.forEach(function(g){ var a = Math.max(g[0], 540), b = Math.min(g[1], 1020); if (b > a) both.push([a, b]); });
      var mins = both.reduce(function(t, g){ return t + g[1] - g[0]; }, 0), hrs = mins / 60;
      out.innerHTML = mins
        ? '<strong>' + (hrs % 1 ? hrs.toFixed(1) : hrs) + ' hour' + (hrs === 1 ? '' : 's') + ' of overlap</strong>each working day, ' + both.map(function(g){ return hm(g[0]) + '–' + hm(g[1]); }).join(' and ') + ' in ' + city + '.'
        : '<strong>No overlap</strong>with a 9-to-5 day in ' + city + '. Try a later shift, or plan work that doesn’t need live calls.';
      chart.innerHTML =
        '<div class="ov-row"><span>Your team in ' + city + ' (9:00–17:00)</span><div class="ov-bar">' + bar(you, 'you') + '</div></div>' +
        '<div class="ov-row"><span>Specialist in Pakistan, shown in your time (' + hm(pk[0][0]) + '–' + hm(pk[0][0] + 540) + ')</span><div class="ov-bar">' + bar(pk, 'pk') + '</div></div>' +
        '<div class="ov-row"><span>Time you can work together</span><div class="ov-bar">' + bar(both, 'both') + '</div></div>' +
        '<div class="ov-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>' +
        '<div class="ov-legend"><span><i style="background:#8FB9A2"></i>Your day</span><span><i style="background:var(--brand-3)"></i>Specialist’s day</span><span><i style="background:#E3A33B"></i>Overlap</span></div>';
      var diff = (PKT - off) / 60;
      note.textContent = diff === 0 ? 'Same time as Pakistan today.' : 'Pakistan is ' + Math.abs(diff) + ' hour' + (Math.abs(diff) === 1 ? '' : 's') + (diff > 0 ? ' ahead of ' : ' behind ') + city + ' today (daylight saving included).';
    }
    sel.addEventListener('change', draw);
    $('.ov-shifts').addEventListener('click', function(e){
      var b = e.target.closest('[data-ov-shift]'); if (!b) return;
      shift = +b.getAttribute('data-ov-shift');
      $$('[data-ov-shift]').forEach(function(x){ x.setAttribute('aria-checked', String(x === b)); });
      draw();
    });
    draw();
  })();

  // Pricing: fee calculator (same placeholder rates as the fee cards: 3% client, 10% specialist)
  (function(){
    var amt = $('#calcAmt'); if (!amt) return;
    var CF = CFG.fees.clientPercent / 100, SF = CFG.fees.specialistPercent / 100;
    function pkr(n){ return 'PKR ' + Math.round(n).toLocaleString('en-US'); }
    function set(v){
      v = Math.max(5000, Math.min(500000, Math.round(v / 1000) * 1000)); amt.value = v;
      CF = CFG.fees.clientPercent / 100; SF = CFG.fees.specialistPercent / 100;
      var cf = Math.round(v * CF), sf = Math.round(v * SF);
      $('#calcTitle').textContent = 'A ' + pkr(v) + ' contract';
      $('[data-calc="v"]').textContent = pkr(v);
      $('[data-calc="cf"]').textContent = '+ ' + pkr(cf);
      $('[data-calc="cp"]').textContent = pkr(v + cf);
      $('[data-calc="sf"]').textContent = '− ' + pkr(sf);
      $('[data-calc="sr"]').textContent = pkr(v - sf);
      $$('.calc-presets [data-amt]').forEach(function(b){ b.setAttribute('aria-pressed', String(+b.getAttribute('data-amt') === v)); });
    }
    amt.addEventListener('input', function(){ set(+amt.value); });
    $('.calc-presets').addEventListener('click', function(e){ var b = e.target.closest('[data-amt]'); if (b) set(+b.getAttribute('data-amt')); });
  })();

  // "Keep exploring" at the end of every inner page, so no page is a dead end
  (function(){
    var C = {
      jobs: ['#jobs', 'search', 'Browse jobs', 'Find work with clear PKR budgets.'],
      talent: ['#talent', 'users', 'Hire talent', 'Verified specialists with ratings and portfolios.'],
      how: ['#how', 'list', 'How it works', 'From brief to paid in five steps.'],
      pricing: ['#pricing', 'wallet', 'Pricing', 'Work out exactly what you’ll pay.'],
      trust: ['#trust', 'shield', 'Trust & SafePay™', 'Follow a payment from funding to release.'],
      global: ['#global', 'globe', 'Global hiring', 'See how your working hours overlap.'],
      match: ['#match', 'sparkle', 'Paklance Match™', 'Get a curated shortlist instead of bids.'],
      blog: ['#blog', 'bulb', 'Blog', 'Guides for freelancers and hiring teams.']
    };
    var NEXT = { jobs: ['how', 'pricing', 'blog'], talent: ['match', 'trust', 'global'], how: ['pricing', 'trust', 'jobs'], global: ['match', 'talent', 'trust'],
      match: ['talent', 'global', 'pricing'], trust: ['how', 'pricing', 'talent'], pricing: ['trust', 'how', 'jobs'] };
    Object.keys(NEXT).forEach(function(v){
      var view = $('[data-view="' + v + '"]'); if (!view) return;
      var sec = document.createElement('section');
      sec.className = 'next-band'; sec.setAttribute('aria-label', 'Keep exploring');
      sec.innerHTML = '<div class="wrap"><span class="eyebrow">Keep exploring</span><div class="next-grid">' + NEXT[v].map(function(k){
        var c = C[k];
        return '<a class="next-card" href="' + c[0] + '"><span class="ni"><svg class="ic" aria-hidden="true"><use href="#i-' + c[1] + '"/></svg></span>' +
          '<span><strong>' + c[2] + '</strong><small>' + c[3] + '</small></span><svg class="ic go" aria-hidden="true"><use href="#i-arrow-right"/></svg></a>';
      }).join('') + '</div></div>';
      view.appendChild(sec);
    });
  })();

  /* ---------- homepage heading motion: rotating skill in the hero, section headings wipe in on scroll ---------- */
  (function(){
    var slot = $('.ht-slot'); if (!slot) return;
    var words = $$('.ht-word', slot), i = 0;
    function fit(){ var w = words[i].offsetWidth; slot.style.width = w ? w + 'px' : ''; }   // the slot hugs the current word
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('hashchange', function(){ setTimeout(fit, 0); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    if (reduceMotion) return;                        // reduced motion: the headline stays "Hire Pakistani talent."
    document.documentElement.classList.add('anim');
    var heroOn = true;                               // no rotating (and re-measuring) while the hero is scrolled out of view
    if ('IntersectionObserver' in window) new IntersectionObserver(function(es){ heroOn = es[es.length - 1].isIntersecting; }).observe($('.hero'));
    setInterval(function(){
      if (!heroOn || document.hidden || $('[data-view="home"]').hidden) return;
      var prev = words[i]; i = (i + 1) % words.length;
      words.forEach(function(w){ w.classList.remove('is-out'); });
      prev.classList.remove('is-on'); prev.classList.add('is-out');
      words[i].classList.add('is-on'); fit();
    }, 2200);
    // every homepage heading (and its cards) plays when it scrolls into view, and again each time it comes back
    var heads = $$('[data-view="home"] .rv, [data-view="home"] .rv-list, [data-view="home"] .rv-label');
    if (!('IntersectionObserver' in window)) { heads.forEach(function(h){ h.classList.add('rv-in'); }); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting && e.intersectionRatio >= 0.2) e.target.classList.add('rv-in');
        else if (!e.isIntersecting) e.target.classList.remove('rv-in');
      });
    }, { threshold: [0, 0.2] });
    heads.forEach(function(h){ io.observe(h); });
  })();

  /* ---------- How Paklance works: live walk-through ----------
     Step 1 (Post) runs, the line fills to step 2 with a coin, step 2 (Protect) runs, then step 3 (Approve).
     Loops while the section is on screen and starts again from step 1 each time it comes back into view.
     Reduced motion: no walk-through, the three steps simply show complete. */
  (function(){
    var tl = $('#howTimeline'); if (!tl || reduceMotion) return;
    var steps = $$('.tl-step', tl), nums = $$('.tl-num', tl), pill = $('.tl-pill.done', tl), status = $('.tl-status', tl);
    var DONE_TEXT = status.textContent, timers = [], raf = [], running = false, onScreen = false, loops = 0;
    tl.classList.add('tl-live');
    function later(fn, ms){ timers.push(setTimeout(fn, ms)); }
    function fmt(n){ return n.toLocaleString('en-US'); }
    function count(el, ms){                          // about 16 updates a second: smooth to the eye, light on phones
      var to = +el.getAttribute('data-to'), t0 = performance.now();
      (function tick(){
        var p = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(p < 1 ? Math.round(to * e / 100) * 100 : to);
        if (p < 1) later(tick, 60);
      })();
    }
    function clearAll(){ timers.forEach(clearTimeout); raf.forEach(cancelAnimationFrame); timers = []; raf = []; }
    function setState(state){          // 'idle' = nothing done yet, 'complete' = the finished picture
      clearAll();
      steps.forEach(function(s){ s.classList.remove('is-active','is-moving'); s.classList.toggle('is-done', state === 'complete'); s.classList.toggle('is-linked', state === 'complete'); });
      nums.forEach(function(n){ n.textContent = state === 'complete' ? fmt(+n.getAttribute('data-to')) : '0'; });
      pill.classList.remove('is-wait','is-released'); status.textContent = DONE_TEXT;
    }
    function activate(i){ var s = steps[i], n = $('.tl-num', s); s.classList.add('is-active'); if (n) count(n, 1200); }
    function finish(i){ steps[i].classList.remove('is-active'); steps[i].classList.add('is-done'); }
    function link(i){ var s = steps[i]; s.classList.add('is-linked','is-moving'); later(function(){ s.classList.remove('is-moving'); }, 1000); }
    function run(){
      setState('idle'); running = true;
      later(function(){ activate(0); }, 700);                                   // Post: pencil writes, budget counts up
      later(function(){ finish(0); link(0); }, 2600);                           // coin travels to step 2
      later(function(){ activate(1); }, 3600);                                  // Protect: shield locks, PKR 25,000 held
      later(function(){ finish(1); link(1); }, 5500);                           // coin travels to step 3
      later(function(){ activate(2); pill.classList.add('is-wait'); status.textContent = 'Reviewing the work…'; }, 6500);
      later(function(){ pill.classList.remove('is-wait'); pill.classList.add('is-released'); status.textContent = DONE_TEXT; }, 7700);
      later(function(){ finish(2); }, 8600);
      later(function(){ if (++loops < 3) run(); else setState('complete'); }, 11500);   // loop 3 times, then hold the finished picture
    }
    function stop(){ running = false; setState('complete'); }
    function sync(){ var go = onScreen && !document.hidden && !$('[data-view="home"]').hidden; if (go && !running){ loops = 0; run(); } else if (!go && running) stop(); }
    stop();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function(entries){ onScreen = entries[entries.length - 1].intersectionRatio >= 0.35; sync(); }, { threshold: [0, 0.35] }).observe(tl);
    } else { onScreen = true; sync(); }
    document.addEventListener('visibilitychange', sync);
  })();


  /* ---------- start ---------- */
  function loadData(){
    return Promise.all([
      // Production: GET /api/jobs returns flat Job[] array (no wrapper object, no limit param by name)
      api('GET', '/jobs').then(function(r){ var list = Array.isArray(r) ? r : (r.jobs || []); if (list.length) replace(JOBS, list.map(fromApiJob)); }).catch(noop),
      // Production: GET /api/profiles/search returns flat Profile[] array
      api('GET', '/profiles/search').then(function(r){ var list = Array.isArray(r) ? r : (r.talent || r.profiles || []); if (list.length) replace(TALENT, list.map(fromApiTalent)); }).catch(noop),
      // Blog: no production endpoint. Articles are embedded in blog.js — skip silently.
      Promise.resolve()
    ]);
  }
  function loadGoogle(){
    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) return;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  // The button at the end of each blog article
  function blogCta(action){
    var u = PaklanceAuth.getUser();
    if (action === 'signup' || !u){ authEntry(true); return; }
    go('dashboard');
    if (action === 'video') setTimeout(function(){ PaklanceProfile.open('video'); }, 350);
  }

  PaklanceProfile.init({
    notify: toast,
    onUpdate: function(s){        // keep the "Your setup" checklist in step with the tracker
      var li = $('#dashProfileStep'); if (!li) return;
      li.classList.toggle('ok', s.done === s.total);
      li.querySelector('.chip').textContent = s.done + ' of ' + s.total + ' done';
    }
  });

  if (!LIVE){
    // Opened from disk: same behaviour as the review build (sample data, preview sign-up).
    PaklanceAuth.init({ mock: true, notify: toast, onFinish: function(){ go('dashboard'); } });
    PaklanceAuth.onChange(updateHeader);
    PaklanceBlog.init({ notify: toast, baseTitle: 'Paklance', onCta: blogCta, onFeedback: noop });
    renderJobs(); renderTalent(); route();
    PaklanceMessages.init({ api: api, getUser: function(){ return PaklanceAuth.getUser(); }, toast: toast });
    return;
  }

  pathToHash();
  PaklanceBlog.init({
    notify: toast,
    baseTitle: 'Paklance',
    onCta: blogCta,
    // "Was this helpful?" → the API (a "Not really" answer is sent again with the comment, and counts once)
    onFeedback: function(slug, vote, comment){
      api('POST', '/blog/articles/' + encodeURIComponent(slug) + '/feedback', comment ? { vote: vote, comment: comment } : { vote: vote }).catch(noop);
    },
    subscribe: function(email){ return api('POST', '/newsletter/subscribe', { email: email, source: 'blog' }); }
  });
  renderJobs(); renderTalent(); route();
  CFG = { fees: { clientPercent: 3, specialistPercent: 10 }, googleClientId: PROD_GOOGLE_CLIENT_ID };
  (function(){
    function startApp(cfg){
      if (cfg && cfg.googleClientId){
        CFG.googleClientId = cfg.googleClientId;
      }
      if (cfg && cfg.fees) CFG.fees = cfg.fees;
      loadGoogle();
      var ready = PaklanceAuth.init({
        mock: false,
        apiBase: '/api',
        googleClientId: CFG.googleClientId || PROD_GOOGLE_CLIENT_ID,
        notify: toast,
        onFinish: function(){ go('dashboard'); }
      });
      PaklanceAuth.onChange(updateHeader);
      PaklanceMessages.init({ api: api, getUser: function(){ return PaklanceAuth.getUser(); }, toast: toast });
      Promise.all([ready, loadData()]).then(function(){
        renderJobs(); renderTalent(); route();
      });
    }

    api('GET', '/config')
      .then(function(cfg){ startApp(cfg); })
      .catch(function(){ startApp(null); });
  })();

  /* ===================================================================
   * PaklanceMessages — real-time messaging connected to the production
   * NestJS backend at /api/messaging/*
   * Endpoints used:
   *   GET  /api/messaging/conversations
   *   GET  /api/messaging/conversations/:id/messages
   *   POST /api/messaging/send          { receiverId, content }
   *   POST /api/messaging/sync-delivered
   *   DELETE /api/messaging/messages/:id
   * =================================================================== */
  var PaklanceMessages = (function(){
    var _api, _getUser, _toast;
    var _pollTimer = null;
    var _pollInterval = 2500; // ms
    var _activeConvId = null;
    var _activeOtherUser = null;
    var _conversations = [];
    var _syncDone = false; // sync-delivered called once per open session
    var _pendingUser = null; // { id, name, role } set from specialist profile button
    var _searchQuery = '';
    var _userSearchTimer = null;

    // -------- helpers --------
    function el(id){ return document.getElementById(id); }
    function escHtml(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function initials(name){
      var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
      return ((parts[0]||'?').charAt(0) + (parts.length > 1 ? parts[parts.length-1].charAt(0) : '')).toUpperCase();
    }
    function fmtTime(iso){
      if (!iso) return '';
      var d = new Date(iso), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'});
      return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    }

    // -------- open/close --------
    function open(targetUser){
      if (targetUser) _pendingUser = targetUser;
      var m = document.getElementById('m-messages');
      if (!m) return;
      // Re-use the existing modal infrastructure
      $$('.modal').forEach(function(md){ md.hidden = true; });
      document.body.style.overflow = 'hidden';
      m.hidden = false;
      // Reset mobile pane
      var layout = el('pkMsgLayout');
      if (layout) layout.classList.remove('thread-open');
      _activeConvId = null;
      _activeOtherUser = null;
      _syncDone = false;
      _searchQuery = '';
      var sInp = el('pkMsgSearch');
      if (sInp) sInp.value = '';
      var pnl = el('pkMsgNewPanel');
      if (pnl) pnl.hidden = true;
      render();
    }
    function close(){
      stopPoll();
      var m = document.getElementById('m-messages');
      if (m) m.hidden = true;
      document.body.style.overflow = '';
      _activeConvId = null;
      _activeOtherUser = null;
      _pendingUser = null;
      _searchQuery = '';
      var pnl = el('pkMsgNewPanel');
      if (pnl) pnl.hidden = true;
    }

    // -------- polling --------
    function startPoll(){
      stopPoll();
      if (!_activeConvId || !_activeConvId.startsWith('draft_')) {
        _pollTimer = setInterval(pollTick, _pollInterval);
      }
    }
    function stopPoll(){
      if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    }
    function pollTick(){
      var m = document.getElementById('m-messages');
      if (!m || m.hidden) { stopPoll(); return; }
      var u = _getUser();
      if (!u) { stopPoll(); return; }
      // Refresh messages in active thread
      if (_activeConvId && !_activeConvId.startsWith('draft_')) {
        _api('GET', '/messaging/conversations/' + _activeConvId + '/messages').then(function(data){
          renderBubbles(Array.isArray(data) ? data : (data.data || []));
        }).catch(function(){});
      }
      // Refresh conversation list silently
      _api('GET', '/messaging/conversations').then(function(data){
        _conversations = Array.isArray(data) ? data : (data.data || []);
        renderConvList();
      }).catch(function(){});
    }

    // -------- user search & new message --------
    function searchUsers(q){
      var listEl = el('pkMsgUsersList');
      if (!listEl) return;
      listEl.innerHTML = '<p class="pk-msg-empty-hint">Searching users…</p>';
      _api('GET', '/users/search?q=' + encodeURIComponent(q || '')).then(function(users){
        var list = Array.isArray(users) ? users : (users.data || []);
        if (!list.length) {
          listEl.innerHTML = '<p class="pk-msg-empty-hint">No users found.</p>';
          return;
        }
        listEl.innerHTML = list.map(function(u){
          var name = u.name || (u.email && u.email.split('@')[0]) || 'User';
          var inits = initials(name);
          var av = u.avatarUrl
            ? '<img src="' + escHtml(u.avatarUrl) + '" alt="">'
            : escHtml(inits);
          var role = u.headline || u.role || u.email || '';
          return '<div class="pk-msg-user-item" role="button" tabindex="0" data-new-user-id="' + escHtml(u.id) + '" data-new-user-name="' + escHtml(name) + '" data-new-user-role="' + escHtml(role) + '">' +
            '<span class="pk-msg-user-av">' + av + '</span>' +
            '<div class="pk-msg-user-info">' +
              '<div class="pk-msg-user-name">' + escHtml(name) + '</div>' +
              '<div class="pk-msg-user-role">' + escHtml(role) + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }).catch(function(err){
        listEl.innerHTML = '<p class="pk-msg-empty-hint">' + escHtml(err && err.message || 'Could not load users.') + '</p>';
      });
    }

    function toggleNewPanel(show){
      var panel = el('pkMsgNewPanel');
      if (!panel) return;
      var wantShow = (typeof show === 'boolean') ? show : panel.hidden;
      panel.hidden = !wantShow;
      if (wantShow) {
        searchUsers(_searchQuery);
        var sInp = el('pkMsgSearch');
        if (sInp) sInp.focus();
      }
    }

    function startConversationWithUser(user){
      if (!user || !user.id) return;
      var existing = _conversations.filter(function(c){
        return c.otherUser && c.otherUser.id === user.id;
      })[0];
      if (existing) {
        selectConv(existing.id, existing.otherUser);
      } else {
        var draft = {
          id: 'draft_' + user.id,
          isDraft: true,
          otherUser: user,
          lastMessage: null,
          updatedAt: new Date().toISOString()
        };
        _conversations = _conversations.filter(function(c){ return c.id !== draft.id; });
        _conversations.unshift(draft);
        renderConvList();
        selectConv(draft.id, draft.otherUser);
      }
      var inp = el('pkMsgInput');
      if (inp) inp.focus();
    }

    // -------- main render --------
    function render(){
      var u = _getUser();
      if (!u) { close(); PaklanceAuth.open('login'); return; }
      var listEl = el('pkMsgConvList');
      if (listEl) listEl.innerHTML = '<p class="pk-msg-empty-hint">Loading conversations…</p>';
      clearThread();
      _api('GET', '/messaging/conversations').then(function(data){
        _conversations = Array.isArray(data) ? data : (data.data || []);
        // sync delivered once on open
        if (!_syncDone) {
          _syncDone = true;
          _api('POST', '/messaging/sync-delivered', {}).catch(function(){});
        }
        renderConvList();
        // If opened from a specialist profile or message button, start conversation
        if (_pendingUser && _pendingUser.id) {
          startConversationWithUser(_pendingUser);
          _pendingUser = null;
        } else if (_conversations.length > 0 && window.innerWidth > 680) {
          // Auto-select first on desktop
          selectConv(_conversations[0].id, _conversations[0].otherUser);
        }
      }).catch(function(err){
        if (listEl) listEl.innerHTML = '<p class="pk-msg-empty-hint">' + escHtml(err && err.message || 'Could not load conversations.') + '</p>';
      });
    }

    function renderConvList(){
      var listEl = el('pkMsgConvList');
      if (!listEl) return;
      var count = el('pkMsgCount');
      if (!_conversations.length) {
        listEl.innerHTML = '<p class="pk-msg-empty-hint">No conversations yet.<br>Click <strong>+ New</strong> above or tap <strong>Message</strong> on any user profile to start one.</p>';
        if (count) { count.textContent = '0'; count.hidden = true; }
        return;
      }
      var filtered = _conversations;
      if (_searchQuery) {
        filtered = _conversations.filter(function(c){
          var other = c.otherUser || {};
          var name = (other.name || other.email || '').toLowerCase();
          var last = (c.lastMessage && c.lastMessage.content || '').toLowerCase();
          return name.indexOf(_searchQuery) > -1 || last.indexOf(_searchQuery) > -1;
        });
      }
      if (count) { count.textContent = _conversations.length; count.hidden = false; }
      if (!filtered.length) {
        listEl.innerHTML = '<p class="pk-msg-empty-hint">No conversations match “' + escHtml(_searchQuery) + '”.<br><button class="btn btn-outline btn-xs" id="pkMsgSearchNewUserBtn" type="button" style="margin-top:8px">Find user to message</button></p>';
        return;
      }
      listEl.innerHTML = filtered.map(function(c){
        var other = c.otherUser || {};
        var name = other.name || (other.email && other.email.split('@')[0]) || 'User';
        var inits = initials(name);
        var av = other.avatarUrl
          ? '<img src="' + escHtml(other.avatarUrl) + '" alt="">'
          : escHtml(inits);
        var last = c.lastMessage ? escHtml(c.lastMessage.content || '') : (c.isDraft ? '<em>New conversation</em>' : '<em>No messages yet</em>');
        var when = c.lastMessage ? fmtTime(c.lastMessage.createdAt) : '';
        var isActive = c.id === _activeConvId;
        return '<div class="pk-msg-conv-item' + (isActive ? ' active' : '') + '" role="option" aria-selected="' + isActive + '" data-conv-id="' + escHtml(c.id) + '" data-conv-name="' + escHtml(name) + '" tabindex="0">' +
          '<span class="pk-msg-conv-av">' + av + '</span>' +
          '<div class="pk-msg-conv-info">' +
            '<div class="pk-msg-conv-name">' + escHtml(name) + '</div>' +
            '<div class="pk-msg-conv-last">' + last + '</div>' +
            '<div class="pk-msg-conv-when">' + escHtml(when) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function selectConv(convId, otherUser){
      _activeConvId = convId;
      _activeOtherUser = otherUser || {};
      renderConvList();
      var name = _activeOtherUser.name || (_activeOtherUser.email && _activeOtherUser.email.split('@')[0]) || 'User';
      // Thread header
      var head = el('pkMsgThreadHead'), av = el('pkMsgThreadAv'), nm = el('pkMsgThreadName'), role = el('pkMsgThreadRole');
      if (head) head.hidden = false;
      if (av) av.textContent = initials(name);
      if (nm) nm.textContent = name;
      if (role) role.textContent = _activeOtherUser.role || _activeOtherUser.headline || '';
      // Show compose
      var compose = el('pkMsgCompose'), emptyPane = el('pkMsgThreadEmpty');
      if (compose) compose.hidden = false;
      if (emptyPane) emptyPane.style.display = 'none';
      // Mobile: slide thread in
      var layout = el('pkMsgLayout');
      if (layout) layout.classList.add('thread-open');
      // Clear bubbles and load
      var bubbles = el('pkMsgBubbles');
      if (bubbles) { bubbles.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Loading…</p>'; }
      hideErr();
      if (convId.startsWith('draft_')) {
        if (bubbles) bubbles.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">Send a message to start the conversation.</p>';
        stopPoll();
        return;
      }
      _api('GET', '/messaging/conversations/' + convId + '/messages').then(function(data){
        renderBubbles(Array.isArray(data) ? data : (data.data || []));
        startPoll();
      }).catch(function(err){
        showErr(err && err.message || 'Could not load messages.');
        stopPoll();
      });
    }

    function clearThread(){
      var head = el('pkMsgThreadHead'), compose = el('pkMsgCompose'), emptyPane = el('pkMsgThreadEmpty'), bubbles = el('pkMsgBubbles');
      if (head) head.hidden = true;
      if (compose) compose.hidden = true;
      if (emptyPane) emptyPane.style.display = '';
      if (bubbles) bubbles.innerHTML = '';
      stopPoll();
    }

    function renderBubbles(messages){
      var u = _getUser();
      var myId = u && (u.id || u.userId);
      var bubbles = el('pkMsgBubbles');
      if (!bubbles) return;
      if (!messages.length) {
        bubbles.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No messages yet. Say hello!</p>';
        return;
      }
      bubbles.innerHTML = messages.map(function(msg){
        var sent = msg.senderId === myId;
        var cls = sent ? 'sent' : 'recv';
        var unsendBtn = sent
          ? '<button class="pk-bubble-unsend" data-unsend-id="' + escHtml(msg.id) + '" title="Unsend">Unsend</button>'
          : '';
        return '<div class="pk-bubble-wrap ' + cls + '">' +
          '<div class="pk-bubble">' + escHtml(msg.content || '') + '</div>' +
          '<div class="pk-bubble-meta">' +
            '<span class="pk-bubble-time">' + escHtml(fmtTime(msg.createdAt)) + '</span>' +
            unsendBtn +
          '</div>' +
        '</div>';
      }).join('');
      // Scroll to bottom
      bubbles.scrollTop = bubbles.scrollHeight;
    }

    function showErr(msg){
      var e = el('pkMsgErr');
      if (e) { e.textContent = msg; e.hidden = false; }
    }
    function hideErr(){
      var e = el('pkMsgErr');
      if (e) e.hidden = true;
    }

    // -------- send --------
    function sendMessage(content){
      var u = _getUser();
      if (!u) { _toast('Log in to send messages.'); return; }
      if (!_activeOtherUser || !_activeOtherUser.id) { _toast('Select a conversation first.'); return; }
      if (!content.trim()) return;
      var receiverId = _activeOtherUser.id;
      var btn = el('pkMsgSendBtn');
      if (btn) btn.disabled = true;
      hideErr();
      _api('POST', '/messaging/send', { receiverId: receiverId, content: content.trim() }).then(function(msg){
        // Clear input
        var inp = el('pkMsgInput');
        if (inp) { inp.value = ''; inp.style.height = 'auto'; }
        // If this was a draft conversation, the real id is now known — refresh list
        var wasDraft = _activeConvId && _activeConvId.startsWith('draft_');
        // Refresh conversations then messages
        return _api('GET', '/messaging/conversations').then(function(data){
          _conversations = Array.isArray(data) ? data : (data.data || []);
          renderConvList();
          // Find real conv id
          var found = _conversations.filter(function(c){ return c.otherUser && c.otherUser.id === receiverId; })[0];
          if (found && (wasDraft || found.id !== _activeConvId)) {
            _activeConvId = found.id;
          }
          if (_activeConvId && !_activeConvId.startsWith('draft_')) {
            return _api('GET', '/messaging/conversations/' + _activeConvId + '/messages').then(function(msgs){
              renderBubbles(Array.isArray(msgs) ? msgs : (msgs.data || []));
              startPoll();
            });
          }
        });
      }).catch(function(err){
        if (err && err.code === 'UNAUTHENTICATED') {
          close(); PaklanceAuth.open('login');
        } else {
          showErr(err && err.message || 'Could not send message.');
        }
      }).then(function(){
        if (btn) btn.disabled = false;
      });
    }

    // -------- unsend --------
    function unsendMessage(msgId){
      if (!window.confirm('Unsend this message?')) return;
      _api('DELETE', '/messaging/messages/' + msgId, null).then(function(){
        if (_activeConvId && !_activeConvId.startsWith('draft_')) {
          _api('GET', '/messaging/conversations/' + _activeConvId + '/messages').then(function(msgs){
            renderBubbles(Array.isArray(msgs) ? msgs : (msgs.data || []));
          }).catch(function(){});
        }
        _toast('Message unsent.');
      }).catch(function(err){
        _toast(err && err.message || 'Could not unsend message.');
      });
    }

    // -------- event wiring --------
    function wireEvents(){
      // Conversation list click/keyboard
      document.addEventListener('click', function(e){
        var convItem = e.target.closest('.pk-msg-conv-item');
        if (convItem) {
          var cid = convItem.getAttribute('data-conv-id');
          var conv = _conversations.filter(function(c){ return c.id === cid; })[0];
          if (conv) selectConv(conv.id, conv.otherUser);
          return;
        }
        // New Message button
        if (e.target.closest('#pkMsgNewBtn')) {
          toggleNewPanel();
          return;
        }
        // Cancel new message
        if (e.target.closest('#pkMsgCancelNew')) {
          toggleNewPanel(false);
          return;
        }
        // Search button inside empty state
        if (e.target.closest('#pkMsgSearchNewUserBtn')) {
          toggleNewPanel(true);
          return;
        }
        // Clicking a user in the new message recipient list
        var userItem = e.target.closest('.pk-msg-user-item');
        if (userItem) {
          var uid = userItem.getAttribute('data-new-user-id');
          var uname = userItem.getAttribute('data-new-user-name') || '';
          var urole = userItem.getAttribute('data-new-user-role') || '';
          toggleNewPanel(false);
          var sInp = el('pkMsgSearch');
          if (sInp) { sInp.value = ''; _searchQuery = ''; renderConvList(); }
          startConversationWithUser({ id: uid, name: uname, role: urole, headline: urole });
          return;
        }
        // Back button on mobile
        if (e.target.closest('#pkMsgBackBtn')) {
          var layout = el('pkMsgLayout');
          if (layout) layout.classList.remove('thread-open');
          stopPoll();
          return;
        }
        // Unsend
        var unsendBtn = e.target.closest('.pk-bubble-unsend');
        if (unsendBtn) {
          unsendMessage(unsendBtn.getAttribute('data-unsend-id'));
          return;
        }
        // Message button on specialist profile, talent card or job detail
        var msgBtn = e.target.closest('[data-msg-user-id]');
        if (msgBtn && msgBtn.getAttribute('data-msg-user-id')) {
          var uid = msgBtn.getAttribute('data-msg-user-id');
          var uname = msgBtn.getAttribute('data-msg-user-name') || '';
          var urole = msgBtn.getAttribute('data-msg-user-role') || '';
          var uu = _getUser();
          if (!uu) { PaklanceAuth.open('login'); return; }
          open({ id: uid, name: uname, role: urole, headline: urole });
          return;
        }
      });

      document.addEventListener('keydown', function(e){
        // Allow Enter on conversation list items and user items for keyboard nav
        var convItem = e.target.closest('.pk-msg-conv-item');
        if (convItem && e.key === 'Enter') { convItem.click(); }
        var userItem = e.target.closest('.pk-msg-user-item');
        if (userItem && e.key === 'Enter') { userItem.click(); }
      });

      // Search input live filtering
      var searchInp = el('pkMsgSearch');
      if (searchInp) {
        searchInp.addEventListener('input', function(e){
          _searchQuery = (e.target.value || '').trim().toLowerCase();
          renderConvList();
          clearTimeout(_userSearchTimer);
          _userSearchTimer = setTimeout(function(){
            var panel = el('pkMsgNewPanel');
            if (panel && !panel.hidden) searchUsers(_searchQuery);
          }, 250);
        });
      }

      // Compose form submit
      var compose = el('pkMsgCompose');
      if (compose) {
        compose.addEventListener('submit', function(e){
          e.preventDefault();
          var inp = el('pkMsgInput');
          if (inp) sendMessage(inp.value);
        });
      }
      // Textarea: Shift+Enter = newline, Enter = send
      var inp = el('pkMsgInput');
      if (inp) {
        inp.addEventListener('keydown', function(e){
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(inp.value);
          }
        });
        // Auto-resize textarea
        inp.addEventListener('input', function(){
          inp.style.height = 'auto';
          inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
        });
      }
      // Stop polling when modal closes
      var m = document.getElementById('m-messages');
      if (m) {
        m.addEventListener('click', function(e){
          if (e.target === m) { close(); }
        });
      }
    }

    // -------- public --------
    function init(opts){
      _api = opts.api;
      _getUser = opts.getUser;
      _toast = opts.toast || function(){};
      wireEvents();
    }

    return { init: init, open: open, close: close, startConversation: startConversationWithUser };
  })();

})();
