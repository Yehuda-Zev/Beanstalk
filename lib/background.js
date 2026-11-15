// Backgrounds for a book. Every background is drawn from the same reference sheets, one per
// side character, so the mother, the old man and the cow look the same on every page.
// A background has the side characters but no Jack. Jack is added per user later.

const sharp = require('sharp');
const { toFile } = require('openai');
const story = require('./story');
const template = require('./template');
const db = require('./db');

const MODEL = 'gpt-image-2';
const QUALITY = process.env.IMAGE_QUALITY || 'low';
const SHEET_QUALITY = process.env.SHEET_QUALITY || 'medium';

// The same look on every page. Repeated word-for-word in every prompt.
const LOOK =
  'Modern 3D animated feature film look. Soft warm morning light from the upper left, soft rim light, ' +
  'one consistent warm colour palette. Eye-level camera, no dramatic angles, no close-ups. Full-bleed square picture.';

const AVOID = 'Avoid: any text, letters, watermarks, split panels, extra people or animals not listed, a child named Jack.';

// Background sets are versioned so a new version never reuses old pictures.
function setKey(book) {
  return `${book.id}:v${book.backgroundVersion}`;
}

const jpeg = (png) => sharp(png).resize(template.SIZE, template.SIZE).jpeg({ quality: 88 }).toBuffer();

// One reference sheet per side character for the whole set. Made once, then reused.
async function ensureSheets(client, book) {
  const key = setKey(book);
  const sheets = await db.getReferenceSheets(key);
  const names = [...new Set(book.pages.flatMap((p) => p.characters))];
  for (const name of names) {
    if (sheets[name]) continue;
    const res = await client.images.generate({
      model: MODEL, prompt: story.sideSheetPrompt(name), size: '1024x1024', quality: SHEET_QUALITY,
    });
    const img = await jpeg(Buffer.from(res.data[0].b64_json, 'base64'));
    await db.saveReferenceSheet(key, name, img);
    sheets[name] = img;
  }
  return sheets;
}

function backgroundPrompt(page) {
  const lines = page.characters.map(
    (name, i) =>
      `Image ${i + 1} is the reference for ${story.CHARACTERS[name].label}. Draw ${story.CHARACTERS[name].label} exactly as in that reference: same face, body, colours and clothes.`
  );
  return [
    `Storybook background. Scene: ${page.scene}`,
    ...lines,
    `Keep the ${page.textZone} third of the picture quiet and uncluttered for text.`,
    `The floor where the characters stand meets the picture at ${Math.round(template.JACK_PLACEMENT[page.textZone].feetY * 100)}% of the way down. Keep the room floor and wall lines consistent with that.`,
    `Look: ${LOOK}`,
    AVOID,
  ].join('\n');
}

// Draws one page background and stores it. `sheets` comes from ensureSheets.
async function makeBackground(client, book, page, sheets, opts = {}) {
  const prompt = backgroundPrompt(page);
  let res;
  if (page.characters.length === 0) {
    res = await client.images.generate({ model: MODEL, prompt, size: '1024x1024', quality: QUALITY });
  } else {
    const image = await Promise.all(
      page.characters.map((name, i) => toFile(sheets[name], `ref${i}.jpg`, { type: 'image/jpeg' }))
    );
    res = await client.images.edit({ model: MODEL, image, prompt, size: '1024x1024', quality: QUALITY });
  }
  const img = await jpeg(Buffer.from(res.data[0].b64_json, 'base64'));
  if (opts.overwrite) await db.replaceBackground(setKey(book), page.n, img);
  else await db.saveBackground(setKey(book), page.n, img);
  return img;
}

// Draws a new background and replaces the stored one. Only the debug Redraw button calls this.
async function redrawBackground(client, book, page, sheets) {
  const img = await makeBackground(client, book, page, sheets, { overwrite: true });
  return img;
}

module.exports = { setKey, ensureSheets, makeBackground, redrawBackground, backgroundPrompt };
