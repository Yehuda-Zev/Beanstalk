// Debug mode. Only mounted when DEBUG_MODE=1, and only for logged-in users.
// 1. Backgrounds: each page's shared background, with a generic Jack drawn in. Redraw one at a time.
// 2. Jack sheet: made from an uploaded photo. This is the child's side of the character bible.
// 3. Pages: put the child's face onto the generic Jack, one page or all, using the current Jack sheet.
// Nothing is drawn except when a button is pressed.

const express = require('express');
const { headLine, characterNames, ensureSheets, setKey, redrawBackground, redrawSheet, backgroundPrompt } = require('./background');
const { makeJackSheet, detectHead, swapHead, facePrompt } = require('./jack');
const bible = require('./bible');

const CONCURRENCY = Number(process.env.PAGE_CONCURRENCY) || 10;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debugPage(book, edits, heads = {}) {
  const rows = book.pages
    .map((p) => `
<div class="row" data-n="${p.n}">
  <h3>Page ${p.n} <small>(text ${p.textZone})</small></h3>
  <p>${esc(p.caption)}</p>
  <div class="pair">
    <div>
      <div class="frame drawable"><img class="bg" draggable="false" src="/debug/background/${p.n}" alt="background ${p.n}"><div class="box"></div></div>
      <button type="button" class="redraw">Redraw background</button>
      <button type="button" class="detect">Find Jack's head</button>
      <div class="boxedit"><b>Jack's head:</b> drag on the picture to draw where it should be. A box you draw is added to the prompt and kept when you redraw.<br>
        x <input class="bx" size="4"> y <input class="by" size="4"> w <input class="bw" size="4"> h <input class="bh" size="4">
        <button type="button" class="savebox">Save box</button>
        <button type="button" class="clearbox">Clear box</button> <span class="boxkind"></span></div>
    </div>
    <div>
      <div class="frame"><img class="page" alt="" hidden></div>
      <button type="button" class="draw">Draw with current Jack</button>
      <div class="prompts">
        <b>Background prompt</b>${edits['page:' + p.n] ? ' <small>(edited)</small>' : ''} <small>(sent with the character sheets: Image 1 is Jack, then the others; numbers must match)</small>
        <textarea class="edit" data-key="page:${p.n}" rows="14">${esc(edits['page:' + p.n] || backgroundPrompt(p))}</textarea><br>
        <button type="button" class="save-edit" data-key="page:${p.n}">Save prompt</button>
        <button type="button" class="reset-edit" data-key="page:${p.n}">Reset to default</button>
        ${headLine(heads[p.n]) ? `<div><b>Added from your head box:</b><pre>${esc(headLine(heads[p.n]))}</pre></div>` : ''}
        <b>Face prompt</b> <small>(sent with the cropped head and the Jack sheet)</small>
        <pre>${esc(facePrompt(p))}</pre>
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
  .box.manual { border: 3px solid #e33; }
  .frame.drawable { cursor: crosshair; user-select: none; }
  .frame.drawable img { -webkit-user-drag: none; }
  button, input { font-size: 14px; margin: 4px 0; }
  .status { white-space: pre-wrap; color: #333; min-height: 1em; }
  .char { display: flex; gap: 12px; margin: 8px 0; align-items: flex-start; }
  .char .sheet { width: 220px; border: 1px solid #ccc; }
  #sheet-img { max-width: 360px; border: 1px solid #ccc; display: block; }
  .prompts { margin-top: 8px; font-size: 13px; }
  textarea.edit { width: 100%; font-size: 12px; font-family: monospace; box-sizing: border-box; }
  .prompts pre { white-space: pre-wrap; background: #f6f6f6; padding: 6px; margin: 4px 0 10px; font-size: 12px; }
</style></head>
<body>
<h1>Debug</h1>
<label style="display:block;padding:8px;background:#fff6d6;border:1px solid #e5c860"><input type="checkbox" id="draft" checked> Draft mode: draw backgrounds and sheets fast (gpt-image-2.5-flare, low quality). Untick for the final, slow, high-quality versions.</label>
${bible.toHtml(bible.build(book), edits)}
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
const draftQuery = () => ($('draft').checked ? '?draft=1' : '');
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
  if (!box) { el.style.display = 'none'; row.querySelector('.boxkind').textContent = '(none)'; return; }
  el.classList.toggle('manual', !!box.manual);
  row.querySelector('.boxkind').textContent = box.manual ? '(set by you, used in the prompt)' : '(found automatically)';
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
function editStatus(btn) {
  const row = btn.closest('.row');
  return row.querySelector('.status') || $('side-status');
}
document.querySelectorAll('.save-edit').forEach((btn) => {
  btn.onclick = async () => {
    const text = document.querySelector('textarea[data-key="' + btn.dataset.key + '"]').value;
    if (!text.trim()) { editStatus(btn).textContent = 'Prompt is empty.'; return; }
    try { await post('/debug/edit', { key: btn.dataset.key, text }); editStatus(btn).textContent = 'Saved. Redraw to use it.'; }
    catch (e) { editStatus(btn).textContent = 'Failed: ' + e.message; }
  };
});
document.querySelectorAll('.reset-edit').forEach((btn) => {
  btn.onclick = async () => {
    try { await post('/debug/edit/reset', { key: btn.dataset.key }); location.reload(); }
    catch (e) { editStatus(btn).textContent = 'Failed: ' + e.message; }
  };
});
document.querySelectorAll('.sheet-redraw').forEach((btn) => {
  btn.onclick = async () => {
    $('side-status').textContent = 'Redrawing ' + btn.dataset.name + '...';
    try {
      await post('/debug/sheet/' + btn.dataset.name + draftQuery());
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
      const res = await post('/debug/redraw/' + n + draftQuery());
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
    const box = { manual: true }; ['x', 'y', 'w', 'h'].forEach((k) => (box[k] = Number(row.querySelector('.b' + k).value)));
    try { await post('/debug/head/' + n, box); showBox(row, box); status.textContent = 'Box saved.'; }
    catch (e) { status.textContent = 'Failed: ' + e.message; }
  };
  row.querySelector('.draw').onclick = () => drawPage(row);
  row.querySelector('.clearbox').onclick = async () => {
    try { await post('/debug/head/' + n + '/clear'); showBox(row, null); status.textContent = 'Box cleared. Redraw to let it be found.'; }
    catch (e) { status.textContent = 'Failed: ' + e.message; }
  };
  const frame = row.querySelector('.frame.drawable');
  let start = null;
  const at = (ev) => {
    const r = frame.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
  };
  const span = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), manual: true });
  frame.addEventListener('pointerdown', (ev) => { start = at(ev); frame.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  frame.addEventListener('pointermove', (ev) => { if (start) showBox(row, span(start, at(ev))); });
  frame.addEventListener('pointerup', async (ev) => {
    if (!start) return;
    const box = span(start, at(ev));
    start = null;
    if (box.w < 0.01 || box.h < 0.01) { loadBox(row); return; }
    try { await post('/debug/head/' + n, box); showBox(row, box); status.textContent = 'Head box saved. Redraw the background to use it.'; }
    catch (e) { status.textContent = 'Failed: ' + e.message; }
  });
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

  app.get('/debug', auth.requireLogin, async (req, res) => {
    try { res.type('html').send(debugPage(book, await db.getOverrides(book.id), await db.getHeads(set()))); } catch (e) { fail(res, e); }
  });

  // Saves or clears edited prompt text. Keys are 'page:N' or 'char:name'.
  const validKey = (k) => /^page:\d+$/.test(k) ? !!book.pages.find((p) => 'page:' + p.n === k) : /^char:\w+$/.test(k) && characterNames(book).includes(k.slice(5));
  app.post('/debug/edit', auth.requireLogin, express.json({ limit: '200kb' }), async (req, res) => {
    try {
      const { key, text } = req.body || {};
      if (!validKey(key)) return res.status(400).type('text').send('Unknown prompt.');
      if (typeof text !== 'string' || !text.trim()) return res.status(400).type('text').send('Prompt is empty.');
      await db.saveOverride(book.id, key, text.trim());
      res.type('text').send('ok');
    } catch (e) { fail(res, e); }
  });
  app.post('/debug/edit/reset', auth.requireLogin, express.json(), async (req, res) => {
    try {
      const { key } = req.body || {};
      if (!validKey(key)) return res.status(400).type('text').send('Unknown prompt.');
      await db.deleteOverride(book.id, key);
      res.type('text').send('ok');
    } catch (e) { fail(res, e); }
  });

  app.get('/debug/background/:n', auth.requireLogin, async (req, res) => {
    try {
      const img = (await db.getBackgrounds(set()))[pageOf(req.params.n).n];
      if (!img) return res.status(404).type('text').send('not drawn');
      res.type('jpeg').send(img);
    } catch (e) { fail(res, e, 404); }
  });

  // Redraws the background (with the generic Jack) and finds his head again.
  app.post('/debug/redraw/:n', auth.requireLogin, async (req, res) => {
    try {
      const page = pageOf(req.params.n);
      const opts = { draft: req.query.draft === '1' };
      const img = await redrawBackground(client, book, page, await ensureSheets(client, book, opts), opts);
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
      await redrawSheet(client, book, req.params.name, { draft: req.query.draft === '1' });
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
  app.post('/debug/head/:n/clear', auth.requireLogin, async (req, res) => {
    try { await db.deleteHead(set(), pageOf(req.params.n).n); res.type('text').send('ok'); } catch (e) { fail(res, e); }
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
      const box = { x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h), manual: true };
      if (['x', 'y', 'w', 'h'].some((k) => !(box[k] >= 0 && box[k] <= 1)) || box.w === 0 || box.h === 0) {
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
