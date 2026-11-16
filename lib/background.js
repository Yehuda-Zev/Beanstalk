// Backgrounds for a book. Every background is drawn from the same reference sheets, one per
// side character, so the mother, the old man and the cow look the same on every page.
// A background has the side characters and a generic Jack. Each child's face is swapped onto him later.

const sharp = require('sharp');
const { toFile } = require('openai');
const story = require('./story');
const template = require('./template');
const db = require('./db');
const bible = require('./bible');
const { detectHead } = require('./jack');

// Backgrounds and side-character sheets are drawn once and shared by every book,
// so they use the most careful model and a high quality setting. Speed does not matter here.
const MODEL = process.env.BACKGROUND_MODEL || 'gpt-image-2.5-sunburst';
const QUALITY = process.env.BACKGROUND_QUALITY || 'high';
const SHEET_QUALITY = process.env.SHEET_QUALITY || 'high';

// Draft mode (debug only): a fast model at low quality, for trying prompts quickly.
const DRAFT = { model: process.env.DRAFT_MODEL || 'gpt-image-2.5-flare', quality: 'low' };
const look = (opts = {}, quality) => (opts.draft ? DRAFT : { model: MODEL, quality });

// The same look on every page. Repeated word-for-word in every prompt.
const LOOK =
  'Modern 3D animated feature film look. Soft warm morning light from the upper left, soft rim light, ' +
  'one consistent warm colour palette. Eye-level camera, no dramatic angles, no close-ups. Full-bleed square picture. Natural, neutral faces; no default smiles.';

const AVOID = 'Avoid: any text, letters, watermarks, split panels, any person or animal not listed, and any character who is not part of the scene.';

// Background sets are versioned so a new version never reuses old pictures.
function setKey(book) {
  return `${book.id}:v${book.backgroundVersion}`;
}

const jpeg = (png) => sharp(png).resize(template.SIZE, template.SIZE).jpeg({ quality: 88 }).toBuffer();

// One reference sheet per side character for the whole set. Made once, then reused.
async function ensureSheets(client, book, opts = {}) {
  const key = setKey(book);
  const sheets = await db.getReferenceSheets(key);
  const edits = await db.getOverrides(book.id);
  const names = characterNames(book);
  for (const name of names) {
    if (sheets[name]) continue;
    const res = await client.images.generate({
      ...look(opts, SHEET_QUALITY), prompt: story.sideSheetPrompt(name, edits['char:' + name]), size: '1024x1024',
    });
    const img = await jpeg(Buffer.from(res.data[0].b64_json, 'base64'));
    await db.saveReferenceSheet(key, name, img);
    sheets[name] = img;
  }
  return sheets;
}

// Everyone with a reference sheet: Jack first, then the side characters.
function characterNames(book) {
  return ['jack', ...new Set(book.pages.flatMap((p) => p.characters))];
}

// Sheets sent with a page, in this order: Image 1, Image 2, and so on.
const pageRefs = (page) => ['jack', ...page.characters];

// The line added to a page's prompt when its head box was set by hand.
function headLine(box) {
  if (!box || !box.manual) return '';
  const pct = (v) => Math.round(v * 100);
  return `Jack's head must be exactly here: its centre about ${pct(box.x + box.w / 2)}% from the left edge and ${pct(box.y + box.h / 2)}% from the top of the picture, and his head is about ${pct(box.h)}% of the picture tall. Size and place the rest of him to match.`;
}

function backgroundPrompt(page) {
  const lines = pageRefs(page).map(
    (name, i) =>
      `Image ${i + 1} is the reference for ${story.CHARACTERS[name].label}. Draw ${story.CHARACTERS[name].label} exactly as in that reference: same face, body, colours and clothes.`
  );
  return [
    `Storybook background. Scene: ${page.scene}`,
    ...(page.beans ? ['Bean count (critical): the picture holds exactly five beans in total, never more. One red, one orange, one yellow, one blue, one purple. No pile of beans, no extra beans on the ground or in the air.'] : []),
    `The only people in the picture are: ${['Jack', ...page.characters.map((n) => story.CHARACTERS[n].label)].join(', ')}. Nobody else.`,
    bible.jackLine(page),
    ...lines,
    `Keep the ${page.textZone} third of the picture quiet and uncluttered for text.`,
    `The floor where the characters stand meets the picture at ${Math.round(template.JACK_PLACEMENT[page.textZone].feetY * 100)}% of the way down. Keep the room floor and wall lines consistent with that.`,
    ...(template.isLying(page) ? [`A bed stands in the picture with its mattress top at ${Math.round(template.JACK_PLACEMENT.lying.feetY * 100)}% of the way down. Keep the bed level with that line.`] : []),
    `Look: ${LOOK}`,
    AVOID,
  ].join('\n');
}

// Draws one page background and stores it. `sheets` comes from ensureSheets.
async function makeBackground(client, book, page, sheets, opts = {}) {
  // An edited prompt from the debug page wins over the one built from the book.
  const box = (await db.getHeads(setKey(book)))[page.n];
  const base = (await db.getOverrides(book.id))['page:' + page.n] || backgroundPrompt(page);
  const prompt = [base, headLine(box)].filter(Boolean).join('\n');
  const image = [
    ...(await Promise.all(pageRefs(page).map((name, i) => toFile(sheets[name], `ref${i}.jpg`, { type: 'image/jpeg' })))),
  ];
  const res = await client.images.edit({ ...look(opts, QUALITY), image, prompt, size: '1024x1024' });
  const img = await jpeg(Buffer.from(res.data[0].b64_json, 'base64'));
  if (opts.overwrite) await db.replaceBackground(setKey(book), page.n, img);
  else await db.saveBackground(setKey(book), page.n, img);
  // Find Jack's head, so the face swap knows where to work. It can be corrected by hand in debug.
  // A box set by hand is kept; otherwise find his head.
  if (box && box.manual) return img;
  try {
    await db.saveHead(setKey(book), page.n, await detectHead(client, img));
  } catch (e) {
    console.error(`Head not found on page ${page.n}: ${e.message}`);
  }
  return img;
}

async function redrawBackground(client, book, page, sheets, opts = {}) {
  const img = await makeBackground(client, book, page, sheets, { ...opts, overwrite: true });
  return img;
}

// Draws one character's reference sheet again and replaces the stored one. Debug only.
async function redrawSheet(client, book, name, opts = {}) {
  const res = await client.images.generate({
    ...look(opts, SHEET_QUALITY), prompt: story.sideSheetPrompt(name, (await db.getOverrides(book.id))['char:' + name]), size: '1024x1024',
  });
  const img = await jpeg(Buffer.from(res.data[0].b64_json, 'base64'));
  await db.replaceReferenceSheet(setKey(book), name, img);
  return img;
}

module.exports = { headLine, characterNames, setKey, ensureSheets, makeBackground, redrawBackground, redrawSheet, backgroundPrompt };
