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

  const cleanRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const token = localStorage.getItem('pk_access_token');
      // Delete draft
      await fetch('/api/admin/blogs/01e69bd4-6b50-4b5d-a688-7fa2c00a93d4', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
      // Update published to exact slug
      const updateRes = await fetch('/api/admin/blogs/ad85a55f-8714-4547-87aa-4929e0afe75e', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
          slug: 'how-is-paklance-different'
        })
      });
      return await updateRes.json();
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  console.log('Cleaned and updated slug:', cleanRes.result.value);
  ws.close();
}

main().catch(console.error);
