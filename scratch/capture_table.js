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

  await send('Runtime.evaluate', {
    expression: `(() => {
      window.location.hash = '#admin';
      const sideTab = document.getElementById('adminSideTabBlogs');
      if (sideTab) sideTab.click();
      const tbl = document.getElementById('adminBlogsTable');
      if (tbl) tbl.scrollIntoView({ behavior: 'instant', block: 'center' });
    })()`
  });

  await new Promise(r => setTimeout(r, 2000));
  const snap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'live_admin_blogs_table_full.png'), Buffer.from(snap.data, 'base64'));
  console.log('Saved live_admin_blogs_table_full.png');
  ws.close();
}

run().catch(console.error);
