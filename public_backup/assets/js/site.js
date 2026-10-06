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
  var CFG = { fees: { clientPercent: 3, specialistPercent: 10 }, googleClientId: null };
  var noop = function(){};

  /* Built-in sample data: used only when the API can't be reached. The API serves the same samples (flagged
     isSample) plus real jobs and profiles. */
  var JOBS = [
    {id:1,title:'Shopify store setup for a clothing brand',client:'Retail brand',city:'Karachi',cat:'Development',budget:85000,type:'Fixed price',verified:true,safepay:true,skills:['Shopify','Liquid','Payments setup'],desc:'Set up a Shopify store with around 40 products, size variants, cash-on-delivery and bank transfer checkout, and English/Urdu product pages.',ms:[['Store structure & theme',30000],['Products, variants & checkout',35000],['Launch & handover',20000]]},
    {id:2,title:'Logo & packaging for an organic tea brand',client:'Food & beverage startup',city:'Lahore',cat:'Design',budget:45000,type:'Fixed price',verified:true,safepay:true,skills:['Brand identity','Packaging','Illustrator'],desc:'Create a logo, colour palette and packaging artwork for three tea blends. Print-ready files for pouches and boxes are required.',ms:[['Logo concepts',20000],['Packaging artwork',25000]]},
    {id:3,title:'React Native app for a pharmacy delivery service',client:'Healthcare startup',city:'Islamabad',cat:'Development',budget:180000,type:'Fixed price',verified:true,safepay:true,skills:['React Native','Firebase','Maps API'],desc:'Build an Android and iOS app for ordering medicines, uploading prescriptions and tracking deliveries in real time.',ms:[['UX flows & prototype',40000],['Ordering & prescriptions',60000],['Rider tracking & payments',50000],['Store release',30000]]},
    {id:4,title:'Bilingual social media content — 1 month',client:'Real estate agency',city:'Multan',cat:'Marketing',budget:30000,type:'Monthly',verified:false,safepay:true,skills:['Content calendar','Urdu copy','Canva'],desc:'Plan and design 20 English/Urdu posts and 8 reels for Facebook and Instagram, including captions and a posting calendar.',ms:[['Month 1 calendar & posts',30000]]},
    {id:5,title:'60-second product explainer video',client:'Fintech company',city:'Karachi',cat:'Video',budget:55000,type:'Fixed price',verified:true,safepay:false,skills:['Motion graphics','Voice-over','After Effects'],desc:'Script, storyboard and animate a 60-second explainer for a mobile wallet app, with English and Urdu voice-over versions.',ms:[['Script & storyboard',20000],['Animation & voice-over',35000]]},
    {id:6,title:'8 SEO blog articles for an edtech platform',client:'Edtech startup',city:'Remote',cat:'Writing',budget:24000,type:'Fixed price',verified:false,safepay:false,skills:['SEO writing','Research','WordPress'],desc:'Write eight 1,200-word articles on university admissions in Pakistan, optimised for search and published to WordPress.',ms:[['Articles 1–4',12000],['Articles 5–8',12000]]},
    {id:7,title:'Google Ads campaign setup & 4 weeks management',client:'Home appliances retailer',city:'Faisalabad',cat:'Marketing',budget:60000,type:'Fixed price',verified:true,safepay:true,skills:['Google Ads','Conversion tracking','GA4'],desc:'Set up search and shopping campaigns with conversion tracking, then manage and report on them weekly for four weeks.',ms:[['Account & tracking setup',25000],['4 weeks optimisation',35000]]}
  ];

  var TALENT = [
    {id:'areeba',name:'Areeba Khan',init:'AK',role:'Visual Identity Designer',city:'Lahore',cat:'Design',rate:3500,avail:'Available now',skills:['Brand identity','Packaging','Illustrator'],stats:[98,94,71],bio:'Designs brand identities and packaging for food, fashion and retail brands, from first concepts to print-ready files.'},
    {id:'bilal',name:'Bilal Mahmood',init:'BM',role:'Senior Full-stack Engineer',city:'Lahore',cat:'Development',rate:6500,avail:'Dedicated',skills:['React','Next.js','Node.js'],stats:[96,92,64],bio:'Builds SaaS dashboards and APIs for UK and Gulf teams, with 4+ hours of daily working overlap.'},
    {id:'hira',name:'Hira Aslam',init:'HA',role:'Product Designer (UI/UX)',city:'Islamabad',cat:'Design',rate:4000,avail:'Available now',skills:['Figma','Design systems','User research'],stats:[97,95,58],bio:'Designs web and mobile products end to end, from user interviews to tested, developer-ready design systems.'},
    {id:'hamza',name:'Hamza Qureshi',init:'HQ',role:'Performance Marketer',city:'Karachi',cat:'Marketing',rate:3000,avail:'Available now',skills:['Meta Ads','Google Ads','GA4'],stats:[95,90,66],bio:'Runs paid campaigns for e-commerce and real estate brands, reporting on cost per lead and return on ad spend.'},
    {id:'maham',name:'Maham Siddiqui',init:'MS',role:'Bilingual Content Writer (EN/UR)',city:'Karachi',cat:'Writing',rate:1800,avail:'Open to opportunities',skills:['SEO writing','Urdu copy','Scripts'],stats:[99,97,74],bio:'Writes search-friendly articles, ad copy and video scripts in English and Urdu.'},
    {id:'usman',name:'Usman Tariq',init:'UT',role:'Video Editor & Motion Designer',city:'Peshawar',cat:'Video',rate:2500,avail:'Busy',skills:['Premiere Pro','After Effects','Reels'],stats:[93,89,52],bio:'Edits product videos, reels and explainers with motion graphics and subtitles.'},
    {id:'zainab',name:'Zainab Ali',init:'ZA',role:'Data Analyst & AI Automation',city:'Islamabad',cat:'AI & Data',rate:4500,avail:'Available now',skills:['Python','Power BI','AI automation'],stats:[97,93,61],bio:'Builds dashboards, data pipelines and AI-powered automations for startups and small businesses.'}
  ];

  var currentJob = null, currentPerson = null;

  /* ---------- API ---------- */
  function api(method, path, body){
    return fetch('/api' + path, {
      method: method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
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
  function fromApiJob(j){
    return {id:j.id, title:j.title, client:j.clientLabel, city:j.city, cat:j.category, budget:j.budget, type:j.type, verified:j.clientVerified,
      safepay:j.safepay, skills:j.skills, desc:j.description, ms:j.milestones.map(function(m){ return [m.title, m.amount]; }), sample:j.isSample};
  }
  function fromApiTalent(t){
    var s = t.stats || {};
    return {id:t.id, name:t.name, init:t.initials, role:t.headline, city:t.city, cat:t.category, rate:t.hourlyRate, avail:t.availability,
      skills:t.skills, stats:[s.completion, s.onTime, s.repeatClients], bio:t.bio, verified:t.verified, sample:t.isSample,
      photo:t.photo || null, rating:t.rating || null};
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
    if (r.indexOf('blog/') === 0){ blogSlug = decodeURIComponent(r.slice(5)); r = PaklanceBlog.has(blogSlug) ? 'article' : 'blog'; }
    else if (r === 'article') r = 'blog';
    if (VIEWS.indexOf(r) < 0) r = 'home';
    if (r === 'job' && !currentJob) r = 'jobs';
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
    if (r === 'job') renderJobDetail();
    if (r === 'person'){ if (own) renderMyProfile(); else renderPerson(); }
    if (r === 'blog') PaklanceBlog.renderIndex(); else if (r === 'article') PaklanceBlog.renderArticle(blogSlug); else PaklanceBlog.leave();
    $('#mobileMenu').hidden = true; $('#burger').setAttribute('aria-expanded','false');
    window.scrollTo(0,0);
    if (r !== 'home'){ var shownView = $('[data-view="' + r + '"]'); enterView(shownView); reveal(shownView); }   // the homepage has its own heading motion
  }
  function go(r){ if (location.hash === '#' + r) route(); else location.hash = r; }
  window.addEventListener('hashchange', route);

  // /pricing, /blog/<slug> … (links from search engines and shares) open the matching hash page.
  function pathToHash(){
    var p = location.pathname.replace(/\/+$/, '');
    if (!p || location.hash) return;
    var m = p.match(/^\/(jobs|talent|how|global|match|trust|pricing|dashboard|blog)(?:\/([^\/]+))?$/);
    if (m) history.replaceState(null, '', '/#' + m[1] + (m[1] === 'blog' && m[2] ? '/' + m[2] : ''));
  }

  /* ---------- jobs ---------- */
  function sampleChip(x, label){ return x.sample === false ? '' : '<span class="chip chip-sample">' + (label || 'Sample') + '</span>'; }
  function tagsHtml(list){ return list.map(function(s){ return '<span class="tag">' + esc(s) + '</span>'; }).join(''); }
  function jobCard(j){
    return '<article class="job-card">' +
      '<div class="job-top"><h3>' + esc(j.title) + '</h3>' + sampleChip(j) + '</div>' +
      '<div class="job-meta"><span>' + esc(j.client) + ' · ' + esc(j.city) + '</span><span>' + esc(j.cat) + '</span>' +
        (j.verified ? '<span class="ok"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified client</span>' : '<span>Client not yet verified</span>') + '</div>' +
      '<p>' + esc(j.desc) + '</p>' +
      '<div class="tags">' + tagsHtml(j.skills) + '</div>' +
      '<div class="job-foot"><div class="budget"><span>Budget</span><strong>' + fmt(j.budget) + '</strong></div>' +
        (j.safepay ? '<span class="chip chip-safe"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-shield"/></svg>SafePay</span>' : '') +
        '<button class="btn btn-outline btn-sm" type="button" data-job="' + j.id + '">View job</button></div>' +
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
    // The "These are sample listings" notice only makes sense while every job is a sample.
    var notice = $('[data-view="jobs"] .notice'); if (notice) notice.hidden = JOBS.some(function(j){ return j.sample === false; });
    var n = list.length, allSample = list.every(function(j){ return j.sample !== false; });
    $('#jobCount').textContent = n ? (n + (allSample ? ' sample job' : ' job') + (n === 1 ? '' : 's')) : 'No matching jobs';
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
    $('#jobDetail').innerHTML =
      '<article class="card">' +
        '<div class="job-top"><div><span class="eyebrow">' + esc(j.cat) + '</span><h2 style="margin-top:6px">' + esc(j.title) + '</h2></div>' + sampleChip(j) + '</div>' +
        '<div class="job-meta" style="margin-top:10px"><span>' + esc(j.client) + ' · ' + esc(j.city) + '</span>' + (j.verified ? '<span class="ok"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified client</span>' : '<span>Client not yet verified</span>') + '</div>' +
        '<p>' + esc(j.desc) + '</p>' +
        '<h4>Skills</h4><div class="tags">' + tagsHtml(j.skills) + '</div>' +
        '<h4>Milestones</h4><ol class="milestones" style="margin-top:0">' + j.ms.map(function(m, i){
          return '<li class="ms"><span class="ms-no">' + (i + 1) + '</span><div><strong>' + esc(m[0]) + '</strong><span class="ms-sub">' + fmt(m[1]) + '</span></div>' +
            (j.safepay ? '<span class="chip chip-safe">SafePay</span>' : '<span class="chip chip-muted">Direct</span>') + '</li>';
        }).join('') + '</ol>' +
      '</article>' +
      '<aside class="side"><div class="card">' +
        '<div class="kv"><span>Budget</span><strong>' + fmt(j.budget) + '</strong></div>' +
        '<div class="kv"><span>Type</span><strong>' + esc(j.type) + '</strong></div>' +
        '<div class="kv"><span>Milestones</span><strong>' + j.ms.length + '</strong></div>' +
        '<div class="kv"><span>Payment</span><strong>' + (j.safepay ? 'SafePay protected' : 'Agreed directly') + '</strong></div>' +
        (real ? '<button class="btn btn-primary btn-block" type="button" data-apply="' + j.id + '">Apply for this job</button>'
              : '<button class="btn btn-primary btn-block" type="button" data-open="auth" data-signup data-as="freelancer">Apply for this job</button>') +
        '<p class="help" style="margin-top:12px">' + (real ? 'Your name and skills are shared with the client when you apply.' : 'Sample listing. Applications open when live jobs are posted.') + '</p>' +
      '</div></aside>';
  }
  function applyToJob(id){
    if (!PaklanceAuth.getUser()){ PaklanceAuth.open('signup'); toast('Create an account or log in to apply.'); return; }
    api('POST', '/jobs/' + id + '/proposals', {}).then(function(){
      toast('Application sent. The client can now see your name and skills.');
    }).catch(handleError);
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
    var notice = $('[data-view="talent"] .notice'); if (notice) notice.hidden = TALENT.some(function(t){ return t.sample === false; });
    var list = TALENT.filter(function(t){
      var hay = (t.name + ' ' + t.role + ' ' + t.city + ' ' + t.cat + ' ' + t.skills.join(' ')).toLowerCase();
      return (!q || hay.indexOf(q) > -1) && (av === 'any' || t.avail === 'Available now') && (!rate || t.rate <= rate);
    });
    $('#talentGrid').innerHTML = list.length ? list.map(function(t, i){
      return '<article class="t-card">' +
        '<div class="t-head">' + talentAvatar(t) + '<div><strong>' + esc(t.name) + '</strong><span>' + esc(t.role) + ' · ' + esc(t.city) + '</span>' + ratingSpan(t) + '</div>' + sampleChip(t) + '</div>' +
        '<div class="chip-row">' + (t.verified === false ? '' : verifiedChip) + '<span class="chip chip-muted">' + esc(t.avail) + '</span></div>' +
        statsHtml(t.stats, i === 0) +
        '<div class="tags">' + tagsHtml(t.skills) + '</div>' +
        '<div class="t-foot"><span class="rate">' + fmt(t.rate) + ' <small>/hr</small></span><button class="btn btn-outline btn-sm" type="button" data-person="' + esc(t.id) + '">View profile</button></div>' +
      '</article>';
    }).join('') :
      '<div class="empty" style="grid-column:1/-1"><h3>No specialists match these filters</h3><p>Try another skill or a higher rate, or let Paklance Match™ build a shortlist for you.</p><div class="hero-ctas"><a class="btn btn-primary btn-sm" href="#match">Get matched</a></div></div>';
    syncTalentCats();
  }
  /* ---------- sample profile details for the profile page (SAMPLE DATA: services, history, ratings, stats) ---------- */
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
      rating: { freelancer: x.dist, client: x.cdist }, reviews: x.reviews || [], seller: x.seller, buyer: x.buyer, delivery: t.stats };
  }
  function setBack(href, label){ var a = $('[data-view="person"] .back'); if (a){ a.setAttribute('href', href); a.textContent = '← ' + label; } }
  function renderPerson(){
    var t = currentPerson; if (!t) return;
    setBack('#talent', 'Back to talent');
    var el = $('#personDetail');
    if (t.sample === false && LIVE){
      el.innerHTML = '<div class="card pp-loading" aria-busy="true">Loading profile…</div>';
      api('GET', '/talent/' + encodeURIComponent(t.id)).then(function(r){
        if (currentPerson === t) PaklanceProfile.renderPage(el, apiPersonModel(r.talent, r.page));
      }).catch(function(err){
        if (currentPerson === t) el.innerHTML = '<div class="card"><p>' + esc(err.message || 'We couldn’t load this profile. Please try again.') + '</p></div>';
      });
      return;
    }
    PaklanceProfile.renderPage(el, personModel(t));
  }
  // A real specialist's profile page from GET /api/talent/:id (same model as the sample profiles).
  function apiPersonModel(t, p){
    p = p || {};
    return { name: t.name, initials: t.initials, photo: p.photo || t.photo || null, headline: t.headline, city: t.city, rate: t.hourlyRate,
      availability: t.availability, bio: t.bio, skills: t.skills, verified: !!t.verified, sample: false, memberSince: p.memberSince,
      video: PaklanceVideo.fromSaved(p.video), items: p.items || [], rating: p.rating, reviews: p.reviews || [],
      seller: p.seller || {}, buyer: p.buyer || {}, delivery: p.delivery || null };
  }
  function renderMyProfile(){
    setBack('#dashboard', 'Back to dashboard');
    PaklanceProfile.mountPage($('#personDetail'));
  }

  /* ---------- modals ---------- */
  function closeModals(){
    $$('.modal').forEach(function(m){ m.hidden = true; });
    document.body.style.overflow = '';
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

  function onModalOpen(id){
    if (!LIVE) return;
    if (id === 'contract') loadContract();
    else if (id === 'notif') loadNotifs();
    else if (id === 'escrow') prepareEscrow();
    else if (id === 'dispute') prepareDispute();
    else if (id === 'withdraw') prepareWithdraw();
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

  function contractHtml(c){
    var ck = '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-check"/></svg>';
    var other = c.role === 'client' ? c.freelancer : c.client;
    var actions = '<button class="btn btn-outline" type="button" data-open="dispute">Open a case</button>';
    var fund = c.role === 'client' && fundTarget(c), sub = firstMs(c, ['submitted']), work = firstMs(c, ['funded', 'changes_requested']);
    if (c.status === 'active'){
      if (c.role === 'client' && sub) actions += '<button class="btn btn-primary" type="button" data-approve="' + sub.id + '">Approve milestone ' + sub.position + '</button>';
      else if (fund) actions += '<button class="btn btn-primary" type="button" data-open="escrow">Fund milestone ' + fund.position + '</button>';
      else if (c.role === 'freelancer' && work) actions += '<button class="btn btn-primary" type="button" data-submit-ms="' + work.id + '">Submit milestone ' + work.position + '</button>';
    }
    return '<button class="m-close" type="button" data-close aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>' +
      '<div class="cc-top" style="padding-right:44px"><span class="eyebrow">Contract #' + esc(c.code) + '</span>' + (c.isSample ? '<span class="chip chip-sample">Sample</span>' : '') + '</div>' +
      '<h2 id="contractTitle">' + esc(c.title) + '</h2>' +
      '<div class="cc-parties">' + esc(c.client.name) + ' × ' + esc(c.freelancer.name) + (other.verified ? ' <span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Verified</span>' : '') + '</div>' +
      '<div class="stat-row three">' +
        '<div class="stat"><span>Contract value</span><strong>' + fmt(c.totals.value) + '</strong></div>' +
        '<div class="stat"><span>Released</span><strong>' + fmt(c.totals.released) + '</strong></div>' +
        '<div class="stat"><span>Protected</span><strong>' + fmt(c.totals.protected) + '</strong></div>' +
      '</div>' +
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
    var sc = e.target.closest('[data-show-contract]');
    if (sc){
      var id = +sc.getAttribute('data-show-contract');
      CONTRACT = CONTRACTS.filter(function(x){ return x.id === id; })[0] || CONTRACT;
      $('#m-contract .modal-card').innerHTML = contractHtml(CONTRACT);
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
  function loadContract(){
    var card = keep('contract', $('#m-contract .modal-card'));
    if (!signedIn()){ CONTRACT = null; card.innerHTML = SAMPLE.contract; return Promise.resolve(); }
    return api('GET', '/contracts').then(function(r){
      var keepId = CONTRACT && CONTRACT.id, pick = function(f){ return r.contracts.filter(f)[0]; };
      var c = pick(function(x){ return x.id === keepId; }) || pick(function(x){ return x.status === 'active'; }) ||
        pick(function(x){ return x.review && x.review.canReview; }) || r.contracts[0] || null;
      CONTRACT = c;
      CONTRACTS = r.contracts;
      card.innerHTML = c ? contractHtml(c) : SAMPLE.contract;
      var x = card.querySelector('.m-close');
      if (x && !$('#m-contract').hidden) x.focus({preventScroll:true});
    }).catch(noop);
  }
  function milestoneAction(path, okMsg){
    var c = CONTRACT; if (!c) return;
    api('POST', '/contracts/' + c.id + '/milestones/' + path, {}).then(function(){ toast(okMsg); loadContract(); }).catch(handleError);
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
    api('GET', '/wallet').then(function(w){ strong.textContent = fmt(Math.max(0, w.available)); }).catch(noop);
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
    if (!signedIn()){ list.innerHTML = SAMPLE.notifs; note.hidden = false; return; }
    api('GET', '/notifications?limit=20').then(function(r){
      note.hidden = true;
      list.innerHTML = r.notifications.length ? r.notifications.map(function(n){
        return '<div class="notif-item' + (n.read ? ' read' : '') + '"><i></i><div><strong>' + esc(n.title) + '</strong><div class="notif-meta">' + (n.meta ? esc(n.meta) + ' · ' : '') + ago(n.createdAt) + '</div></div></div>';
      }).join('') : '<p class="muted" style="font-size:14px;margin-top:12px">You’re all caught up. Updates about your jobs, contracts and payments will show up here.</p>';
      $('#notifDot').hidden = !r.unread;
    }).catch(noop);
  }
  function refreshDot(){
    if (!signedIn()){ $('#notifDot').hidden = false; return; }
    api('GET', '/notifications?limit=1').then(function(r){ $('#notifDot').hidden = !r.unread; }).catch(noop);
  }

  /* ---------- clicks ---------- */
  document.addEventListener('click', function(e){
    var el = e.target.closest('[data-open],[data-close],[data-job],[data-person],[data-clear-filters],[data-cat],[data-bn],[data-toast],[data-logout],[data-edit-skills],[data-apply],[data-approve],[data-submit-ms]');
    if (!el) return;
    if (el.hasAttribute('data-logout')){ PaklanceAuth.logOut().then(function(){ toast('You’ve logged out.'); go('home'); }); return; }
    if (el.hasAttribute('data-edit-skills')){ PaklanceAuth.editSkills(); return; }
    if (el.getAttribute('data-open') === 'auth'){ authEntry(el.hasAttribute('data-signup')); return; }
    if (el.hasAttribute('data-open')){ openModal(el.getAttribute('data-open')); return; }
    if (el.hasAttribute('data-close')){ closeModals(); return; }
    if (el.hasAttribute('data-apply')){ applyToJob(+el.getAttribute('data-apply')); return; }
    if (el.hasAttribute('data-approve')){
      var ms = CONTRACT && CONTRACT.milestones.filter(function(m){ return String(m.id) === el.getAttribute('data-approve'); })[0];
      if (ms && window.confirm('Approve “' + ms.title + '” and release ' + fmt(ms.amount) + ' to ' + CONTRACT.freelancer.name + '?')) milestoneAction(ms.id + '/approve', 'Milestone approved. Payment released.');
      return;
    }
    if (el.hasAttribute('data-submit-ms')){ milestoneAction(el.getAttribute('data-submit-ms') + '/submit', 'Work submitted. The client has been notified.'); return; }
    if (el.hasAttribute('data-job')){
      var id = +el.getAttribute('data-job');
      currentJob = JOBS.filter(function(j){ return j.id === id; })[0] || null; go('job'); return;
    }
    if (el.hasAttribute('data-person')){
      var pid = el.getAttribute('data-person');
      currentPerson = TALENT.filter(function(t){ return t.id === pid; })[0] || null; go('person'); return;
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
        if (PaklanceAuth.getUser()) toast('Messages are coming soon.');
        else { PaklanceAuth.open('login'); toast('Log in to see your messages.'); }
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
  var FORMS = {
    match: function(){
      return api('POST', '/match-requests', { role:v('mRole'), engagement:v('mEng'), seniority:v('mSen'), timezone:v('mTz'), budgetModel:v('mBud'), skills:v('mSkills') })
        .then(function(r){
          renderShortlist(r.shortlist);
          toast(r.shortlist.length ? 'Shortlist refreshed.' : 'Requirement saved. No close matches yet, so Paklance will curate a shortlist for you.');
          flash([$('#shortlist')]);
        });
    },
    global: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to save your requirement.');
      return api('POST', '/global-requests', { role:v('gRole'), engagement:v('gEng'), timezone:v('gTz'), duration:v('gDur'), startWindow:v('gStart'), skills:v('gSkills'),
        protections:{ nda:$('#gc1').checked, ip:$('#gc2').checked, replacement:$('#gc3').checked } })
        .then(function(){ closeModals(); toast('Requirement saved as a private draft.'); });
    },
    dispute: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to open a case.');
      var c = CONTRACT;
      if (!c){ closeModals(); toast('This is a sample contract, so cases can’t be submitted.'); return Promise.resolve(); }
      var m = firstMs(c, ['funded', 'submitted', 'changes_requested']);
      return api('POST', '/disputes', { contractId:c.id, milestoneId: m ? m.id : undefined, issue:v('dIssue'), description:v('dWhat') })
        .then(function(){ closeModals(); $('#dWhat').value = ''; toast('Case submitted for review. Both sides can now add evidence.'); loadContract(); });
    },
    escrow: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to fund a milestone.');
      var c = CONTRACT, m = c && c.role === 'client' && fundTarget(c);
      if (!m){ closeModals(); toast('This is a sample contract, so checkout is turned off.'); return Promise.resolve(); }
      var method = /raast/i.test(v('eGw')) ? 'raast' : 'bank_transfer';
      return api('POST', '/contracts/' + c.id + '/milestones/' + m.id + '/fund', { method: method }).then(function(r){
        var i = r.instructions;
        $('#m-escrow .alert-info').innerHTML = '<b>Transfer ' + fmt(r.payment.total) + '</b> to ' + esc(i.accountTitle) + (i.bankName ? ' (' + esc(i.bankName) + ')' : '') +
          ', IBAN ' + esc(i.iban) + ', with reference <b>' + esc(i.reference) + '</b>. We’ve emailed you these details. The milestone shows as funded once the transfer is confirmed.';
        toast('Transfer details sent to your email.');
        loadContract();
      });
    },
    payout: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to add a payout method.');
      return api('POST', '/wallet/payout-methods', { channel:v('pCh'), accountTitle:v('pTitle'), accountNumber:v('pNum'), bankName:v('pBank'), isDefault:$('#pDef').checked })
        .then(function(){ closeModals(); toast('Payout method saved.'); });
    },
    withdraw: function(){
      if (!PaklanceAuth.getUser()) return needUser('Log in to withdraw funds.');
      return api('POST', '/wallet/withdrawals', { channel:v('wCh'), accountTitle:v('wTitle'), accountNumber:v('wNum'), amount:v('wAmt') })
        .then(function(r){ closeModals(); $('#wAmt').value = ''; toast('Withdrawal of ' + fmt(r.withdrawal.amount) + ' requested.'); refreshDot(); });
    }
  };
  function renderShortlist(list){
    var box = $('#shortlist .sl'), chip = $('#shortlist .chip-sample');
    box.innerHTML = list.length ? list.map(function(s){
      return '<div class="sl-card"><span class="avatar">' + esc(s.initials) + '</span><div><strong>' + esc(s.name) + '</strong><span class="sub">' + esc(s.headline) + ' · ' + esc(s.city) + '</span>' +
        '<div class="tags">' + tagsHtml(s.tags) + '</div></div><div class="fit"><strong>' + s.fit + '%</strong><span>Fit</span></div></div>';
    }).join('') : '<p class="muted" style="font-size:14px">No close matches yet. Your requirement is saved, and Paklance will curate a shortlist for you.</p>';
    if (chip) chip.hidden = !list.some(function(s){ return s.isSample; });
  }
  document.addEventListener('submit', function(e){
    var f = e.target;
    var k = f.getAttribute('data-form');
    if (!k) return;               // forms without data-form (sign up, blog) handle themselves
    e.preventDefault();
    if (k === 'hero'){ $('#jSearch').value = $('#heroQ').value; renderJobs(); go('jobs'); return; }
    if (!LIVE){
      if (k === 'match'){ toast('Shortlist refreshed. Sample profiles are shown in this preview.'); flash([$('#shortlist')]); return; }
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
    if (signedIn()) api('POST', '/notifications/read-all', {}).catch(noop);
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
    if (u && u.fullName && u.skills.length){ toast('You’re signed in as ' + u.fullName + '.'); go('dashboard'); return; }
    PaklanceAuth.open(signup ? 'signup' : 'login');
  }
  function updateHeader(u){
    document.body.classList.toggle('signed-in', !!u);
    if (u){
      $('#hdrAv').innerHTML = u.photo ? '<img src="' + esc(u.photo) + '" alt="">' : esc(initials(u.fullName || u.email));
      $('#hdrName').textContent = u.fullName ? u.fullName.split(' ')[0] : 'Account';
    }
    if (LIVE) refreshDot();
    var onDash = !$('[data-view="dashboard"]').hidden;
    if (onDash){ if (u) renderDashboard(); else go('home'); }
    if (!u && location.hash === '#profile') go('home');
  }
  function matchJobs(u){
    var groups = PaklanceAuth.skillGroups, cats = {};
    u.skills.forEach(function(s){ Object.keys(groups).forEach(function(g){ if (groups[g].indexOf(s) > -1) cats[g] = 1; }); });
    var words = u.skills.map(function(s){ return s.toLowerCase(); });
    return JOBS.map(function(j){
      var hay = (j.title + ' ' + j.skills.join(' ') + ' ' + j.cat).toLowerCase();
      var score = (cats[j.cat] ? 2 : 0) + words.filter(function(w){ return hay.indexOf(w) > -1; }).length;
      return {j:j, score:score};
    }).filter(function(x){ return x.score > 0; }).sort(function(a,b){ return b.score - a.score; }).map(function(x){ return x.j; }).slice(0, 3);
  }
  function renderDashboard(){
    var u = PaklanceAuth.getUser(); if (!u) return;
    $('#dashHello').textContent = 'Welcome, ' + (u.fullName ? u.fullName.split(' ')[0] : 'there');
    $('#dashProfile').innerHTML =
      '<div class="t-head"><div class="pc-avwrap">' + PaklanceProfile.avatar(u, 'lg') +
        '<button type="button" class="pc-cam sm" data-pc-open="photo" aria-label="' + (u.photo ? 'Change profile photo' : 'Add a profile photo') + '"><svg class="pp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4zM12 16.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z"/></svg></button></div>' +
        '<div><strong>' + esc(u.fullName || 'Your name') + '</strong><span>' + esc(u.email) + '</span>' +
        '<button type="button" class="btn-text pc-photo-link" data-pc-open="photo">' + (u.photo ? 'Change photo' : 'Add a profile photo') + '</button></div></div>' +
      '<div class="chip-row" style="margin-top:14px"><span class="chip chip-verified"><svg class="ic ic-xs" aria-hidden="true"><use href="#i-check"/></svg>Email verified</span><span class="chip chip-muted">' + (u.provider === 'google' ? 'Signed in with Google' : 'Email & password') + '</span></div>' +
      '<h4>Your skills</h4><div class="tags">' + u.skills.map(function(s){ return '<span class="tag">' + esc(s) + '</span>'; }).join('') + '</div>' +
      '<a class="btn btn-primary btn-block" href="#profile" style="margin-top:18px">View my profile</a>' +
      '<button class="btn btn-outline btn-block" type="button" data-edit-skills style="margin-top:10px">Edit skills</button>';
    $('#dashChecklist').innerHTML =
      '<li class="ok">Account created</li><li class="ok">Email verified</li><li class="ok">Full name added</li><li class="ok">Skills added</li>' +
      (u.photo ? '<li class="ok">Profile photo added</li>' : '<li>Add a profile photo <button type="button" class="chip chip-muted pc-chip-btn" data-pc-open="photo">Add photo</button></li>') +
      '<li id="dashProfileStep">Complete your profile <span class="chip chip-muted">Next</span></li>';
    PaklanceProfile.mount($('#dashTracker'), { video: $('#dashVideo') });
    var matches = matchJobs(u), shown = matches.length ? matches : JOBS.slice(0, 3);
    $('#dashJobsNote').textContent = matches.length ? 'Based on the skills you picked.' : 'No close matches yet, so here are the newest jobs.';
    $('#dashJobs').innerHTML = shown.map(jobCard).join('');
    var chip = $('[data-view="dashboard"] .cc-top .chip-sample');
    if (chip) chip.hidden = !shown.some(function(j){ return j.sample !== false; });
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
      api('GET', '/jobs?limit=100').then(function(r){ replace(JOBS, r.jobs.map(fromApiJob)); }).catch(noop),
      api('GET', '/talent?limit=100').then(function(r){ replace(TALENT, r.talent.map(fromApiTalent)); }).catch(noop),
      api('GET', '/blog/articles?full=1&limit=200').then(function(r){ PaklanceBlog.setArticles(r.articles); }).catch(noop)
    ]);
  }
  function loadGoogle(){
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
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
  renderJobs(); renderTalent();
  api('GET', '/config').then(function(c){ CFG = c; }).catch(noop).then(function(){
    if (CFG.googleClientId) loadGoogle();
    var ready = PaklanceAuth.init({
      mock: false,
      apiBase: '/api',
      googleClientId: CFG.googleClientId || '',
      notify: toast,
      onFinish: function(){ go('dashboard'); }
    });
    PaklanceAuth.onChange(updateHeader);
    return Promise.all([ready, loadData()]);
  }).then(function(){
    renderJobs(); renderTalent(); route();
  });
})();
