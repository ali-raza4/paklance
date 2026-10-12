const fs = require('fs');

async function inspect() {
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const p = pages.find(x => x.id === 'ECA67FDD1A99CFFF9B6694D78A43CC47') || pages[0];
  console.log('Connecting to page:', p.title, p.url);
  const ws = new WebSocket(p.webSocketDebuggerUrl);

  ws.onopen = async () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `({
          hash: location.hash,
          user: localStorage.getItem('pk_user'),
          token: !!localStorage.getItem('pk_access_token'),
          role: window.PaklanceAuth ? window.PaklanceAuth.getRole() : null,
          isAdmin: window.PaklanceAuth ? window.PaklanceAuth.isAdminUser() : null,
          hdrAdminDisplay: document.getElementById('hdrAdminLink')?.style.display,
          mobAdminDisplay: document.getElementById('mobAdminLink')?.style.display,
          mobileMenuHidden: document.getElementById('mobileMenu')?.hidden
        })`,
        returnByValue: true
      }
    }));
  };

  ws.onmessage = (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id === 1) {
      console.log('State in browser:', d.result.value);
      ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot' }));
    }
    if (d.id === 2) {
      fs.writeFileSync(
        'C:/Users/syeda/.gemini/antigravity-ide/brain/1ca12b3e-4c3c-404d-b673-b3fc48fc9708/user_current_view.png',
        Buffer.from(d.result.data, 'base64')
      );
      console.log('Screenshot saved to user_current_view.png');
      process.exit(0);
    }
  };
}

inspect().catch(console.error);
