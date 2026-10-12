const fs = require('fs');
const path = require('path');

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

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  const debug = await send('Runtime.evaluate', {
    expression: `(() => {
      const u = window.PaklanceAuth?.getUser();
      const tok = localStorage.getItem('pk_access_token');
      const hash = window.location.hash;
      const views = Array.from(document.querySelectorAll('.view')).map(v => ({ id: v.id, view: v.getAttribute('data-view'), hidden: v.hidden }));
      
      // Let's manually show adminView and check its layout right now!
      const adminView = document.getElementById('adminView');
      if (adminView) {
        views.forEach(v => {
          const el = document.getElementById(v.id);
          if (el) el.hidden = (el.id !== 'adminView');
        });
      }

      return {
        user: u,
        hasToken: !!tok,
        hash,
        adminViewFound: !!adminView,
        adminHiddenAfterManualToggle: adminView ? adminView.hidden : null
      };
    })()`,
    returnByValue: true
  });

  console.log('Debug result:', JSON.stringify(debug.result.value, null, 2));

  // Now measure the admin layout at 390px
  const measure = await send('Runtime.evaluate', {
    expression: `(() => {
      const adminView = document.getElementById('adminView');
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const overflowing = [];

      adminView.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > winW + 1) {
          overflowing.push({
            tag: el.tagName,
            id: el.id,
            className: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
            width: Math.round(rect.width),
            right: Math.round(rect.right),
            diff: Math.round(rect.right - winW)
          });
        }
      });

      return {
        winW, docW, bodyW,
        hasOverflow: docW > winW || bodyW > winW,
        overflowCount: overflowing.length,
        topOverflowing: overflowing.sort((a,b) => b.diff - a.diff).slice(0, 15)
      };
    })()`,
    returnByValue: true
  });

  console.log('Measure admin view:', JSON.stringify(measure.result.value, null, 2));

  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708/mobile_admin_forced_390.png', Buffer.from(snap.data, 'base64'));
  console.log('Saved mobile_admin_forced_390.png');

  ws.close();
}

run().catch(console.error);
