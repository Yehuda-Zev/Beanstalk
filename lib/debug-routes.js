// Debug mode: place Jack on the stored backgrounds, one page at a time.
// Only mounted when DEBUG_MODE=1, and only for logged-in users.
// Backgrounds are read from the database. Only the Redraw button draws a background, and nothing else does.

const { ensureSheets, setKey, redrawBackground } = require('./background');
const { makeJack, placeJack } = require('./jack');

function debugPage(book) {
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
      <img class="jack" alt="" hidden>
      <div>
        <input type="file" class="sheet" accept="image/png,image/jpeg,image/webp">
        <button type="button" class="draw">Draw Jack on this page</button>
      </div>
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
  button, input { font-size: 15px; margin: 6px 0; }
  .status { white-space: pre-wrap; color: #333; min-height: 1em; }
</style></head>
<body>
<h1>Debug: Jack on the stored backgrounds</h1>
<p>Backgrounds shown here are the stored ones. Only "Redraw background" changes a stored background.</p>
${rows}
<script>
const busy = (row, on, msg) => {
  row.querySelectorAll('button').forEach((b) => (b.disabled = on));
  row.querySelector('.status').textContent = msg || '';
};
async function showBlob(res, img) {
  img.src = URL.createObjectURL(await res.blob());
  img.hidden = false;
}
document.querySelectorAll('.row').forEach((row) => {
  const n = row.dataset.n;
  const bg = row.querySelector('.bg');
  bg.onerror = () => { bg.alt = 'not drawn yet'; row.querySelector('.status').textContent = 'No stored background yet. Use Redraw background.'; };
  row.querySelector('.redraw').onclick = async () => {
    busy(row, true, 'Redrawing the background... (one image, can take a minute)');
    const res = await fetch('/debug/redraw/' + n, { method: 'POST' });
    if (!res.ok) { busy(row, false, 'Failed: ' + (await res.text())); return; }
    await showBlob(res, bg);
    busy(row, false, 'Background replaced.');
  };
  row.querySelector('.draw').onclick = async () => {
    const file = row.querySelector('.sheet').files[0];
    if (!file) { row.querySelector('.status').textContent = "Choose Jack's sheet first."; return; }
    busy(row, true, 'Drawing Jack... (one image, can take a minute)');
    const body = new FormData();
    body.append('sheet', file);
    const res = await fetch('/debug/jack/' + n, { method: 'POST', body });
    if (!res.ok) { busy(row, false, 'Failed: ' + (await res.text())); return; }
    await showBlob(res, row.querySelector('.jack'));
    busy(row, false, 'Done.');
  };
});
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = function mountDebug(app, { client, auth, upload, db, book }) {
  if (process.env.DEBUG_MODE !== '1') return;

  const pageOf = (req) => {
    const n = Number(req.params.n);
    const page = book.pages.find((p) => p.n === n);
    if (!page) throw new Error('No page ' + req.params.n);
    return page;
  };

  app.get('/debug', auth.requireLogin, (req, res) => res.type('html').send(debugPage(book)));

  // Serves the stored background only. Never draws one.
  app.get('/debug/background/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req);
      const stored = await db.getBackgrounds(setKey(book));
      if (!stored[page.n]) return res.status(404).type('text').send('not drawn');
      res.type('jpeg').send(stored[page.n]);
    } catch (e) {
      res.status(404).type('text').send(e.message);
    }
  });

  // The only route that draws a background. It replaces the stored one.
  app.post('/debug/redraw/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req);
      const sheets = await ensureSheets(client, book);
      const img = await redrawBackground(client, book, page, sheets);
      res.type('jpeg').send(img);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  // Draws Jack on the stored background. Refuses if there is none, so it never redraws the scene.
  app.post('/debug/jack/:n', auth.requireLogin, upload.single('sheet'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).type('text').send("Upload Jack's sheet first.");
      const page = pageOf(req);
      const stored = await db.getBackgrounds(setKey(book));
      const background = stored[page.n];
      if (!background) return res.status(409).type('text').send(`No stored background for page ${page.n}. Use Redraw background first.`);
      const jackPng = await makeJack(client, req.file.buffer, page);
      const out = await placeJack(background, jackPng, page);
      res.type('jpeg').send(out);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });
};
