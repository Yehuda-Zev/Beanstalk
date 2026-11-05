require('dotenv').config();

const REQUIRED_ENV = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'BASE_URL'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error('Missing environment variables: ' + missingEnv.join(', '));
  process.exit(1);
}
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const sharp = require('sharp');
const { toFile } = require('openai');
const rateLimit = require('express-rate-limit');

const story = require('./lib/story');
const { buildPdf } = require('./lib/pdf');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { log, logError } = require('./lib/log');

const app = express();
app.set('trust proxy', 1); // needed on Render so limits are per visitor, not per proxy

const userLimiter = rateLimit({
  keyGenerator: (req) => 'user:' + req.session.user.id,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  skipFailedRequests: true,
  legacyHeaders: false,
  message: { error: 'Limit reached: 3 books per hour. Try again later.' },
});

const DAILY_CAP = 30;
let dailyCount = 0;
let dailyDate = new Date().toDateString();
function dailyCapReached() {
  const today = new Date().toDateString();
  if (today !== dailyDate) { dailyDate = today; dailyCount = 0; }
  return dailyCount >= DAILY_CAP;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const client = new OpenAI();
const MODEL = 'gpt-image-2';
const QUALITY = process.env.IMAGE_QUALITY || 'low';
// Jack's character sheet is the likeness anchor for every page, so it gets better quality.
const JACK_SHEET_QUALITY = process.env.JACK_SHEET_QUALITY || 'medium';

app.use(express.static('public', { extensions: ['html'] })); // serves /privacy -> privacy.html

auth.setup(app);

app.use((req, res, next) => {
  if (req.path.startsWith('/status/')) return next(); // polled every 3s, too noisy
  const start = Date.now();
  res.on('finish', () =>
    log('request', {
      method: req.method, path: req.path, status: res.statusCode,
      ms: Date.now() - start, ip: req.ip, userId: req.session && req.session.user ? req.session.user.id : null,
    })
  );
  next();
});

// Upright (phone photos carry a rotation flag) and at most 1024px on the long side.
async function shrink(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

const png = (buffer) => ({ buffer, mime: 'image/png' });

// Image edit with one or more reference images. Order matters: Image 1, Image 2, ...
async function edit(inputs, prompt, quality = QUALITY) {
  const image = await Promise.all(
    inputs.map((x, i) => toFile(x.buffer, `input${i}.png`, { type: x.mime }))
  );
  const res = await client.images.edit({
    model: MODEL, image, prompt, size: '1024x1024', quality,
  });
  return Buffer.from(res.data[0].b64_json, 'base64');
}

// Text-only generation, used for side-character sheets.
async function generate(prompt) {
  const res = await client.images.generate({
    model: MODEL, prompt, size: '1024x1024', quality: QUALITY,
  });
  return Buffer.from(res.data[0].b64_json, 'base64');
}

// ---------- the pipeline ----------
// A short written description of the face in the photo, shown to the user next to Jack's picture.
// It is NOT fed into the image prompts. Failure here never blocks the book.
const FACE_MODEL = process.env.FACE_MODEL || 'gpt-4o-mini';
async function describeFace(photoBuffer) {
  try {
    const res = await client.chat.completions.create({
      model: FACE_MODEL,
      max_tokens: 160,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'List the visible facial features of the child in this photo as short bullet points, one per line starting with "- ": face shape, eyes (shape, colour, spacing), eyebrows, nose, mouth and lips, hair (colour, length, style), skin tone, and any glasses or freckles. Describe only what is visible. Do not guess identity, name, or anything else. Under 70 words.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + photoBuffer.toString('base64') } },
        ],
      }],
    });
    return (res.choices[0].message.content || '').trim().slice(0, 700);
  } catch (e) {
    logError('describe_face_failed', e);
    return null;
  }
}

// Phase 1: draw Jack from the photo. The user checks this picture before anything else is drawn.
async function makeJackSheet(photoBuffer) {
  return edit([png(photoBuffer)], story.jackSheetPrompt(), JACK_SHEET_QUALITY);
}

// Phase 2 (after approval): the other characters, then the pages, then the PDF.
async function makePages(photoBuffer, sheetBuffer, about, onProgress) {
  const photo = png(photoBuffer);
  const jack = png(sheetBuffer);

  onProgress('Drawing the other characters...');
  const keys = Object.keys(story.CHARACTERS);
  const sideSheets = await Promise.all(keys.map((k) => generate(story.sideSheetPrompt(k))));
  const sheets = Object.fromEntries(keys.map((k, i) => [k, png(sideSheets[i])]));

  // Every page call gets: photo, Jack sheet, then that page's side sheets. Pages run in parallel.
  onProgress(`Painting the pages... (0/${story.PAGES.length})`);
  let done = 0;
  const art = await Promise.all(
    story.PAGES.map(async (page) => {
      const refs = [photo, jack, ...page.refs.map((k) => sheets[k])];
      const img = await edit(refs, story.pagePrompt(page), page.quality || QUALITY);
      onProgress(`Painting the pages... (${++done}/${story.PAGES.length})`);
      return img;
    })
  );

  // The PDF layer draws the text.
  onProgress('Building your book...');
  const jpgs = await Promise.all(art.map((b) => sharp(b).jpeg({ quality: 88 }).toBuffer()));
  return buildPdf(
    story.PAGES.map((p, i) => ({ image: jpgs[i], caption: p.caption, textZone: p.textZone })),
    about
  );
}

// ---------- books ----------
// Everything lives in Postgres. Only the progress text lives in memory.
const progress = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REDRAWS = 2;
const REVIEW_EXPIRY_MINUTES = 60;

function runSheet(id, userId, photoBuffer) {
  const started = Date.now();
  progress.set(id, 'Drawing the character...');
  Promise.all([makeJackSheet(photoBuffer), describeFace(photoBuffer)])
    .then(async ([sheet, faceNotes]) => {
      await db.setSheet(id, sheet, faceNotes);
      log('sheet_done', { userId, bookId: id, ms: Date.now() - started });
    })
    .catch(async (e) => {
      logError('sheet_failed', e, { userId, bookId: id });
      await db.failBook(id, 'Drawing the character failed. Please try again.').catch((e2) => logError('fail_book_failed', e2));
    })
    .finally(() => progress.delete(id));
}

function runPages(id, userId, row) {
  const started = Date.now();
  progress.set(id, 'Starting...');
  makePages(row.photo, row.sheet, row.about, (m) => progress.set(id, m))
    .then(async (pdf) => {
      await db.finishBook(id, pdf);
      log('generate_done', { userId, bookId: id, ms: Date.now() - started, bytes: pdf.length });
    })
    .catch(async (e) => {
      logError('generate_failed', e, { userId, bookId: id, ms: Date.now() - started });
      await db.failBook(id, 'Generation failed. Please try again.').catch((e2) => logError('fail_book_failed', e2));
    })
    .finally(() => progress.delete(id));
}

app.post('/generate', auth.requireLogin, upload.single('photo'), userLimiter, async (req, res) => {
  const userId = req.session.user.id;
  if (!req.file) return res.status(400).json({ error: 'Please upload a JPG, PNG, or WebP image.' });
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Please enter the child's name." });
  if (dailyCapReached()) return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });

  let photoBuffer;
  try { photoBuffer = await shrink(req.file.buffer); }
  catch { return res.status(400).json({ error: 'That file is not a valid image.' }); }
  dailyCount++;

  const clean = (v, n) => String(v || '').trim().slice(0, n);
  const about = {
    name,
    details: {
      Age: clean(req.body.age, 20),
      'Favorite thing': clean(req.body.favorite, 120),
      'Best friend': clean(req.body.friend, 80),
      'When I grow up': clean(req.body.dream, 120),
      'More about me': clean(req.body.more, 300),
    },
  };

  const id = crypto.randomUUID();
  await db.createBook({ id, userId, childName: name, about, photo: photoBuffer });
  log('generate_start', { userId, bookId: id });
  runSheet(id, userId, photoBuffer);
  res.json({ id });
});

// The user's own character picture, shown for approval. Never cached.
app.get('/sheet/:id', auth.requireLogin, async (req, res) => {
  const { id } = req.params;
  const sheet = UUID.test(id) ? await db.getSheet(id, req.session.user.id) : null;
  if (!sheet) return res.status(404).send('Not ready.');
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  res.send(sheet);
});

app.post('/books/:id/redraw', auth.requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  if (!UUID.test(id)) return res.status(404).json({ error: 'Unknown book.' });
  if (dailyCapReached()) return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });
  const row = await db.startRedraw(id, userId, MAX_REDRAWS);
  if (!row) return res.status(409).json({ error: 'No redraws left, or this book is not waiting for approval.' });
  dailyCount++;
  log('redraw', { userId, bookId: id });
  runSheet(id, userId, row.photo);
  res.json({ ok: true });
});

app.post('/books/:id/approve', auth.requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  if (!UUID.test(id)) return res.status(404).json({ error: 'Unknown book.' });
  const row = await db.startApprove(id, userId);
  if (!row) return res.status(409).json({ error: 'This book is not waiting for approval.' });
  log('approve', { userId, bookId: id });
  runPages(id, userId, row);
  res.json({ ok: true });
});

app.get('/api/books', auth.requireLogin, async (req, res) => {
  const books = await db.listBooks(req.session.user.id);
  res.json({
    books: books.map((b) => ({
      id: b.id, childName: b.child_name, status: b.status, error: b.error, createdAt: b.created_at,
    })),
  });
});

app.get('/status/:id', auth.requireLogin, async (req, res) => {
  const { id } = req.params;
  const book = UUID.test(id) ? await db.getBook(id, req.session.user.id) : null;
  if (!book) return res.status(404).json({ error: 'Unknown book.' });
  const working = book.status === 'sheet' || book.status === 'working';
  res.json({
    status: book.status,
    childName: book.child_name,
    redrawsLeft: Math.max(0, MAX_REDRAWS - book.redraws),
    message: working ? progress.get(id) || 'Working...' : book.status === 'done' ? 'Done!' : '',
    error: book.error,
    faceNotes: book.status === 'review' ? book.face_notes : null,
  });
});

app.get('/download/:id', auth.requireLogin, async (req, res) => {
  const { id } = req.params;
  const pdf = UUID.test(id) ? await db.getPdf(id, req.session.user.id) : null;
  if (!pdf) return res.status(404).send('Not ready.');
  log('download', { userId: req.session.user.id, bookId: id });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="JackAndTheBeanstalk.pdf"',
  });
  res.send(pdf);
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Photo too large (8MB max).' });
  if (err.name === 'MulterError') return res.status(400).json({ error: 'Upload failed.' });
  logError('unhandled', err, { path: req.path });
  res.status(500).json({ error: 'Something went wrong.' });
});

const port = process.env.PORT || 3000;
(async () => {
  await db.init();
  const n = await db.failInterrupted();
  if (n) log('interrupted_books_marked', { count: n });
  const sweep = async () => {
    const x = await db.expireStaleReviews(REVIEW_EXPIRY_MINUTES);
    if (x) log('stale_reviews_expired', { count: x });
  };
  await sweep();
  setInterval(() => sweep().catch((e) => logError('sweep_failed', e)), 10 * 60 * 1000).unref();
  app.listen(port, () => log('listening', { port }));
})().catch((e) => {
  logError('startup_failed', e);
  process.exit(1);
});
