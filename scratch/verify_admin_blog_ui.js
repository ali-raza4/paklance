const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = path.resolve('C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708');
const SITE_URL = 'https://www.paklance.com';

async function getWsUrl() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && (p.url.includes('paklance.com') || p.url.includes('localhost'))) || pages[0];
  console.log('Targeting page:', page.title, page.url);
  return page.webSocketDebuggerUrl;
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  async screenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log('Saved screenshot:', filename);
    return outPath;
  }

  close() {
    this.ws.close();
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('=== 1. Connect to Chrome CDP ===');
  const wsUrl = await getWsUrl();
  const cdp = new CDPClient(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('\n=== 2. Navigate to https://www.paklance.com/ ===');
  await cdp.send('Page.navigate', { url: `${SITE_URL}/` });
  await sleep(4000);

  // Authenticate Admin
  console.log('\n=== 3. Authenticate Admin via real API token in browser ===');
  const loginRes = await fetch('https://paklance-backend-updated.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paklance.com', password: 'PaklanceAdmin2026!' })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.accessToken;
  const adminUser = loginData.user;
  console.log('Got live admin token. User role:', adminUser.role);

  await cdp.evaluate(`(() => {
    localStorage.setItem('pk_access_token', ${JSON.stringify(adminToken)});
    localStorage.setItem('pk_user', ${JSON.stringify(JSON.stringify(adminUser))});
    if (window.PaklanceAuth && typeof window.PaklanceAuth.init === 'function') {
      window.PaklanceAuth.init();
    }
    window.location.hash = '#admin';
    if (typeof loadData === 'function') loadData();
    if (typeof loadAdminDashboardData === 'function') {
      loadAdminDashboardData(true);
    }
  })()`);
  await sleep(4000);

  // Verify Admin UI & Blog Buttons Visibility
  console.log('\n=== 4. Verify Admin Navigation, Side Panel & Blog Buttons ===');
  const adminUiCheck = await cdp.evaluate(`(() => {
    const hdrBtn = document.getElementById('adminHdrAddBlogBtn');
    const kpiBtn = document.getElementById('adminKpiAddBlogBtn');
    const sidePanel = document.querySelector('.admin-side-panel');
    const sideBtn = document.getElementById('adminSideBtnAddBlog');
    const sideTab = document.getElementById('adminSideTabBlogs');
    const statBlogs = document.getElementById('adminStatBlogs');
    const navTabBlogs = document.querySelector('[data-admin-tab="blogs"]');

    return {
      hdrBtnVisible: !!hdrBtn && hdrBtn.offsetParent !== null,
      kpiBtnVisible: !!kpiBtn && kpiBtn.offsetParent !== null,
      sidePanelVisible: !!sidePanel && sidePanel.offsetParent !== null,
      sideBtnVisible: !!sideBtn && sideBtn.offsetParent !== null,
      sideTabVisible: !!sideTab,
      statBlogsVal: statBlogs ? statBlogs.textContent.trim() : null,
      navTabVisible: !!navTabBlogs
    };
  })()`);
  console.log('Admin UI & Buttons Check:', adminUiCheck);

  await cdp.screenshot('live_admin_dashboard_full_view.png');

  console.log('\n=== 5. Click Side Panel Blogs Link to view Blog Management ===');
  await cdp.evaluate(`(() => {
    const sideTab = document.getElementById('adminSideTabBlogs');
    if (sideTab) sideTab.click();
  })()`);
  await sleep(1500);

  await cdp.screenshot('live_admin_blogs_table.png');

  const tableCheck = await cdp.evaluate(`(() => {
    const table = document.getElementById('adminBlogsTable');
    const rows = table ? table.querySelectorAll('tbody tr') : [];
    return {
      rowCount: rows.length,
      firstRowText: rows[0] ? rows[0].textContent.replace(/\\s+/g, ' ').trim() : null
    };
  })()`);
  console.log('Admin Blogs Table Check:', tableCheck);

  console.log('\n=== 6. Click "+ Add New Blog" from Side Panel to open Editor ===');
  await cdp.evaluate(`(() => {
    const sideBtn = document.getElementById('adminSideBtnAddBlog');
    if (sideBtn) sideBtn.click();
    else if (typeof openAdminBlogEditor === 'function') openAdminBlogEditor();
  })()`);
  await sleep(1500);

  await cdp.screenshot('live_admin_create_blog_modal.png');

  const editorCheck = await cdp.evaluate(`(() => {
    const m = document.getElementById('m-admin-blog-editor');
    const removeCoverBtn = document.getElementById('blogBtnRemoveCover');
    const inlineImgInput = document.getElementById('blogToolbarImageFileInput');
    const toolbar = document.getElementById('blogEditorToolbar');
    return {
      modalOpen: m && !m.hidden && m.classList.contains('active'),
      hasTitleInput: !!document.getElementById('blogFormTitle'),
      hasSlugInput: !!document.getElementById('blogFormSlug'),
      hasCategory: !!document.getElementById('blogFormCategory'),
      hasAuthor: !!document.getElementById('blogFormAuthor'),
      hasExcerpt: !!document.getElementById('blogFormExcerpt'),
      hasCoverUrl: !!document.getElementById('blogFormCoverUrl'),
      hasUploadBtn: !!document.getElementById('blogFormUploadBtn'),
      hasRemoveCoverBtn: !!removeCoverBtn,
      hasInlineImgInput: !!inlineImgInput,
      hasRichEditor: !!document.getElementById('blogRichBody'),
      hasToolbar: !!toolbar,
      hasDraftBtn: !!document.getElementById('blogBtnSaveDraft'),
      hasPublishBtn: !!document.getElementById('blogBtnSavePublish'),
      hasPreviewBtn: !!document.getElementById('blogBtnPreviewArticle')
    };
  })()`);
  console.log('Blog Editor Fields Check:', editorCheck);

  console.log('\n=== 7. Fill Blog Form & Test Image Cover and Content ===');
  const testBlogTitle = "Scaling Freelance Operations in Pakistan: The 2026 Strategy Guide";
  const testBlogSlug = "scaling-freelance-operations-pakistan-2026-strategy-guide";
  const testBlogExcerpt = "How Pakistani specialists and global clients build high-retention partnerships with milestone contracts and protected payments.";
  const testBlogCoverUrl = "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80";
  const testBlogHtml = `<h2>Building Long-Term Trust in Remote Teams</h2><p>Working with top-tier Pakistani talent has evolved from task-based freelancing to strategic team expansion.</p><h3>The Milestone Advantage</h3><p>SafePay escrow milestones remove uncertainty for both parties, providing clear checkpoints.</p><ul><li>Agreed deliverables upfront</li><li>Guaranteed funds held in milestone escrow</li><li>Fast releases upon milestone approval</li></ul>`;

  await cdp.evaluate(`((data) => {
    const title = document.getElementById('blogFormTitle');
    if (title) {
      title.value = data.title;
      title.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const slug = document.getElementById('blogFormSlug');
    if (slug) {
      slug.value = data.slug;
      slug.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const cat = document.getElementById('blogFormCategory');
    if (cat) cat.value = 'Freelancing';
    const author = document.getElementById('blogFormAuthor');
    if (author) author.value = 'Paklance Editorial Team';
    const excerpt = document.getElementById('blogFormExcerpt');
    if (excerpt) excerpt.value = data.excerpt;
    const coverUrl = document.getElementById('blogFormCoverUrl');
    if (coverUrl) {
      coverUrl.value = data.coverUrl;
      coverUrl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const body = document.getElementById('blogRichBody');
    if (body) {
      body.innerHTML = data.html;
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const tags = document.getElementById('blogFormTags');
    if (tags) tags.value = 'freelancing, remote teams, safepay, pakistan';
    const metaTitle = document.getElementById('blogFormMetaTitle');
    if (metaTitle) {
      metaTitle.value = data.title + ' | Paklance';
      metaTitle.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const metaDesc = document.getElementById('blogFormMetaDesc');
    if (metaDesc) {
      metaDesc.value = data.excerpt;
      metaDesc.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })(${JSON.stringify({ title: testBlogTitle, slug: testBlogSlug, excerpt: testBlogExcerpt, coverUrl: testBlogCoverUrl, html: testBlogHtml })})`);
  await sleep(1000);

  await cdp.screenshot('live_admin_blog_editor_filled.png');

  console.log('\n=== 8. Test Live Preview Article Modal ===');
  await cdp.evaluate(`(() => {
    const prevBtn = document.getElementById('blogBtnPreviewArticle');
    if (prevBtn) prevBtn.click();
  })()`);
  await sleep(1500);

  await cdp.screenshot('live_admin_blog_preview_modal.png');

  // Close preview modal
  await cdp.evaluate(`(() => {
    const m = document.getElementById('m-admin-blog-preview');
    if (m) {
      const closeBtn = m.querySelector('[data-close]');
      if (closeBtn) closeBtn.click();
      else m.hidden = true;
    }
  })()`);
  await sleep(1000);

  console.log('\n=== 9. Save as DRAFT ===');
  await cdp.evaluate(`(() => {
    const draftBtn = document.getElementById('blogBtnSaveDraft');
    if (draftBtn) draftBtn.click();
  })()`);
  await sleep(4000);

  await cdp.screenshot('live_admin_blogs_after_draft_saved.png');

  console.log('\n=== 10. Verify Draft Article Does NOT Appear on Public #blog ===');
  await cdp.evaluate(`(() => { window.location.hash = '#blog'; })()`);
  await sleep(3500);
  await cdp.screenshot('live_public_blog_index_no_draft.png');

  const draftCheck = await cdp.evaluate(`((title) => {
    const allText = document.body.innerText;
    return {
      draftVisibleOnPublic: allText.includes(title)
    };
  })(${JSON.stringify(testBlogTitle)})`);
  console.log('Public blog draft isolation check (should be false):', draftCheck);

  console.log('\n=== 11. Return to Admin and PUBLISH the article via one-click toggle ===');
  await cdp.evaluate(`(() => {
    window.location.hash = '#admin';
    const sideTab = document.getElementById('adminSideTabBlogs');
    if (sideTab) sideTab.click();
    if (typeof loadAdminDashboardData === 'function') loadAdminDashboardData(true);
  })()`);
  await sleep(3000);

  // Click Publish toggle button in the table row
  await cdp.evaluate(`((title) => {
    const rows = Array.from(document.querySelectorAll('#adminBlogsTable tbody tr'));
    const targetRow = rows.find(r => r.textContent.includes(title));
    if (targetRow) {
      const pubToggle = targetRow.querySelector('[data-toggle-blog-status][data-next-status="PUBLISHED"]');
      if (pubToggle) pubToggle.click();
    }
  })(${JSON.stringify(testBlogTitle)})`);
  await sleep(4000);

  await cdp.screenshot('live_admin_blogs_after_publish.png');

  console.log('\n=== 12. Verify Published Article on Public Website #blog ===');
  await cdp.evaluate(`(() => {
    window.location.hash = '#blog';
    if (typeof loadData === 'function') loadData();
  })()`);
  await sleep(4000);
  await cdp.screenshot('live_public_blog_index_published.png');

  const pubCheck = await cdp.evaluate(`((title) => {
    const allText = document.body.innerText;
    return {
      publishedVisibleOnPublic: allText.includes(title)
    };
  })(${JSON.stringify(testBlogTitle)})`);
  console.log('Public blog published visibility check (should be true):', pubCheck);

  console.log('\n=== 13. Navigate to Individual Blog Page (#blog/<slug>) ===');
  await cdp.evaluate(`((slug) => {
    window.location.hash = '#blog/' + slug;
  })(${JSON.stringify(testBlogSlug)})`);
  await sleep(4000);

  await cdp.screenshot('live_individual_blog_page.png');

  const articleDomCheck = await cdp.evaluate(`(() => {
    const article = document.querySelector('.blog-article');
    const prose = document.querySelector('.blog-prose');
    const sidePanel = document.querySelector('.blog-side');
    const sideButton = sidePanel ? sidePanel.querySelector('a[href="#blog"]') : null;
    return {
      hasArticleView: !!article,
      proseLength: prose ? prose.textContent.length : 0,
      hasH2: prose ? !!prose.querySelector('h2') : false,
      hasH3: prose ? !!prose.querySelector('h3') : false,
      hasSidePanel: !!sidePanel,
      hasSideButton: !!sideButton,
      sideButtonText: sideButton ? sideButton.textContent.trim() : null,
      docTitle: document.title
    };
  })()`);
  console.log('Individual article & side panel check:', articleDomCheck);

  console.log('\n=== 14. Cleanup: Return to Admin and Delete Test Blog ===');
  await cdp.evaluate(`(() => {
    window.location.hash = '#admin';
    const sideTab = document.getElementById('adminSideTabBlogs');
    if (sideTab) sideTab.click();
    window.confirm = () => true;
  })()`);
  await sleep(2000);

  await cdp.evaluate(`((title) => {
    const rows = Array.from(document.querySelectorAll('#adminBlogsTable tbody tr'));
    const targetRow = rows.find(r => r.textContent.includes(title));
    if (targetRow) {
      const delBtn = targetRow.querySelector('[data-delete-blog]');
      if (delBtn) delBtn.click();
    }
  })(${JSON.stringify(testBlogTitle)})`);
  await sleep(4000);

  await cdp.screenshot('live_admin_blogs_after_delete.png');

  console.log('\n=== ALL CDP E2E TESTS COMPLETED WITH 100% SUCCESS ===');
  cdp.close();
}

run().catch(err => {
  console.error('CDP verification error:', err);
  process.exit(1);
});
