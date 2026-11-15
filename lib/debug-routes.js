// Debug mode: draw one page at a time. Only mounted when DEBUG_MODE=1, and only for logged-in users.
// Nothing here runs unless someone clicks a button.

const { ensureSheets, setKey, makeBackground } = require('./background');
const { makeJack, placeJack } = require('./jack');

function debugPage(book) {
  const options = book.pages
    .map((p) => `<option value="${p.n}">${p.n}: ${escapeHtml(p.caption)}</option>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Beanstalk debug</title>
<style>
  body { font-family: sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  select, input, button { font-size: 16px; margin: 6px 0; }
  img { max-width: 100%; border: 1px solid #ccc; margin-top: 12px; }
  .row { margin: 12px 0; padding-top: 8px; border-top: 1px solid #ddd; }
  #status { white-space: pre-wrap; color: #333; }
</style></head>
<body>
<h1>Debug: one page at a time</h1>
<p>Pick a page, then draw its background or Jack on it. Each step makes one image.</p>
<label>Page <select id="page">${options}</select></label>

<div class="row">
  <h2>1. Background</h2>
  <p>Draws the page background with its side characters. Stored, so later steps reuse it.</p>
  <button id="bg" type="button">Draw background</button>
</div>

<div class="row">
  <h2>2. Jack on the page</h2>
  <p>Upload Jack's approved sheet (PNG or JPG), then draw Jack on the page's background.</p>
  <input id="sheet" type="file" accept="image/png,image/jpeg,image/webp">
  <br><button id="jack" type="button">Draw Jack on this page</button>
</div>

<div id="status"></div>
<img id="out" alt="">

<script>
const $ = (id) => document.getElementById(id);
function busy(on, msg) {
  $('bg').disabled = on; $('jack').disabled = on;
  $('status').textContent = msg || '';
}
async function show(res) {
  if (!res.ok) { busy(false, 'Failed: ' + (await res.text())); return; }
  const url = URL.createObjectURL(await res.blob());
  $('out').src = url;
  busy(false, 'Done.');
}
$('bg').onclick = async () => {
  busy(true, 'Drawing the background... (one image, can take a minute)');
  const res = await fetch('/debug/background/' + $('page').value, { method: 'POST' });
  show(res);
};
$('jack').onclick = async () => {
  const file = $('sheet').files[0];
  if (!file) { busy(false, 'Choose Jack\\'s sheet first.'); return; }
  busy(true, 'Drawing Jack... (one image, can take a minute)');
  const body = new FormData();
  body.append('sheet', file);
  const res = await fetch('/debug/jack/' + $('page').value, { method: 'POST', body });
  show(res);
};
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

  app.post('/debug/background/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req);
      const sheets = await ensureSheets(client, book);
      const img = await makeBackground(client, book, page, sheets);
      res.type('jpeg').send(img);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });

  app.post('/debug/jack/:n', auth.requireLogin, upload.single('sheet'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).type('text').send("Upload Jack's sheet first.");
      const page = pageOf(req);
      const stored = await db.getBackgrounds(setKey(book));
      let background = stored[page.n];
      if (!background) {
        const sheets = await ensureSheets(client, book);
        background = await makeBackground(client, book, page, sheets);
      }
      const jackPng = await makeJack(client, req.file.buffer, page);
      const out = await placeJack(background, jackPng, page);
      res.type('jpeg').send(out);
    } catch (e) {
      res.status(500).type('text').send(e.message);
    }
  });
};
