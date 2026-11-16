// Draws Jack alone for one page, then places him on that page's background.
// Only Jack is drawn per user. The background, and every other character on it, never changes.
// Jack's prompt comes from the character bible (lib/bible.js).

const sharp = require('sharp');
const { toFile } = require('openai');
const template = require('./template');
const { jackPrompt } = require('./bible');

const MODEL = 'gpt-image-2';
const JACK_QUALITY = process.env.JACK_QUALITY || 'medium';

// Makes the green backdrop transparent, then crops to Jack's visible pixels.
// The crop matters: the drawn picture has empty space below his feet, which would
// otherwise push him above the floor line.
async function removeGreen(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (g > 140 && g - r > 60 && g - b > 60) {
        data[i + 3] = 0;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('Jack was not found in the drawing.');
  return sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

// Returns a PNG of Jack with a transparent background, cropped to his body.
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

// A soft shadow under Jack's feet, so he reads as standing on the floor.
async function contactShadow(width, feetY) {
  const S = template.SIZE;
  const rx = Math.max(12, Math.round(width * 0.42));
  const ry = Math.max(6, Math.round(rx * 0.12));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs><radialGradient id="g"><stop offset="0" stop-color="black" stop-opacity="0.45"/><stop offset="1" stop-color="black" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${S / 2}" cy="${feetY}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Puts Jack's picture on the background with his feet on the page's line.
// Returns a JPEG page.
async function placeJack(background, jackPng, page) {
  const S = template.SIZE;
  const rect = template.jackRect(page);
  const fit = template.isLying(page)
    ? { width: Math.round(S * 0.7), height: rect.h, fit: 'inside' }
    : { height: rect.h };
  const jack = await sharp(jackPng).resize(fit).png().toBuffer();
  const { width, height } = await sharp(jack).metadata();
  const shadow = await contactShadow(width, rect.feetY);
  return sharp(background)
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: jack, left: Math.round(S / 2 - width / 2), top: rect.feetY - height },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { makeJack, placeJack, removeGreen };
