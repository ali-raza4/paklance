async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && p.url.includes('paklance.com')) || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

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

  const loginRes = await fetch('https://paklance-backend-updated.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paklance.com', password: 'PaklanceAdmin2026!' })
  });
  const loginData = await loginRes.json();

  const authEval = await send('Runtime.evaluate', {
    expression: `(async () => {
      localStorage.setItem('pk_access_token', ${JSON.stringify(loginData.accessToken)});
      await PaklanceAuth.init({ mock: false });
      const u = PaklanceAuth.getUser();
      location.hash = '#admin';
      route();
      loadAdminDashboardData(true);
      return { user: u, role: u ? u.role : null, hash: location.hash };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Auth eval in browser:', authEval.result.value);

  await new Promise(r => setTimeout(r, 2000));

  const adminDom = await send('Runtime.evaluate', {
    expression: `(() => {
      const adminView = document.querySelector('[data-view="admin"]');
      const sidePanel = document.querySelector('.admin-side-panel');
      const kpis = document.querySelectorAll('.admin-kpi-card');
      return {
        adminViewHidden: adminView ? adminView.hidden : true,
        sidePanelWidth: sidePanel ? sidePanel.offsetWidth : 0,
        kpisCount: kpis.length
      };
    })()`,
    returnByValue: true
  });
  console.log('Admin DOM state:', adminDom.result.value);

  ws.close();
}

main().catch(console.error);
