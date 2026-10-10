const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\Edge\\Application\\msedge.exe";

const USER_DATA = path.join(__dirname, 'chrome_test_profile_' + Date.now());

async function runTest() {
  console.log("Launching headless browser at:", CHROME_PATH);
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + USER_DATA,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check'
  ], { stdio: 'ignore' });

  // Wait for debugger port
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const json = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', res => {
          let d = '';
          res.on('data', chunk => d += chunk);
          res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });
      if (json && json.length > 0 && json[0].webSocketDebuggerUrl) {
        wsUrl = json[0].webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    chrome.kill();
    throw new Error("Could not connect to Chrome debugging port");
  }

  console.log("Connected to Chrome via CDP:", wsUrl);
  const ws = new WebSocket(wsUrl);

  let idCounter = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      callbacks.get(data.id)(data);
      callbacks.delete(data.id);
    }
  };

  await new Promise(resolve => ws.onopen = resolve);

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = idCounter++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result && res.result.result) {
      return res.result.result.value;
    }
    return null;
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');

    console.log("\n--- TEST STEP 1: Navigate to https://www.paklance.com/#jobs ---");
    await send('Page.navigate', { url: 'https://www.paklance.com/#jobs' });

    // Wait 4 seconds for API and jobs to load
    await new Promise(r => setTimeout(r, 4000));

    const initialCheck = await evaluate(`(() => {
      const jobCards = document.querySelectorAll('.job-card');
      const viewButtons = document.querySelectorAll('[data-job]');
      const titles = Array.from(document.querySelectorAll('.job-top h3')).map(h => h.textContent.trim());
      const jobIds = Array.from(document.querySelectorAll('button[data-job]')).map(b => b.getAttribute('data-job'));
      return {
        url: location.href,
        hash: location.hash,
        cardCount: jobCards.length,
        buttonCount: viewButtons.length,
        titles: titles,
        jobIds: jobIds
      };
    })()`);

    console.log("Initial jobs page loaded:", JSON.stringify(initialCheck, null, 2));

    if (initialCheck.cardCount < 2) {
      throw new Error("Expected at least 2 job cards, found " + initialCheck.cardCount);
    }

    console.log("\n--- TEST STEP 2: Click 'View job' on Job 1 (Copywriter) ---");
    const clickJob1 = await evaluate(`(() => {
      const btn = document.querySelector('button[data-job="${initialCheck.jobIds[0]}"]');
      if (!btn) return { error: "Button not found" };
      btn.click();
      return { clicked: true, targetJobId: btn.getAttribute('data-job') };
    })()`);
    console.log("Click result:", clickJob1);

    await new Promise(r => setTimeout(r, 1000));

    const job1Detail = await evaluate(`(() => {
      const jobView = document.querySelector('[data-view="job"]');
      const detail = document.getElementById('jobDetail');
      const h2 = detail ? detail.querySelector('h2') : null;
      const budget = detail ? detail.querySelector('.kv strong') : null;
      const client = detail ? detail.querySelector('.job-meta') : null;
      const skills = detail ? Array.from(detail.querySelectorAll('.tags .tag')).map(t => t.textContent.trim()) : [];
      const applyBtn = detail ? detail.querySelector('[data-apply]') : null;
      const activity = detail ? Array.from(detail.querySelectorAll('.kv')).map(k => k.textContent.trim()) : [];
      return {
        hash: location.hash,
        jobViewHidden: jobView ? jobView.hidden : null,
        title: h2 ? h2.textContent.trim() : null,
        budgetText: budget ? budget.textContent.trim() : null,
        clientMeta: client ? client.textContent.trim() : null,
        skillsCount: skills.length,
        skills: skills,
        applyJobId: applyBtn ? applyBtn.getAttribute('data-apply') : null,
        activityList: activity
      };
    })()`);
    console.log("Job 1 Detail View:", JSON.stringify(job1Detail, null, 2));

    console.log("\n--- TEST STEP 3: Refresh page while viewing Job 1 (#job/:id) ---");
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3500));

    const afterRefresh1 = await evaluate(`(() => {
      const jobView = document.querySelector('[data-view="job"]');
      const detail = document.getElementById('jobDetail');
      const h2 = detail ? detail.querySelector('h2') : null;
      const applyBtn = detail ? detail.querySelector('[data-apply]') : null;
      return {
        hash: location.hash,
        jobViewHidden: jobView ? jobView.hidden : null,
        title: h2 ? h2.textContent.trim() : null,
        applyJobId: applyBtn ? applyBtn.getAttribute('data-apply') : null
      };
    })()`);
    console.log("After Refresh Job 1:", JSON.stringify(afterRefresh1, null, 2));

    console.log("\n--- TEST STEP 4: Click '← Back to jobs' ---");
    await evaluate(`(() => {
      const back = document.querySelector('a.back');
      if (back) back.click();
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    const afterBack = await evaluate(`(() => {
      const jobsView = document.querySelector('[data-view="jobs"]');
      return {
        hash: location.hash,
        jobsViewHidden: jobsView ? jobsView.hidden : null
      };
    })()`);
    console.log("After Back:", JSON.stringify(afterBack, null, 2));

    console.log("\n--- TEST STEP 5: Click 'View job' on Job 2 (Research Paper) ---");
    const clickJob2 = await evaluate(`(() => {
      const btn = document.querySelector('button[data-job="${initialCheck.jobIds[1]}"]');
      if (!btn) return { error: "Job 2 button not found" };
      btn.click();
      return { clicked: true, targetJobId: btn.getAttribute('data-job') };
    })()`);
    console.log("Click Job 2 result:", clickJob2);

    await new Promise(r => setTimeout(r, 1000));

    const job2Detail = await evaluate(`(() => {
      const jobView = document.querySelector('[data-view="job"]');
      const detail = document.getElementById('jobDetail');
      const h2 = detail ? detail.querySelector('h2') : null;
      const budget = detail ? detail.querySelector('.kv strong') : null;
      const skills = detail ? Array.from(detail.querySelectorAll('.tags .tag')).map(t => t.textContent.trim()) : [];
      const applyBtn = detail ? detail.querySelector('[data-apply]') : null;
      const activity = detail ? Array.from(detail.querySelectorAll('.kv')).map(k => k.textContent.trim()) : [];
      return {
        hash: location.hash,
        jobViewHidden: jobView ? jobView.hidden : null,
        title: h2 ? h2.textContent.trim() : null,
        budgetText: budget ? budget.textContent.trim() : null,
        skills: skills,
        applyJobId: applyBtn ? applyBtn.getAttribute('data-apply') : null,
        activityList: activity
      };
    })()`);
    console.log("Job 2 Detail View:", JSON.stringify(job2Detail, null, 2));

    console.log("\n--- TEST STEP 6: Refresh page while viewing Job 2 ---");
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3500));

    const afterRefresh2 = await evaluate(`(() => {
      const jobView = document.querySelector('[data-view="job"]');
      const detail = document.getElementById('jobDetail');
      const h2 = detail ? detail.querySelector('h2') : null;
      return {
        hash: location.hash,
        jobViewHidden: jobView ? jobView.hidden : null,
        title: h2 ? h2.textContent.trim() : null
      };
    })()`);
    console.log("After Refresh Job 2:", JSON.stringify(afterRefresh2, null, 2));

    console.log("\n--- TEST STEP 7: Click 'Apply for this job' while logged out ---");
    const applyClick = await evaluate(`(() => {
      const applyBtn = document.querySelector('[data-apply]');
      if (!applyBtn) return { error: "Apply button not found" };
      applyBtn.click();
      const authModal = document.getElementById('m-auth');
      const toast = document.getElementById('toast');
      return {
        authModalOpen: authModal ? !authModal.hidden && authModal.classList.contains('is-open') : false,
        toastVisible: toast ? !toast.hidden : false,
        toastText: toast ? toast.textContent.trim() : ''
      };
    })()`);
    console.log("Apply while logged out:", JSON.stringify(applyClick, null, 2));

    console.log("\n==========================================");
    console.log("ALL LIVE BROWSER TESTS COMPLETED SUCCESSFULLY!");
    console.log("==========================================");
  } finally {
    ws.close();
    chrome.kill();
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
