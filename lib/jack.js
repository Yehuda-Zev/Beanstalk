// Draws Jack alone for one page, then places him on that page's background.
// Only Jack is drawn per user. The background, and every other character on it, never changes.
// Jack's prompt comes from the character bible (lib/bible.js).

const sharp = require('sharp');
const { toFile } = require('openai');
const template = require('./template');
const { jackPrompt } = require('./bible');

const MODEL = 'gpt-image-2';
const JACK_QUALITY = process.env.JACK_QUALITY || 'medium';

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

// Puts Jack's picture on the background so his feet (or, lying, his body) rest on the page's line.
// Returns a JPEG page.
async function placeJack(background, jackPng, page) {
  const rect = template.jackRect(page);
  const fit = template.isLying(page)
    ? { width: Math.round(template.SIZE * 0.7), height: rect.h, fit: 'inside' }
    : { height: rect.h };
  const jack = await sharp(jackPng).resize(fit).png().toBuffer();
  const { width, height } = await sharp(jack).metadata();
  return sharp(background)
    .composite([{ input: jack, left: Math.round(template.SIZE / 2 - width / 2), top: rect.feetY - height }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { makeJack, placeJack, removeGreen };
