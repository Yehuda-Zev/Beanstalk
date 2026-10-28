require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const sharp = require('sharp');
const { toFile } = require('openai');
const rateLimit = require('express-rate-limit');

const story = require('./lib/story');
const { buildPdf } = require('./lib/pdf');

const app = express();
app.set('trust proxy', 1); // needed on Render so limits are per visitor, not per proxy

const ipLimiter = rateLimit({
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

app.use(express.static('public'));

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
  return buildPdf(
    story.PAGES.map((p, i) => ({ image: art[i], caption: p.caption, textZone: p.textZone })),
    about
  );
}

// ---------- password gate ----------
const GENERATOR_PASSWORD = process.env.GENERATOR_PASSWORD;
if (!GENERATOR_PASSWORD) console.warn('GENERATOR_PASSWORD is not set: generation is disabled.');

function passwordOk(given) {
  if (!GENERATOR_PASSWORD) return false; // fail closed
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(GENERATOR_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Slows password guessing: 10 wrong attempts per IP per 15 minutes.
const wrongPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  legacyHeaders: false,
  standardHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: 'Too many wrong passwords. Try again later.' },
});

function requirePassword(req, res, next) {
  if (passwordOk(req.body && req.body.password)) return next();
  res.status(401).json({ error: 'Wrong password.' });
}

// ---------- jobs (in memory; Render's request timeout is shorter than a book) ----------
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.created < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

app.post('/generate', wrongPasswordLimiter, upload.single('photo'), requirePassword, ipLimiter, async (req, res) => {
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
  const job = { status: 'working', message: 'Starting...', pdf: null, error: null, created: Date.now() };
  jobs.set(id, job);

  makeBook(photoBuffer, about, (m) => { job.message = m; })
    .then((pdf) => { job.pdf = pdf; job.status = 'done'; job.message = 'Done!'; })
    .catch((e) => {
      console.error(e.message);
      job.status = 'error';
      job.error = 'Generation failed. Please try again.';
    });

  res.json({ id });
});

app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job.' });
  res.json({ status: job.status, message: job.message, error: job.error });
});

app.get('/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).send('Not ready.');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="JackAndTheBeanstalk.pdf"',
  });
  res.send(job.pdf);
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo too large (8MB max).' : 'Upload failed.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Listening on ' + port));
