const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = path.resolve('C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708');
const SITE_URL = 'https://www.paklance.com';

async function run() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && p.url.includes('paklance.com')) || pages[0];
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

  // Login as admin
  const loginRes = await fetch('https://paklance-backend-updated.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paklance.com', password: 'PaklanceAdmin2026!' })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.accessToken;
  const adminUser = loginData.user;

  // Set device metrics override to 390px
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
      localStorage.setItem('pk_user', JSON.stringify(${JSON.stringify(adminUser)}));
    })()`
  });

  await send('Page.navigate', { url: `${SITE_URL}/#admin` });
  await new Promise(r => setTimeout(r, 4500));

  await send('Runtime.evaluate', {
    expression: `(() => {
      const a = document.querySelector('a[href="#admin"]');
      if (a) a.click();
      window.location.hash = '#admin';
      const sideTab = document.getElementById('adminSideTabBlogs');
      if (sideTab) sideTab.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 2000));

  const state = await send('Runtime.evaluate', {
    expression: `(() => {
      const adminView = document.getElementById('adminView');
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;

      const overflowing = [];
      if (adminView && !adminView.hidden) {
        adminView.querySelectorAll('*').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.right > winW + 1) {
            overflowing.push({
              tag: el.tagName,
              id: el.id,
              className: typeof el.className === 'string' ? el.className : '',
              width: Math.round(rect.width),
              right: Math.round(rect.right),
              diff: Math.round(rect.right - winW)
            });
          }
        });
      }

      const activeView = Array.from(document.querySelectorAll('.view')).find(v => !v.hidden)?.getAttribute('data-view');
      return {
        windowWidth: winW,
        docScrollWidth: docW,
        bodyScrollWidth: bodyW,
        hasHorizontalOverflow: docW > winW || bodyW > winW,
        hash: window.location.hash,
        activeView: activeView,
        adminHidden: adminView ? adminView.hidden : true,
        user: window.PaklanceAuth?.getUser(),
        overflowingElementsCount: overflowing.length,
        overflowingElements: overflowing.sort((a,b) => b.diff - a.diff).slice(0, 20)
      };
    })()`,
    returnByValue: true
  });

  console.log('Mobile Admin 390px State & Overflow:', JSON.stringify(state.result.value, null, 2));

  // Screenshot of mobile admin view
  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_admin_real_390.png'), Buffer.from(snap.data, 'base64'));
  console.log('Saved mobile_admin_real_390.png');

  // Open blog modal
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('adminHdrAddBlogBtn') || document.getElementById('adminSideBtnAddBlog');
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1500));

  const modalSnap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_admin_editor_modal_real_390.png'), Buffer.from(modalSnap.data, 'base64'));
  console.log('Saved mobile_admin_editor_modal_real_390.png');

  ws.close();
}

run().catch(console.error);
