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

async function shrink(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
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
async function makeBook(photoBuffer, about, onProgress) {
  const photo = png(photoBuffer);

  // Step 1: character sheets, once per book, in parallel.
  onProgress('Drawing the characters...');
  const keys = Object.keys(story.CHARACTERS);
  const [jackSheet, ...sideSheets] = await Promise.all([
    edit([photo], story.jackSheetPrompt()),
    ...keys.map((k) => generate(story.sideSheetPrompt(k))),
  ]);
  const sheets = Object.fromEntries(keys.map((k, i) => [k, png(sideSheets[i])]));
  const jack = png(jackSheet);

  // Step 2: pages, in parallel. Every call gets: photo, Jack sheet, then that page's side sheets.
  onProgress('Painting the pages...');
  let done = 0;
  const art = await Promise.all(
    story.PAGES.map(async (page) => {
      const refs = [photo, jack, ...page.refs.map((k) => sheets[k])];
      const img = await edit(refs, story.pagePrompt(page), page.quality || QUALITY);
      onProgress(`Painting the pages... (${++done}/${story.PAGES.length})`);
      return img;
    })
  );

  // Step 3: PDF layer draws the text.
  onProgress('Building your book...');
  const jpgs = await Promise.all(art.map((b) => sharp(b).jpeg({ quality: 88 }).toBuffer()));
  return buildPdf(
    story.PAGES.map((p, i) => ({ image: jpgs[i], caption: p.caption, textZone: p.textZone })),
    about
  );
}

// ---------- books ----------
// Finished books live in Postgres. Only the progress text lives in memory.
const progress = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  await db.createBook({ id, userId, childName: name });
  progress.set(id, 'Starting...');
  const started = Date.now();
  log('generate_start', { userId, bookId: id });

  makeBook(photoBuffer, about, (m) => progress.set(id, m))
    .then(async (pdf) => {
      await db.finishBook(id, pdf);
      log('generate_done', { userId, bookId: id, ms: Date.now() - started, bytes: pdf.length });
    })
    .catch(async (e) => {
      logError('generate_failed', e, { userId, bookId: id, ms: Date.now() - started });
      await db.failBook(id, 'Generation failed. Please try again.').catch((e2) => logError('fail_book_failed', e2));
    })
    .finally(() => progress.delete(id));

  res.json({ id });
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
  res.json({
    status: book.status,
    message: book.status === 'working' ? progress.get(id) || 'Working...' : book.status === 'done' ? 'Done!' : '',
    error: book.error,
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
  app.listen(port, () => log('listening', { port }));
})().catch((e) => {
  logError('startup_failed', e);
  process.exit(1);
});
