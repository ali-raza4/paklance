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

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const of = await send('Runtime.evaluate', {
    expression: `(() => {
      const cw = document.documentElement.clientWidth;
      const list = [];
      document.querySelectorAll('*').forEach(el => {
        if (el.offsetWidth > cw + 1 || el.scrollWidth > cw + 1) {
          list.push({
            tag: el.tagName,
            id: el.id,
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
            offsetWidth: el.offsetWidth,
            scrollWidth: el.scrollWidth,
            parent: el.parentElement?.tagName + (el.parentElement?.className ? '.' + String(el.parentElement.className).slice(0,30) : '')
          });
        }
      });
      return {
        clientWidth: cw,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        topOverflowing: list.sort((a,b) => b.scrollWidth - a.scrollWidth).slice(0, 30)
      };
    })()`,
    returnByValue: true
  });

  console.log('Overflow analysis at 390px:\n', JSON.stringify(of.result.value, null, 2));
  ws.close();
}

run().catch(console.error);
