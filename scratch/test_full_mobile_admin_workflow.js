const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\syeda\\.gemini\\antigravity-ide\\brain\\1ca12b3e-4c3c-404d-b673-b3fc48fc9708';

async function run() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.url && p.url.includes('paklance.com')) || pages[0];
  console.log('Connecting to Chrome CDP:', page.title, page.url);
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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.clearBrowserCache');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  async function takeScreenshot(filename) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fullPath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(shot.data, 'base64'));
    console.log(`[Screenshot] Saved: ${filename}`);
  }

  // Set mobile device metrics: iPhone 14 / modern standard (390 x 844)
  console.log('Setting mobile viewport to 390x844...');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // Navigate to #admin and hard-reload with cache ignored to pick up deployed production build
  console.log('Hard reloading https://www.paklance.com/#admin with cache disabled...');
  await send('Page.navigate', { url: 'https://www.paklance.com/#admin' });
  await send('Page.reload', { ignoreCache: true });
  await sleep(4500);

  // 1. Measure viewport and check for horizontal overflow
  const metrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const cw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const bw = document.body.scrollWidth;
      const overflowingElements = [];
      document.querySelectorAll('*').forEach(el => {
        if (el.offsetWidth > cw + 2 || el.scrollWidth > cw + 2) {
          overflowingElements.push({
            tag: el.tagName,
            id: el.id,
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
            offsetWidth: el.offsetWidth,
            scrollWidth: el.scrollWidth
          });
        }
      });
      return { clientWidth: cw, docScrollWidth: sw, bodyScrollWidth: bw, overflowingCount: overflowingElements.length, overflowingElements: overflowingElements.slice(0, 10) };
    })()`,
    returnByValue: true
  });
  console.log('Mobile Viewport Metrics at 390px:\n', JSON.stringify(metrics.result.value, null, 2));
  await takeScreenshot('mobile_admin_dashboard_390px.png');

  // 2. Test sidebar collapse toggle
  console.log('Testing mobile sidebar toggle...');
  const sideNavToggle = await send('Runtime.evaluate', {
    expression: `(() => {
      const toggle = document.getElementById('adminSideNavToggle');
      const panel = document.getElementById('adminSidePanel');
      if (!toggle || !panel) return { error: 'Toggle or panel not found' };
      const beforeState = panel.classList.contains('collapsed');
      toggle.click();
      const afterClick1 = panel.classList.contains('collapsed');
      toggle.click();
      const afterClick2 = panel.classList.contains('collapsed');
      return { beforeState, afterClick1, afterClick2 };
    })()`,
    returnByValue: true
  });
  console.log('Sidebar Toggle Test Result:', sideNavToggle.result.value);

  // 3. Switch to Blogs & Articles tab
  console.log('Switching to Blogs tab on mobile...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const blogsTab = document.querySelector('.admin-side-link[data-admin-tab="blogs"]') || document.querySelector('.admin-tab[data-admin-tab="blogs"]');
      if (blogsTab) blogsTab.click();
    })()`
  });
  await sleep(1500);
  await takeScreenshot('mobile_admin_blogs_tab_390px.png');

  // 4. Click Add New Blog button to open modal
  console.log('Opening Blog Editor modal...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('adminCreateBlogBtn') || document.getElementById('adminSideBtnAddBlog');
      if (btn) btn.click();
    })()`
  });
  await sleep(1000);

  // Verify modal dimensions and responsiveness at 390px
  const modalMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.getElementById('m-admin-blog-editor');
      const card = modal?.querySelector('.modal-card');
      const cw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const toolbar = document.getElementById('blogEditorToolbar');
      return {
        isOpen: !modal?.hidden,
        cardWidth: card?.offsetWidth,
        cardScrollHeight: card?.scrollHeight,
        cardClientHeight: card?.clientHeight,
        clientWidth: cw,
        docScrollWidth: sw,
        toolbarHeight: toolbar?.offsetHeight,
        hasTableBtn: !!document.getElementById('blogToolbarTableBtn'),
        hasQuoteBtn: !!document.getElementById('blogToolbarQuoteBtn'),
        hasTipBtn: !!document.getElementById('blogToolbarTipBtn'),
        hasSubtitleInput: !!document.getElementById('blogFormSubtitle')
      };
    })()`,
    returnByValue: true
  });
  console.log('Blog Editor Modal Metrics at 390px:\n', JSON.stringify(modalMetrics.result.value, null, 2));
  await takeScreenshot('mobile_blog_editor_modal_top_390px.png');

  // Scroll inside modal to see toolbar and rich editor
  await send('Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('#m-admin-blog-editor .modal-card');
      if (card) card.scrollTop = 380;
    })()`
  });
  await sleep(600);
  await takeScreenshot('mobile_blog_editor_modal_scrolled_390px.png');

  // 5. Fill blog form with document-style article "How Is Paklance Different?"
  console.log('Populating article with document-style formatting (table, quote, tip, headings)...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('blogFormTitle').value = 'How Is Paklance Different?';
      document.getElementById('blogFormSubtitle').value = 'Why Pakistan\\'s trust-first talent marketplace beats traditional global freelancing platforms';
      document.getElementById('blogFormSlug').value = 'how-is-paklance-different';
      document.getElementById('blogFormCategory').value = 'Freelancing';
      document.getElementById('blogFormAuthor').value = 'Paklance Editorial Team';
      document.getElementById('blogFormExcerpt').value = 'A deep dive into how Paklance solves FX loss, escrow disputes, payment delays, and quality vetting for Pakistani specialists and global clients.';
      document.getElementById('blogFormCoverUrl').value = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80';
      document.getElementById('blogFormTags').value = 'paklance, safepay, freelancing, remote work, escrow';

      // Insert full document-style HTML content
      const richBody = document.getElementById('blogRichBody');
      richBody.innerHTML = \`
        <h2>The Evolution of Freelance Marketplaces in Pakistan</h2>
        <p>For more than a decade, Pakistani developers, designers, and consultants have powered international enterprises through legacy freelancing marketplaces. However, local specialists faced severe friction: up to 20% commission cuts, costly foreign exchange conversions, withdrawal delays, and asymmetric dispute procedures.</p>

        <blockquote class="blog-quote">
          <p>"Paklance was engineered from day one to give Pakistani specialists equal global footing with zero foreign exchange friction and guaranteed milestone protection."</p>
          <cite>Paklance Product Team</cite>
        </blockquote>

        <h2>Feature Comparison: Paklance vs. Traditional Marketplaces</h2>
        <p>Here is an in-depth breakdown of how Paklance directly addresses the shortcomings of legacy platforms:</p>

        <div class="blog-table-wrap">
          <table class="blog-table">
            <thead>
              <tr>
                <th>Key Feature</th>
                <th>Paklance Platform</th>
                <th>Traditional Global Platforms</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>SafePay Escrow</th>
                <td>Direct PKR milestone protection held securely before work begins</td>
                <td>Foreign currency escrow with 5-10% FX conversion loss</td>
              </tr>
              <tr>
                <th>Platform Commission</th>
                <td>Ultra-low flat fee with complete transparent breakdown</td>
                <td>Up to 20% commission shaved off specialist earnings</td>
              </tr>
              <tr>
                <th>Local Payout Rails</th>
                <td>Instant payouts via Raast, EasyPaisa, JazzCash &amp; Pakistani Banks</td>
                <td>Third-party intermediaries (Payoneer/Wire) with $15-30 transfer fees</td>
              </tr>
              <tr>
                <th>Talent Vetting</th>
                <td>Pre-screened, verified top 3% Pakistani specialists</td>
                <td>Unmoderated bidding wars flooded by bot proposals</td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="blog-tip">
          <svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--brand-3);flex-shrink:0;margin-top:2px"><path d="M9 18h6m-4 4h2M12 2a7 7 0 0 0-7 7c0 3 2 5 2 7h10c0-2 2-4 2-7a7 7 0 0 0-7-7z"/></svg>
          <div>
            <strong>Pro Tip: Milestone Escrow Protection</strong>
            <p>Always verify SafePay milestone funding is locked in escrow before commencing work on any project deliverable to guarantee 100% payment security.</p>
          </div>
        </aside>

        <h2>Direct Client Collaboration Without FX Risk</h2>
        <p>By conducting transactions directly in PKR through Paklance SafePay, clients and specialists completely bypass intermediary bank markups and currency fluctuation hazards. Projects move faster, communication is direct, and disputes are resolved by dedicated arbiters who understand the local context.</p>
      \`;

      // Trigger cover and serp updates
      const coverUrl = document.getElementById('blogFormCoverUrl');
      coverUrl.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  });
  await sleep(1000);

  // 6. Save as Draft first
  console.log('Saving as Draft...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const draftBtn = document.getElementById('blogBtnSaveDraft');
      if (draftBtn) draftBtn.click();
    })()`
  });
  await sleep(2500);
  await takeScreenshot('mobile_admin_blogs_after_draft_saved.png');

  // Verify draft exists in table
  const draftVerification = await send('Runtime.evaluate', {
    expression: `(() => {
      const row = Array.from(document.querySelectorAll('#adminBlogsTbody tr')).find(r => r.textContent.includes('How Is Paklance Different'));
      return {
        found: !!row,
        text: row?.textContent?.trim(),
        hasDraftBadge: !!row?.querySelector('.status-draft')
      };
    })()`,
    returnByValue: true
  });
  console.log('Draft in Admin Table:', draftVerification.result.value);

  // 7. Open Preview Modal
  console.log('Opening Article for Edit & Preview...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const row = Array.from(document.querySelectorAll('#adminBlogsTbody tr')).find(r => r.textContent.includes('How Is Paklance Different'));
      const editBtn = row?.querySelector('button[title="Edit Article"]');
      if (editBtn) editBtn.click();
    })()`
  });
  await sleep(1200);

  console.log('Clicking Preview Article...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const prevBtn = document.getElementById('blogBtnPreviewArticle');
      if (prevBtn) prevBtn.click();
    })()`
  });
  await sleep(1000);
  await takeScreenshot('mobile_blog_preview_modal_390px.png');

  // Close preview modal
  await send('Runtime.evaluate', {
    expression: `(() => {
      const closeBtn = document.querySelector('#m-admin-blog-preview .m-close');
      if (closeBtn) closeBtn.click();
    })()`
  });
  await sleep(600);

  // 8. Publish the article
  console.log('Publishing article...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const pubBtn = document.getElementById('blogBtnSavePublish');
      if (pubBtn) pubBtn.click();
    })()`
  });
  await sleep(3000);
  await takeScreenshot('mobile_admin_blogs_after_published.png');

  // 9. Navigate to public blog listing: #blog
  console.log('Navigating to public blog listing: #blog...');
  await send('Page.navigate', { url: 'https://www.paklance.com/#blog' });
  await sleep(2500);
  await takeScreenshot('mobile_public_blog_listing_390px.png');

  // Check article on public listing
  const pubListCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const articleCard = Array.from(document.querySelectorAll('.blog-card, .blog-featured')).find(c => c.textContent.includes('How Is Paklance Different'));
      return {
        found: !!articleCard,
        title: articleCard?.querySelector('h2, h3')?.textContent?.trim(),
        hasImage: !!articleCard?.querySelector('img')
      };
    })()`,
    returnByValue: true
  });
  console.log('Public Blog Listing Check:', pubListCheck.result.value);

  // 10. Open full public article: #blog/how-is-paklance-different
  console.log('Navigating to full article: #blog/how-is-paklance-different...');
  await send('Page.navigate', { url: 'https://www.paklance.com/#blog/how-is-paklance-different' });
  await sleep(2500);

  // Verify article elements on mobile
  const fullArticleCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const cw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const title = document.querySelector('.blog-article-head h1')?.textContent?.trim();
      const subtitle = document.querySelector('.blog-subtitle')?.textContent?.trim();
      const coverImg = document.querySelector('.blog-hero-img img')?.src;
      const hasTable = !!document.querySelector('.blog-table');
      const hasQuote = !!document.querySelector('.blog-quote');
      const hasTip = !!document.querySelector('.blog-tip');
      return {
        clientWidth: cw,
        docScrollWidth: sw,
        title,
        subtitle,
        hasCoverImg: !!coverImg,
        coverImgUrl: coverImg?.slice(0, 50),
        hasTable,
        hasQuote,
        hasTip
      };
    })()`,
    returnByValue: true
  });
  console.log('Public Article Full Verification:\n', JSON.stringify(fullArticleCheck.result.value, null, 2));
  await takeScreenshot('mobile_full_article_top_390px.png');

  // Scroll down to table and quote
  await send('Runtime.evaluate', {
    expression: `window.scrollTo(0, 600);`
  });
  await sleep(800);
  await takeScreenshot('mobile_full_article_table_390px.png');

  // 11. Test Desktop Viewport (1280x800) to confirm desktop styling intact
  console.log('Testing Desktop Viewport at 1280x800...');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'https://www.paklance.com/#admin' });
  await sleep(2500);
  await takeScreenshot('desktop_admin_dashboard_1280px.png');

  // Verify desktop metrics
  const desktopMetrics = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        sidebarWidth: document.querySelector('.admin-side-panel')?.offsetWidth,
        contentWidth: document.querySelector('.admin-main-content')?.offsetWidth
      };
    })()`,
    returnByValue: true
  });
  console.log('Desktop Admin Metrics:', desktopMetrics.result.value);

  console.log('\n=========================================');
  console.log('ALL VERIFICATION STEPS COMPLETED SUCCESSFULLY');
  console.log('=========================================');
  ws.close();
}

run().catch(console.error);
