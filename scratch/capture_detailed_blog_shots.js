const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = path.resolve('C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708');
const SITE_URL = 'https://www.paklance.com';

async function getWsUrl() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && (p.url.includes('paklance.com') || p.url.includes('localhost'))) || pages[0];
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
  const wsUrl = await getWsUrl();
  const cdp = new CDPClient(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 1. Go to #admin and scroll table into view
  await cdp.send('Page.navigate', { url: `${SITE_URL}/#admin` });
  await sleep(3500);

  await cdp.evaluate(`(() => {
    const tab = document.querySelector('[data-admin-tab="blogs"]');
    if (tab) tab.click();
    const table = document.getElementById('adminBlogsTable');
    if (table) table.scrollIntoView({ behavior: 'instant', block: 'center' });
  })()`);
  await sleep(1500);
  await cdp.screenshot('live_admin_blogs_table_scrolled.png');

  // 2. Open Preview modal on the first blog post
  await cdp.evaluate(`(() => {
    const firstRow = document.querySelector('#adminBlogsTable tbody tr');
    if (firstRow) {
      const viewBtn = firstRow.querySelector('[data-action="view"]');
      if (viewBtn) viewBtn.click();
    }
  })()`);
  await sleep(2000);
  await cdp.screenshot('live_admin_blog_preview_modal.png');

  // Close preview modal
  await cdp.evaluate(`(() => {
    const closeBtn = document.querySelector('#m-admin-blog-preview [data-close]');
    if (closeBtn) closeBtn.click();
  })()`);
  await sleep(1000);

  // 3. Open seeded public article
  await cdp.send('Page.navigate', { url: `${SITE_URL}/#blog/complete-guide-to-paklance-safepay-escrow` });
  await sleep(3500);
  await cdp.evaluate(`(() => {
    const prose = document.querySelector('.blog-prose');
    if (prose) prose.scrollIntoView({ behavior: 'instant', block: 'start' });
  })()`);
  await sleep(1500);
  await cdp.screenshot('live_public_blog_article_detail.png');

  console.log('All detailed screenshots captured!');
  cdp.close();
}

run().catch(console.error);
