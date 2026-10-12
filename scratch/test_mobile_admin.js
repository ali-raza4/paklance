const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = path.resolve('C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708');

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

  // Emulate mobile device (iPhone 12/13/14: 390x844, dpr: 3, mobile: true)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 2000));

  // Authenticate Admin
  const loginRes = await fetch('https://paklance-backend-updated.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paklance.com', password: 'PaklanceAdmin2026!' })
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.accessToken;
  const adminUser = loginData.user;

  await send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('pk_access_token', ${JSON.stringify(adminToken)});
      localStorage.setItem('pk_user', ${JSON.stringify(JSON.stringify(adminUser))});
      if (window.PaklanceAuth && typeof window.PaklanceAuth.init === 'function') {
        window.PaklanceAuth.init();
      }
      window.location.hash = '#admin';
      if (typeof route === 'function') route();
      if (typeof loadAdminDashboardData === 'function') loadAdminDashboardData(true);
    })()`
  });

  await new Promise(r => setTimeout(r, 3000));

  // Check scroll width and find overflowing elements
  const overflowCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const overflowing = [];
      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > winW + 1) {
          overflowing.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            width: rect.width,
            right: rect.right,
            diff: rect.right - winW
          });
        }
      });
      return {
        docScrollWidth: docW,
        windowInnerWidth: winW,
        hasHorizontalOverflow: docW > winW,
        overflowCount: overflowing.length,
        topOverflowing: overflowing.sort((a,b) => b.diff - a.diff).slice(0, 15)
      };
    })()`,
    returnByValue: true
  });

  console.log('Mobile 390px Overflow Check:', JSON.stringify(overflowCheck.result.value, null, 2));

  // Capture screenshot of mobile admin dashboard
  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_admin_initial.png'), Buffer.from(snap.data, 'base64'));
  console.log('Saved mobile_admin_initial.png');

  // Also open Blog Editor modal to see its mobile layout
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('adminHdrAddBlogBtn') || document.getElementById('adminSideBtnAddBlog');
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1500));

  const modalOverflowCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const m = document.getElementById('m-admin-blog-editor');
      const box = m ? m.querySelector('.modal-box') : null;
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const boxRect = box ? box.getBoundingClientRect() : null;
      return {
        modalVisible: m && !m.hidden,
        boxRect: boxRect ? { width: boxRect.width, height: boxRect.height, top: boxRect.top, left: boxRect.left, right: boxRect.right, bottom: boxRect.bottom } : null,
        windowWidth: winW,
        windowHeight: winH,
        overflowsX: boxRect ? boxRect.right > winW : false,
        overflowsY: boxRect ? boxRect.bottom > winH : false
      };
    })()`,
    returnByValue: true
  });

  console.log('Modal Mobile Check:', JSON.stringify(modalOverflowCheck.result.value, null, 2));

  const modalSnap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_admin_editor_modal_initial.png'), Buffer.from(modalSnap.data, 'base64'));
  console.log('Saved mobile_admin_editor_modal_initial.png');

  ws.close();
}

run().catch(console.error);
