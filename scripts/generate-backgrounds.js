// Generates the background image for every page of a book, once, and saves each to the database.
// Run it with DATABASE_URL and OPENAI_API_KEY in your environment (or .env):
//   node scripts/generate-backgrounds.js beanstalk
// Each background has the fixed side characters (mother, old man, cow) but no Jack.
// Pages that already have a background are skipped, so a second run costs nothing.

require('dotenv').config();
const OpenAI = require('openai');
const sharp = require('sharp');

const story = require('../lib/story');
const template = require('../lib/template');
const db = require('../lib/db');

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

async function main() {
  const bookName = process.argv[2];
  if (!bookName) throw new Error('Usage: node scripts/generate-backgrounds.js <book>');
  const book = require(`../lib/books/${bookName}`);

  const problems = template.validateBook(book);
  if (problems.length) throw new Error(`Book is not valid:\n${problems.join('\n')}`);

  await db.init();
  const client = new OpenAI(); // reads OPENAI_API_KEY
  const existing = await db.getBackgrounds(book.id);

  for (const page of book.pages) {
    if (existing[page.n]) {
      console.log(`page ${page.n}: already stored, skipped`);
      continue;
    }
    const res = await client.images.generate({
      model: MODEL, prompt: backgroundPrompt(page), size: '1024x1024', quality: QUALITY,
    });
    const png = Buffer.from(res.data[0].b64_json, 'base64');
    const jpg = await sharp(png).resize(template.SIZE, template.SIZE).jpeg({ quality: 88 }).toBuffer();
    await db.saveBackground(book.id, page.n, jpg);
    console.log(`page ${page.n}: stored`);
  }

  console.log(`done: ${book.pages.length} pages for ${book.id}`);
  await db.pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await db.pool.end().catch(() => {});
  process.exit(1);
});
