// Makes one page background and stores it. Used by the server when a background is missing,
// and by scripts/generate-backgrounds.js. A background has the fixed side characters but no Jack.

const sharp = require('sharp');
const story = require('./story');
const template = require('./template');
const db = require('./db');

const MODEL = 'gpt-image-2';
const QUALITY = process.env.IMAGE_QUALITY || 'low';

function backgroundPrompt(page) {
  const sides = page.characters.map((k) => `${story.CHARACTERS[k].label}: ${story.CHARACTERS[k].desc}.`);
  const who = sides.length
    ? `Draw these characters fully, in the scene: ${sides.join(' ')}`
    : 'Draw no people or animals unless the scene names them.';
  return `Storybook background, full-bleed square page. Scene: ${page.scene}
${who}
Do not draw a child named Jack. Keep the ${page.textZone} third of the picture quiet and uncluttered so text can go there. Keep every character's face in the middle third of the picture.
Style: ${story.STYLE}
Avoid: any text, letters, watermarks, split panels.`;
}

// Generates the background for one page and stores it for every future book.
async function makeBackground(client, bookId, page) {
  const res = await client.images.generate({
    model: MODEL, prompt: backgroundPrompt(page), size: '1024x1024', quality: QUALITY,
  });
  const png = Buffer.from(res.data[0].b64_json, 'base64');
  const jpg = await sharp(png).resize(template.SIZE, template.SIZE).jpeg({ quality: 88 }).toBuffer();
  await db.saveBackground(bookId, page.n, jpg);
  return jpg;
}

module.exports = { backgroundPrompt, makeBackground };
