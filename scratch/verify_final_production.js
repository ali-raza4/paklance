const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\syeda\\.gemini\\antigravity-ide\\brain\\1ca12b3e-4c3c-404d-b673-b3fc48fc9708';

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && p.url.includes('paklance.com')) || pages[0];
  console.log('Connecting to Chrome CDP:', page.title, page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });

  let id = 1;
  const send = (m, p) => new Promise(r => {
    const i = id++;
    const h = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === i) {
        ws.removeEventListener('message', h);
        r(msg.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.clearBrowserCache');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  async function takeScreenshot(filename) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(shot.data, 'base64'));
    console.log(`[Screenshot] Saved: ${filename}`);
  }

  // STEP 0: Authenticate Admin via real API
  console.log('--- STEP 0: Authenticating Admin ---');
  const loginRes = await fetch('https://paklance-backend-updated.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paklance.com', password: 'PaklanceAdmin2026!' })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.accessToken;
  const adminUser = loginData.user;
  console.log('Admin logged in:', adminUser.email, adminUser.role);

  // STEP 1: Mobile 390px Admin Dashboard
  console.log('--- STEP 1: Mobile Admin Dashboard (390px) ---');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  await send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('pk_access_token', ${JSON.stringify(adminToken)});
      localStorage.setItem('pk_user', ${JSON.stringify(JSON.stringify(adminUser))});
      window.location.hash = '#admin';
      if (typeof route === 'function') route();
      if (typeof loadAdminDashboardData === 'function') loadAdminDashboardData(true);
    })()`
  });
  await sleep(3500);

  const dashMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const bodyW = document.body.scrollWidth;
      const kpis = Array.from(document.querySelectorAll('.admin-kpi-card')).map(c => ({
        label: c.querySelector('.admin-kpi-label')?.textContent?.trim(),
        value: c.querySelector('.admin-kpi-val')?.textContent?.trim()
      }));
      return { clientW, docW, bodyW, hasOverflow: docW > clientW, kpisCount: kpis.length };
    })()`,
    returnByValue: true
  });
  console.log('Mobile Dashboard Metrics:', dashMetrics.result.value);
  await takeScreenshot('mobile_admin_dashboard_390px.png');

  // STEP 2: Mobile Sidebar Navigation Toggle
  console.log('--- STEP 2: Mobile Sidebar Navigation Toggle ---');
  const sidebarTest = await send('Runtime.evaluate', {
    expression: `(() => {
      const toggle = document.getElementById('adminSideNavToggle');
      const panel = document.querySelector('.admin-side-panel');
      const initialCollapsed = panel ? panel.classList.contains('collapsed') : null;
      if (toggle) toggle.click();
      const afterClick1 = panel ? panel.classList.contains('collapsed') : null;
      if (toggle) toggle.click();
      const afterClick2 = panel ? panel.classList.contains('collapsed') : null;
      return { hasToggle: !!toggle, initialCollapsed, afterClick1, afterClick2 };
    })()`,
    returnByValue: true
  });
  console.log('Sidebar Toggle Test:', sidebarTest.result.value);

  // STEP 3: Switch to Blogs Tab in Admin Panel
  console.log('--- STEP 3: Switch to Blogs Tab ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const tab = document.querySelector('[data-admin-tab="blogs"]');
      if (tab) tab.click();
    })()`
  });
  await sleep(1500);

  const blogsTabState = await send('Runtime.evaluate', {
    expression: `(() => {
      const rows = Array.from(document.querySelectorAll('#adminBlogsTbody tr')).map(r => ({
        title: r.querySelector('strong')?.textContent?.trim(),
        status: r.querySelector('.status-badge')?.textContent?.trim(),
        slug: r.querySelector('a')?.textContent?.trim()
      }));
      return { count: rows.length, rows };
    })()`,
    returnByValue: true
  });
  console.log('Admin Blogs Tab Articles:', blogsTabState.result.value);
  await takeScreenshot('mobile_admin_blogs_tab_390px.png');

  // STEP 4: Open Blog Editor Modal on Mobile
  console.log('--- STEP 4: Open Blog Editor Modal on Mobile ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const createBtn = document.getElementById('adminBtnCreateBlog');
      if (createBtn) createBtn.click();
    })()`
  });
  await sleep(1500);

  const editorModalMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.getElementById('m-admin-blog-editor');
      const card = modal?.querySelector('.m-card');
      const toolbar = modal?.querySelector('.admin-rich-toolbar');
      return {
        isOpen: !modal?.hidden,
        cardWidth: card?.offsetWidth,
        cardClientHeight: card?.clientHeight,
        cardScrollHeight: card?.scrollHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        toolbarHeight: toolbar?.offsetHeight,
        hasTableBtn: !!document.getElementById('blogToolbarTableBtn'),
        hasQuoteBtn: !!document.getElementById('blogToolbarQuoteBtn'),
        hasTipBtn: !!document.getElementById('blogToolbarTipBtn'),
        hasSubtitleInput: !!document.getElementById('blogFormSubtitle')
      };
    })()`,
    returnByValue: true
  });
  console.log('Editor Modal Metrics at 390px:', editorModalMetrics.result.value);
  await takeScreenshot('mobile_blog_editor_modal_top_390px.png');

  // Scroll down inside modal
  await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('#m-admin-blog-editor .m-card');
      if (card) card.scrollTop = 550;
    })()`
  });
  await sleep(800);
  await takeScreenshot('mobile_blog_editor_modal_scrolled_390px.png');

  // STEP 5: Test Preview Modal on Mobile
  console.log('--- STEP 5: Test Preview Modal ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('blogFormTitle').value = 'How Is Paklance Different?';
      document.getElementById('blogFormSubtitle').value = 'Why Pakistan\\'s trust-first talent marketplace beats traditional global freelancing platforms';
      document.getElementById('blogRichBody').innerHTML = '<p>Direct client collaboration without FX risk.</p><div class=\"blog-table-wrap\"><table class=\"blog-table\"><thead><tr><th>Key Feature</th><th>Paklance</th><th>Legacy Platforms</th></tr></thead><tbody><tr><td>SafePay Escrow</td><td>Direct PKR Escrow</td><td>Foreign currency with 5-10% FX loss</td></tr></tbody></table></div><blockquote class=\"blog-quote\"><p>\"Paklance is engineered for Pakistani specialists.\"</p><cite>Product Team</cite></blockquote>';
      const prevBtn = document.getElementById('blogBtnPreviewArticle');
      if (prevBtn) prevBtn.click();
    })()`
  });
  await sleep(1200);
  await takeScreenshot('mobile_blog_preview_modal_390px.png');

  // Close preview and editor modals
  await send('Runtime.evaluate', {
    expression: `(() => {
      const closePrev = document.querySelector('#m-admin-blog-preview .m-close');
      if (closePrev) closePrev.click();
      const closeEdit = document.querySelector('#m-admin-blog-editor .m-close');
      if (closeEdit) closeEdit.click();
    })()`
  });
  await sleep(1000);

  // STEP 6: Public Blog Listing (#blog)
  console.log('--- STEP 6: Public Blog Listing (#blog) ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#blog';
      if (typeof route === 'function') route();
    })()`
  });
  await sleep(3000);

  const publicListingMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const cards = Array.from(document.querySelectorAll('.blog-card, .blog-mini')).map(c => ({
        title: c.querySelector('h3, strong')?.textContent?.trim(),
        cat: c.querySelector('.blog-cat')?.textContent?.trim(),
        hasImg: !!c.querySelector('img')
      }));
      const howDifferentCard = cards.find(c => c.title && c.title.includes('How Is Paklance Different'));
      return { clientW, docW, totalCards: cards.length, howDifferentCard };
    })()`,
    returnByValue: true
  });
  console.log('Public Blog Listing Check:', publicListingMetrics.result.value);
  await takeScreenshot('mobile_public_blog_listing_390px.png');

  // STEP 7: Full Public Article View (#blog/how-is-paklance-different)
  console.log('--- STEP 7: Full Public Article View (#blog/how-is-paklance-different) ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#blog/how-is-paklance-different';
      if (typeof route === 'function') route();
    })()`
  });
  await sleep(3500);

  const articleFullMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const headerTitle = document.querySelector('.blog-art-head h1')?.textContent?.trim();
      const headerSubtitle = document.querySelector('.blog-art-head .blog-lead')?.textContent?.trim();
      const coverImg = document.querySelector('.blog-art-cover img')?.src;
      const hasTable = !!document.querySelector('.blog-table');
      const hasQuote = !!document.querySelector('.blog-quote');
      const hasTip = !!document.querySelector('.blog-tip');
      return {
        clientW,
        docW,
        hasHorizontalOverflow: docW > clientW,
        headerTitle,
        headerSubtitle,
        hasCoverImg: !!coverImg,
        hasTable,
        hasQuote,
        hasTip
      };
    })()`,
    returnByValue: true
  });
  console.log('Full Article Metrics:', articleFullMetrics.result.value);
  await takeScreenshot('mobile_full_article_top_390px.png');

  // Scroll down to comparison table & tip
  await send('Runtime.evaluate', {
    expression: `(() => {
      const tbl = document.querySelector('.blog-table-wrap');
      if (tbl) tbl.scrollIntoView({ block: 'center' });
    })()`
  });
  await sleep(800);
  await takeScreenshot('mobile_full_article_table_390px.png');

  // STEP 8: Desktop 1280px Viewport Verification
  console.log('--- STEP 8: Desktop 1280px Viewport Verification ---');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });

  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#admin';
      if (typeof route === 'function') route();
      if (typeof loadAdminDashboardData === 'function') loadAdminDashboardData(true);
    })()`
  });
  await sleep(3000);

  const desktopMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const sidebar = document.querySelector('.admin-side-panel');
      const content = document.querySelector('.admin-main-content');
      const toggle = document.getElementById('adminSideNavToggle');
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      return {
        clientW,
        docW,
        sidebarWidth: sidebar?.offsetWidth,
        contentWidth: content?.offsetWidth,
        isToggleHidden: toggle ? window.getComputedStyle(toggle).display === 'none' : true
      };
    })()`,
    returnByValue: true
  });
  console.log('Desktop 1280px Metrics:', desktopMetrics.result.value);
  await takeScreenshot('desktop_admin_dashboard_1280px.png');

  ws.close();
  console.log('==================================================');
  console.log('ALL VERIFICATION STEPS COMPLETED SUCCESSFULLY');
  console.log('==================================================');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
