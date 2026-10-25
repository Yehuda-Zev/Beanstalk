require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const sharp = require('sharp');
const { toFile } = require('openai');

const app = express();
const rateLimit = require('express-rate-limit');

app.set('trust proxy', 1); // needed on Render so limits are per visitor, not per proxy

const ipLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  skipFailedRequests: true,
  legacyHeaders: false,
  message: { error: 'Limit reached: 3 generations per hour. Try again later.' },
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

app.use(express.static('public'));

async function shrink(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}
const COSTUME = 'Jack wears a brown vest over a white shirt, green trousers, and brown boots.';

const SCENE_1 = 'Jack kneels in a farmyard at sunrise, pressing magic beans into a small hole in the soil, with a watering can beside him and a cottage behind him.';
const SCENE_2 = 'Jack climbs a giant beanstalk with thick green vines and huge leaves, gripping the stalk with both hands, with clouds and a distant castle above him.';

function styleFor(n) {
  if (n <= 2) return 'a lightly illustrated portrait, nearly photorealistic, with subtle painterly smoothing';
  if (n <= 4) return 'a semi-realistic storybook illustration, painterly, natural face proportions';
  if (n <= 6) return 'a stylized storybook illustration with clean shapes, simplified details, and soft shading';
  if (n <= 8) return 'a bold hand-drawn cartoon with clear ink outlines, flat colors, and simplified features';
  return 'an exaggerated cartoon caricature with thick outlines, flat bright colors, and big simplified shapes';
}

function cartoonPrompt(n) {
  return `Edit: redraw the person in this photo as ${styleFor(n)}.
Keep unchanged: face shape, eye spacing, nose, mouth, hairstyle, hair color, skin tone, age, glasses, and all facial hair.
Background: plain light, head and shoulders.
Avoid: text, watermarks, beautifying or slimming the face.`;
}

function scenePrompt(scene, n) {
  return `Scene: ${scene}
Subject: the character in Image 2, with the facial features of the person in Image 1. Use Image 1 only to match facial structure; do not copy its pixels, lighting, or photographic texture. ${COSTUME}
Style: ${styleFor(n)}. Draw the face in the same illustrated style as the body and background: same linework, brushwork, and shading. It must not look like a photo or a cut-out. Match Image 2's palette and art style.
Avoid: text, watermarks, extra people, split panels.`;
}

async function edit(inputs, prompt) {
  const image = await Promise.all(
    inputs.map((x, i) => toFile(x.buffer, `input${i}.png`, { type: x.mime }))
  );
  const res = await client.images.edit({
    model: MODEL, image, prompt, size: '1024x1024',
    quality: 'low'
  });
  return Buffer.from(res.data[0].b64_json, 'base64');
}

app.post('/generate', ipLimiter, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a JPG, PNG, or WebP image.' });
    if (dailyCapReached()) return res.status(429).json({ error: 'Daily limit reached. Try again tomorrow.' });
    const intensity = Math.min(10, Math.max(1, parseInt(req.body.intensity) || 6));

    let photoBuffer;
    try { photoBuffer = await shrink(req.file.buffer); }
    catch { return res.status(400).json({ error: 'That file is not a valid image.' }); }
    dailyCount++;

    const photo = { buffer: photoBuffer, mime: 'image/png' };
    const cartoon = { buffer: await edit([photo], cartoonPrompt(intensity)), mime: 'image/png' };
    const img1 = await edit([photo, cartoon], scenePrompt(SCENE_1, intensity));
    const img2 = await edit([photo, cartoon], scenePrompt(SCENE_2, intensity));

    res.json({
      scenes: [
        { caption: SCENE_1, image: 'data:image/png;base64,' + img1.toString('base64') },
        { caption: SCENE_2, image: 'data:image/png;base64,' + img2.toString('base64') },
      ],
    });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Generation failed.' });
  }
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo too large (8MB max).' : 'Upload failed.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Listening on ' + port));