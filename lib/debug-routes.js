// Debug mode: draw Jack's poses and place them on the stored backgrounds, one step at a time.
// Only mounted when DEBUG_MODE=1, and only for logged-in users.
// Stored backgrounds, sheets and Jack poses are read from the database. Only the buttons here draw anything.

const { ensureSheets, setKey, redrawBackground, redrawSheet } = require('./background');
const { makeJack, placeJack } = require('./jack');
const bible = require('./bible');

const JACK_BATCH = 5;

function characterNames(book) {
  return [...new Set(book.pages.flatMap((p) => p.characters))];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debugPage(book) {
  const bibleHtml = bible.toHtml(bible.build(book));
  const sheetButtons = characterNames(book)
    .map((name) => `<button type="button" class="sheet-redraw" data-name="${name}">Redraw ${name} sheet</button>`)
    .join(' ');
  const rows = book.pages
    .map(
      (p) => `
<div class="row" data-n="${p.n}">
  <h3>Page ${p.n} <small>(text ${p.textZone})</small></h3>
  <p>${escapeHtml(p.caption)}</p>
  <div class="pair">
    <div>
      <img class="bg" src="/debug/background/${p.n}" alt="background ${p.n}">
      <div><button type="button" class="redraw">Redraw background</button></div>
    </div>
    <div>
      <img class="placed" alt="" hidden>
      <div><button type="button" class="preview">Preview Jack on this page</button></div>
    </div>
  </div>
  <div class="status"></div>
</div>`
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Beanstalk debug</title>
<style>
  body { font-family: sans-serif; max-width: 1000px; margin: 24px auto; padding: 0 16px; }
  .row { margin: 12px 0; padding-top: 8px; border-top: 1px solid #ddd; }
  .pair { display: flex; gap: 16px; }
  .pair > div { flex: 1; }
  .pair img { width: 100%; border: 1px solid #ccc; }
  .poses { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .poses div { border: 1px solid #ccc; padding: 4px; font-size: 13px; }
  .poses img { width: 100%; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
  button, input { font-size: 15px; margin: 6px 0; }
  .status { white-space: pre-wrap; color: #333; min-height: 1em; }
</style></head>
<body>
<h1>Debug: Jack's poses on the stored backgrounds</h1>
${bibleHtml}
<div class="row" id="jack">
  <h3>Jack's poses</h3>
  <p>Step 1: upload Jack's sheet. Step 2: draw the 5 sample pages. Step 3: approve them, and the other 15 are drawn.</p>
  <input type="file" id="jack-sheet" accept="image/png,image/jpeg,image/webp">
  <button type="button" id="save-sheet">Save sheet</button>
  <div>
    <button type="button" id="draw-samples">Draw the 5 samples</button>
    <button type="button" id="approve-rest">Approve the 5 and draw the other 15</button>
  </div>
  <div id="jack-status" class="status"></div>
  <div class="poses" id="poses"></div>
</div>
<div class="row">
  <h3>Reference sheets</h3>
  <p>A sheet is one side character's look. Redrawing a sheet does not change backgrounds already drawn. Redraw those pages too.</p>
  <div>${sheetButtons}</div>
  <div id="sheet-status" class="status"></div>
</div>
${rows}
<script>
const SAMPLES = ${JSON.stringify(book.samplePages || [])};
const ALL = ${JSON.stringify(book.pages.map((p) => p.n))};
const $ = (id) => document.getElementById(id);
const busyJack = (on, msg) => {
  ['save-sheet', 'draw-samples', 'approve-rest'].forEach((id) => ($(id).disabled = on));
  $('jack-status').textContent = msg || '';
};
async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res;
}
async function refreshPoses() {
  const st = await (await fetch('/debug/jack-status')).json();
  $('poses').innerHTML = ALL.map((n) => {
    const p = st.poses[n];
    const img = p ? '<img src="/debug/jack-pose/' + n + '?v=' + Date.now() + '" alt="">' : '<div style="height:120px"></div>';
    const label = p ? (p.approved ? 'approved' : 'drawn, not approved') : 'not drawn';
    return '<div>' + img + '<div>Page ' + n + ': ' + label + '</div></div>';
  }).join('');
  return st;
}
$('save-sheet').onclick = async () => {
  const file = $('jack-sheet').files[0];
  if (!file) { busyJack(false, "Choose Jack's sheet first."); return; }
  busyJack(true, 'Saving sheet...');
  const body = new FormData();
  body.append('sheet', file);
  const res = await fetch('/debug/jack-sheet', { method: 'POST', body });
  busyJack(false, res.ok ? 'Sheet saved.' : 'Failed: ' + (await res.text()));
  refreshPoses();
};
$('draw-samples').onclick = async () => {
  busyJack(true, 'Drawing the 5 samples... (one picture each, batches of ${JACK_BATCH})');
  try { await postJson('/debug/jack-poses/draw', { pages: SAMPLES }); busyJack(false, 'Samples drawn. Check them, then approve.'); }
  catch (e) { busyJack(false, 'Failed: ' + e.message); }
  refreshPoses();
};
$('approve-rest').onclick = async () => {
  busyJack(true, 'Approving the 5 and drawing the other 15...');
  try {
    await postJson('/debug/jack-poses/approve', { pages: SAMPLES });
    const rest = ALL.filter((n) => !SAMPLES.includes(n));
    await postJson('/debug/jack-poses/draw', { pages: rest });
    busyJack(false, 'All 20 drawn. Use Preview on any page.');
  } catch (e) { busyJack(false, 'Failed: ' + e.message); }
  refreshPoses();
};
document.querySelectorAll('.sheet-redraw').forEach((btn) => {
  btn.onclick = async () => {
    const st = $('sheet-status');
    st.textContent = 'Redrawing ' + btn.dataset.name + ' sheet... (one image)';
    const res = await fetch('/debug/sheet/' + btn.dataset.name, { method: 'POST' });
    st.textContent = res.ok ? btn.dataset.name + ' sheet replaced.' : 'Failed: ' + (await res.text());
  };
});
document.querySelectorAll('.row[data-n]').forEach((row) => {
  const n = row.dataset.n;
  const bg = row.querySelector('.bg');
  const status = row.querySelector('.status');
  const placed = row.querySelector('.placed');
  bg.onerror = () => { bg.alt = 'not drawn yet'; status.textContent = 'No stored background yet. Use Redraw background.'; };
  row.querySelector('.redraw').onclick = async () => {
    status.textContent = 'Redrawing the background... (one image, can take a minute)';
    const res = await fetch('/debug/redraw/' + n, { method: 'POST' });
    if (!res.ok) { status.textContent = 'Failed: ' + (await res.text()); return; }
    bg.src = URL.createObjectURL(await res.blob());
    status.textContent = 'Background replaced.';
  };
  row.querySelector('.preview').onclick = async () => {
    const res = await fetch('/debug/preview/' + n);
    if (!res.ok) { status.textContent = 'Failed: ' + (await res.text()); return; }
    placed.src = URL.createObjectURL(await res.blob());
    placed.hidden = false;
    status.textContent = 'Jack placed on the stored background.';
  };
});
refreshPoses();
</script>
</body></html>`;
}

module.exports = function mountDebug(app, { client, auth, upload, db, book }) {
  if (process.env.DEBUG_MODE !== '1') return;

  const jackKey = `${book.id}:jack:debug`;
  const pageOf = (n) => {
    const page = book.pages.find((p) => p.n === Number(n));
    if (!page) throw new Error('No page ' + n);
    return page;
  };
  const pagesFrom = (req) => {
    const list = Array.isArray(req.body && req.body.pages) ? req.body.pages : [];
    return list.map((n) => pageOf(n).n);
  };

  app.get('/debug', auth.requireLogin, (req, res) => res.type('html').send(debugPage(book)));

  // Serves the stored background only. Never draws one.
  app.get('/debug/background/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const stored = await db.getBackgrounds(setKey(book));
      if (!stored[page.n]) return res.status(404).type('text').send('not drawn');
      res.type('jpeg').send(stored[page.n]);
    } catch (e) {
      res.status(404).type('text').send(e.message);
    }
  });

  // Replaces one character's reference sheet. Backgrounds are not touched.
  app.post('/debug/sheet/:name', auth.requireLogin, async (req, res) => {
    try {
      const name = req.params.name;
      if (!characterNames(book).includes(name)) return res.status(404).type('text').send('No such character in this book.');
      await redrawSheet(client, book, name);
      res.type('text').send('ok');
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  // The only route that draws a background. It replaces the stored one.
  app.post('/debug/redraw/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const sheets = await ensureSheets(client, book);
      const img = await redrawBackground(client, book, page, sheets);
      res.type('jpeg').send(img);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  // Jack's likeness sheet for the debug set.
  app.post('/debug/jack-sheet', auth.requireLogin, upload.single('sheet'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).type('text').send("Upload Jack's sheet first.");
      await db.saveJackSheet(jackKey, req.file.buffer);
      res.type('text').send('ok');
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  app.get('/debug/jack-status', auth.requireLogin, async (req, res) => {
    try {
      const sheet = await db.getJackSheet(jackKey);
      const poses = await db.getJackPoses(jackKey);
      const summary = Object.fromEntries(Object.entries(poses).map(([n, p]) => [n, { approved: p.approved }]));
      res.json({ sheet: !!sheet, poses: summary });
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  // Draws Jack's poses for the given pages, in batches, and stores them. Not approved until approved.
  app.post('/debug/jack-poses/draw', auth.requireLogin, express_json(), async (req, res) => {
    try {
      const sheet = await db.getJackSheet(jackKey);
      if (!sheet) return res.status(409).type('text').send("Save Jack's sheet first.");
      const pages = pagesFrom(req);
      for (let i = 0; i < pages.length; i += JACK_BATCH) {
        await Promise.all(
          pages.slice(i, i + JACK_BATCH).map(async (n) => {
            const cut = await makeJack(client, sheet, pageOf(n));
            await db.saveJackPose(jackKey, n, cut);
          })
        );
      }
      res.type('text').send('ok');
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  app.post('/debug/jack-poses/approve', auth.requireLogin, express_json(), async (req, res) => {
    try {
      await db.approveJackPoses(jackKey, pagesFrom(req));
      res.type('text').send('ok');
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  // One Jack pose, as a transparent cut-out.
  app.get('/debug/jack-pose/:n', auth.requireLogin, async (req, res) => {
    try {
      const poses = await db.getJackPoses(jackKey);
      const p = poses[Number(req.params.n)];
      if (!p) return res.status(404).type('text').send('not drawn');
      res.type('png').send(p.image);
    } catch (e) {
      res.status(404).type('text').send(e.message);
    }
  });

  // Jack placed on the stored background for one page. Uses stored pictures only; draws nothing.
  app.get('/debug/preview/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const stored = await db.getBackgrounds(setKey(book));
      const poses = await db.getJackPoses(jackKey);
      if (!stored[page.n]) return res.status(409).type('text').send('No stored background for this page. Use Redraw background first.');
      if (!poses[page.n]) return res.status(409).type('text').send('Jack is not drawn for this page yet.');
      const out = await placeJack(stored[page.n], poses[page.n].image, page);
      res.type('jpeg').send(out);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });
};

// Parses JSON bodies for the Jack routes.
function express_json() {
  return require('express').json();
}
