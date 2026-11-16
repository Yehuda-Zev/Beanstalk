// Debug mode. Only mounted when DEBUG_MODE=1, and only for logged-in users.
// 1. Backgrounds: each page's shared background, with a generic Jack drawn in. Redraw one at a time.
// 2. Jack sheet: made from an uploaded photo. This is the child's side of the character bible.
// 3. Pages: put the child's face onto the generic Jack, one page or all, using the current Jack sheet.
// Nothing is drawn except when a button is pressed.

const express = require('express');
const { characterNames, ensureSheets, setKey, redrawBackground, redrawSheet, backgroundPrompt } = require('./background');
const { guideImage } = require('./layout');
const { makeJackSheet, detectHead, swapHead, facePrompt } = require('./jack');
const bible = require('./bible');

const CONCURRENCY = Number(process.env.PAGE_CONCURRENCY) || 10;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debugPage(book) {
  const rows = book.pages
    .map((p) => `
<div class="row" data-n="${p.n}">
  <h3>Page ${p.n} <small>(text ${p.textZone})</small></h3>
  <p>${esc(p.caption)}</p>
  <div class="pair">
    <div>
      <div class="frame"><img class="bg" src="/debug/background/${p.n}" alt="background ${p.n}"><div class="box"></div></div>
      <button type="button" class="redraw">Redraw background</button>
      <button type="button" class="detect">Find Jack's head</button>
      <div class="boxedit">Head box x <input class="bx" size="4"> y <input class="by" size="4"> w <input class="bw" size="4"> h <input class="bh" size="4">
        <button type="button" class="savebox">Save box</button></div>
    </div>
    <div>
      <div class="frame"><img class="page" alt="" hidden></div>
      <button type="button" class="draw">Draw with current Jack</button>
      <div class="prompts">
        <b>Background prompt</b> <small>(sent with the layout guide below and the side character sheets)</small>
        <pre>${esc(backgroundPrompt(p))}</pre>
        <b>Face prompt</b> <small>(sent with the cropped head and the Jack sheet)</small>
        <pre>${esc(facePrompt(p))}</pre>
        <b>Layout guide</b><br><img class="guide" src="/debug/guide/${p.n}" alt="layout guide ${p.n}">
      </div>
    </div>
  </div>
  <div class="status"></div>
</div>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Beanstalk debug</title>
<style>
  body { font-family: sans-serif; max-width: 1050px; margin: 24px auto; padding: 0 16px; }
  .row { margin: 12px 0; padding-top: 8px; border-top: 1px solid #ddd; }
  .pair { display: flex; gap: 16px; }
  .pair > div { flex: 1; }
  .frame { position: relative; }
  .frame img { width: 100%; display: block; border: 1px solid #ccc; }
  .box { position: absolute; border: 2px dashed #e33; pointer-events: none; display: none; }
  button, input { font-size: 14px; margin: 4px 0; }
  .status { white-space: pre-wrap; color: #333; min-height: 1em; }
  .char { display: flex; gap: 12px; margin: 8px 0; align-items: flex-start; }
  .char .sheet { width: 220px; border: 1px solid #ccc; }
  #sheet-img { max-width: 360px; border: 1px solid #ccc; display: block; }
  .prompts { margin-top: 8px; font-size: 13px; }
  .prompts pre { white-space: pre-wrap; background: #f6f6f6; padding: 6px; margin: 4px 0 10px; font-size: 12px; }
  .prompts .guide { width: 40%; border: 1px solid #ccc; }
</style></head>
<body>
<h1>Debug</h1>
${bible.toHtml(bible.build(book))}
<div class="row">
  <h3>Jack sheet (the child, from a photo)</h3>
  <p>Upload a photo. The sheet made from it is used for every face swap below.</p>
  <input type="file" id="photo" accept="image/png,image/jpeg,image/webp">
  <button type="button" id="make-sheet">Make Jack sheet</button>
  <button type="button" id="draw-all">Draw all 20 pages with current Jack</button>
  <div id="jack-status" class="status"></div>
  <img id="sheet-img" src="/debug/jack-sheet" alt="no Jack sheet yet">
</div>
${rows}
<script>
const $ = (id) => document.getElementById(id);
const fmt = (v) => Math.round(v * 1000) / 1000;
async function post(url, body, isForm) {
  const opts = { method: 'POST' };
  if (isForm) opts.body = body;
  else if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  return res;
}
function showBox(row, box) {
  const el = row.querySelector('.box');
  if (!box) { el.style.display = 'none'; return; }
  Object.assign(el.style, { display: 'block', left: box.x * 100 + '%', top: box.y * 100 + '%', width: box.w * 100 + '%', height: box.h * 100 + '%' });
  ['x', 'y', 'w', 'h'].forEach((k) => (row.querySelector('.b' + k).value = fmt(box[k])));
}
async function loadBox(row) {
  const res = await fetch('/debug/head/' + row.dataset.n);
  showBox(row, res.ok ? await res.json() : null);
}
$('make-sheet').onclick = async () => {
  const file = $('photo').files[0];
  if (!file) { $('jack-status').textContent = 'Choose a photo first.'; return; }
  $('jack-status').textContent = 'Making the Jack sheet... (one image)';
  const body = new FormData(); body.append('photo', file);
  try {
    const res = await post('/debug/jack-sheet', body, true);
    $('sheet-img').src = URL.createObjectURL(await res.blob());
    $('jack-status').textContent = 'Jack sheet saved.';
  } catch (e) { $('jack-status').textContent = 'Failed: ' + e.message; }
};
$('draw-all').onclick = () => {
  $('jack-status').textContent = 'Drawing all pages, ${CONCURRENCY} at a time...';
  const started = Date.now();
  const rows = [...document.querySelectorAll('.row[data-n]')];
  let next = 0, done = 0;
  const work = async () => {
    while (next < rows.length) {
      await drawPage(rows[next++]);
      $('jack-status').textContent = 'Drawn ' + (++done) + '/' + rows.length + ' in ' + Math.round((Date.now() - started) / 1000) + ' s';
    }
  };
  for (let i = 0; i < ${CONCURRENCY}; i++) work();
};
async function drawPage(row) {
  const status = row.querySelector('.status');
  const started = Date.now();
  status.textContent = 'Putting the child on this page...';
  try {
    const res = await post('/debug/page/' + row.dataset.n);
    const img = row.querySelector('.page');
    img.src = URL.createObjectURL(await res.blob()); img.hidden = false;
    status.textContent = 'Done in ' + Math.round((Date.now() - started) / 1000) + ' s.';
  } catch (e) { status.textContent = 'Failed: ' + e.message; }
}
document.querySelectorAll('.sheet-redraw').forEach((btn) => {
  btn.onclick = async () => {
    $('side-status').textContent = 'Redrawing ' + btn.dataset.name + '...';
    try {
      await post('/debug/sheet/' + btn.dataset.name);
      document.querySelector('.sheet[data-name="' + btn.dataset.name + '"]').src = '/debug/sheet/' + btn.dataset.name + '?v=' + Date.now();
      $('side-status').textContent = btn.dataset.name + ' replaced.';
    }
    catch (e) { $('side-status').textContent = 'Failed: ' + e.message; }
  };
});
document.querySelectorAll('.row[data-n]').forEach((row) => {
  const n = row.dataset.n;
  const status = row.querySelector('.status');
  const bg = row.querySelector('.bg');
  bg.onerror = () => { status.textContent = 'No background yet. Use Redraw background.'; };
  loadBox(row);
  row.querySelector('.redraw').onclick = async () => {
    status.textContent = 'Redrawing the background...';
    try {
      const res = await post('/debug/redraw/' + n);
      bg.src = URL.createObjectURL(await res.blob());
      await loadBox(row);
      status.textContent = 'Background replaced.';
    } catch (e) { status.textContent = 'Failed: ' + e.message; }
  };
  row.querySelector('.detect').onclick = async () => {
    status.textContent = 'Finding Jack\\'s head...';
    try { showBox(row, await (await post('/debug/head/' + n + '/detect')).json()); status.textContent = 'Head box found.'; }
    catch (e) { status.textContent = 'Failed: ' + e.message; }
  };
  row.querySelector('.savebox').onclick = async () => {
    const box = {}; ['x', 'y', 'w', 'h'].forEach((k) => (box[k] = Number(row.querySelector('.b' + k).value)));
    try { await post('/debug/head/' + n, box); showBox(row, box); status.textContent = 'Box saved.'; }
    catch (e) { status.textContent = 'Failed: ' + e.message; }
  };
  row.querySelector('.draw').onclick = () => drawPage(row);
});
</script>
</body></html>`;
}

module.exports = function mountDebug(app, { client, auth, upload, db, book }) {
  if (process.env.DEBUG_MODE !== '1') return;

  const jackKey = `${book.id}:jack:debug`;
  const set = () => setKey(book);
  const pageOf = (n) => {
    const page = book.pages.find((p) => p.n === Number(n));
    if (!page) throw new Error('No page ' + n);
    return page;
  };
  const fail = (res, e, code = 500) => res.status(code).type('text').send(e.message || String(e));

  app.get('/debug', auth.requireLogin, (req, res) => res.type('html').send(debugPage(book)));

  app.get('/debug/background/:n', auth.requireLogin, async (req, res) => {
    try {
      const img = (await db.getBackgrounds(set()))[pageOf(req.params.n).n];
      if (!img) return res.status(404).type('text').send('not drawn');
      res.type('jpeg').send(img);
    } catch (e) { fail(res, e, 404); }
  });

  // Redraws the background (with the generic Jack) and finds his head again.
  // The layout guide sent with a page's background prompt.
  app.get('/debug/guide/:n', auth.requireLogin, async (req, res) => {
    try { res.type('png').send(await guideImage(pageOf(req.params.n))); } catch (e) { fail(res, e, 404); }
  });

  app.post('/debug/redraw/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const img = await redrawBackground(client, book, page, await ensureSheets(client, book));
      res.type('jpeg').send(img);
    } catch (e) { fail(res, e); }
  });

  // One character's stored reference sheet.
  app.get('/debug/sheet/:name', auth.requireLogin, async (req, res) => {
    try {
      const img = (await db.getReferenceSheets(set()))[req.params.name];
      if (!img) return res.status(404).type('text').send('none');
      res.type('jpeg').send(img);
    } catch (e) { fail(res, e, 404); }
  });

  app.post('/debug/sheet/:name', auth.requireLogin, async (req, res) => {
    try {
      if (!characterNames(book).includes(req.params.name)) return res.status(404).type('text').send('No such character.');
      await redrawSheet(client, book, req.params.name);
      res.type('text').send('ok');
    } catch (e) { fail(res, e); }
  });

  // Head boxes: read, find again, or set by hand.
  app.get('/debug/head/:n', auth.requireLogin, async (req, res) => {
    try {
      const box = (await db.getHeads(set()))[pageOf(req.params.n).n];
      if (!box) return res.status(404).type('text').send('no box');
      res.json(box);
    } catch (e) { fail(res, e, 404); }
  });
  app.post('/debug/head/:n/detect', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const img = (await db.getBackgrounds(set()))[page.n];
      if (!img) return res.status(409).type('text').send('No background yet.');
      const box = await detectHead(client, img);
      await db.saveHead(set(), page.n, box);
      res.json(box);
    } catch (e) { fail(res, e); }
  });
  app.post('/debug/head/:n', auth.requireLogin, express.json(), async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const b = req.body || {};
      const box = { x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) };
      if (Object.values(box).some((v) => !(v >= 0 && v <= 1)) || box.w === 0 || box.h === 0) {
        return res.status(400).type('text').send('Box values must be between 0 and 1.');
      }
      await db.saveHead(set(), page.n, box);
      res.type('text').send('ok');
    } catch (e) { fail(res, e); }
  });

  // The child's Jack sheet, made from an uploaded photo.
  app.get('/debug/jack-sheet', auth.requireLogin, async (req, res) => {
    try {
      const img = await db.getJackSheet(jackKey);
      if (!img) return res.status(404).type('text').send('none');
      res.type('png').send(img);
    } catch (e) { fail(res, e, 404); }
  });
  app.post('/debug/jack-sheet', auth.requireLogin, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).type('text').send('Upload a photo first.');
      const sheet = await makeJackSheet(client, req.file.buffer);
      await db.saveJackSheet(jackKey, sheet);
      res.type('png').send(sheet);
    } catch (e) { fail(res, e); }
  });

  // One page with the child's face on the generic Jack. Not stored; redraw any time.
  app.post('/debug/page/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const sheet = await db.getJackSheet(jackKey);
      if (!sheet) return res.status(409).type('text').send('Make a Jack sheet first.');
      const img = (await db.getBackgrounds(set()))[page.n];
      if (!img) return res.status(409).type('text').send('No background yet. Use Redraw background.');
      let box = (await db.getHeads(set()))[page.n];
      if (!box) {
        box = await detectHead(client, img);
        await db.saveHead(set(), page.n, box);
      }
      res.type('jpeg').send(await swapHead(client, img, sheet, box, page));
    } catch (e) { fail(res, e); }
  });
};
