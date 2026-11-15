// Generates the 20 background images for a book, once. Run it locally with your .env:
//   node scripts/generate-backgrounds.js beanstalk
// Each page's background has the fixed side characters (mother, old man, cow) but no Jack.
// Existing files are skipped, so a second run costs nothing.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const sharp = require('sharp');

const story = require('../lib/story');
const template = require('../lib/template');

const MODEL = 'gpt-image-2';
const QUALITY = process.env.IMAGE_QUALITY || 'low';

function backgroundPrompt(page) {
  const sides = page.characters.map((k) => `${story.CHARACTERS[k].label}: ${story.CHARACTERS[k].desc}.`);
  const who = sides.length
    ? `Draw these characters fully, in the scene: ${sides.join(' ')}`
    : 'Draw no people or animals unless the scene names them.';
  const quiet = page.textZone === 'top' ? 'top' : 'bottom';
  return `Storybook background, full-bleed square page. Scene: ${page.scene}
${who}
Do not draw a child named Jack. Keep the ${quiet} third of the picture quiet and uncluttered so text can go there. Keep every character's face in the middle third of the picture.
Style: ${story.STYLE}
Avoid: any text, letters, watermarks, split panels.`;
}

async function generateOne(client, prompt) {
  const res = await client.images.generate({ model: MODEL, prompt, size: '1024x1024', quality: QUALITY });
  return Buffer.from(res.data[0].b64_json, 'base64');
}

async function main() {
  const bookName = process.argv[2];
  if (!bookName) throw new Error('Usage: node scripts/generate-backgrounds.js <book>');
  const book = require(`../lib/books/${bookName}`);

  const problems = template.validateBook(book);
  if (problems.length) throw new Error(`Book is not valid:\n${problems.join('\n')}`);

  const client = new OpenAI(); // reads OPENAI_API_KEY from .env
  const outDir = path.join(__dirname, '..', 'out', 'backgrounds', book.id);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const page of book.pages) {
    const file = path.join(outDir, `page-${String(page.n).padStart(2, '0')}.jpg`);
    if (fs.existsSync(file)) {
      console.log(`page ${page.n}: exists, skipped`);
      manifest.push({ page: page.n, file, attempts: 0, skipped: true });
      continue;
    }
    const png = await generateOne(client, backgroundPrompt(page));
    const jpg = await sharp(png).resize(template.SIZE, template.SIZE).jpeg({ quality: 88 }).toBuffer();
    fs.writeFileSync(file, jpg);
    console.log(`page ${page.n}: saved`);
    manifest.push({ page: page.n, file, attempts: 1 });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`done: ${manifest.length} pages in ${outDir}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
