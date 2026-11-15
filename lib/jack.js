// Draws Jack alone for one page, then places him on that page's background.
// Only Jack is drawn per user. The background, and every other character on it, never changes.

const sharp = require('sharp');
const { toFile } = require('openai');
const template = require('./template');

const MODEL = 'gpt-image-2';
const JACK_QUALITY = process.env.JACK_QUALITY || 'medium';

function jackPrompt(page) {
  return [
    'Draw the child from the reference, alone, full body, standing or posed as described. Same face, hair, beard, glasses and clothes as the reference (brown vest over a white shirt, green trousers, brown boots).',
    `Pose: ${page.jack.pose}.`,
    `Facing: ${page.jack.facing}. He must face this way, not the viewer, unless the facing says toward the viewer.`,
    `Expression: ${page.jack.expression}. The face must clearly show this expression.`,
    'Background: a plain, flat, pure green (#00FF00) backdrop filling the whole picture, with no shadow or floor on it. Modern 3D animated feature film look, soft rim light. No other people, no text.',
  ].join('\n');
}

// Makes the green backdrop transparent. Jack's clothes are darker olive green, so they are kept.
async function removeGreen(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (g > 140 && g - r > 60 && g - b > 60) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Returns a PNG of Jack with a transparent background.
async function makeJack(client, jackSheet, page) {
  const res = await client.images.edit({
    model: MODEL,
    image: [await toFile(jackSheet, 'jack.png', { type: 'image/png' })],
    prompt: jackPrompt(page),
    size: '1024x1024',
    quality: JACK_QUALITY,
  });
  const png = Buffer.from(res.data[0].b64_json, 'base64');
  return removeGreen(png);
}

// Puts Jack's picture on the background at the page's fixed spot. Returns a JPEG page.
async function placeJack(background, jackPng, page) {
  const rect = template.jackRect(page);
  const jack = await sharp(jackPng).resize({ height: rect.h }).png().toBuffer();
  const { width } = await sharp(jack).metadata();
  return sharp(background)
    .composite([{ input: jack, left: Math.round(template.SIZE / 2 - width / 2), top: rect.y }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { jackPrompt, makeJack, placeJack, removeGreen };
