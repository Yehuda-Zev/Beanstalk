// Optional: fills in every background for a book now, instead of waiting for the first book to need them.
// The server also fills missing backgrounds on demand, so this is only needed to pre-warm.
//   node scripts/generate-backgrounds.js beanstalk   (needs DATABASE_URL and OPENAI_API_KEY)

require('dotenv').config();
const OpenAI = require('openai');

const template = require('../lib/template');
const db = require('../lib/db');
const { makeBackground } = require('../lib/background');

async function main() {
  const bookName = process.argv[2];
  if (!bookName) throw new Error('Usage: node scripts/generate-backgrounds.js <book>');
  const book = require(`../lib/books/${bookName}`);

  const problems = template.validateBook(book);
  if (problems.length) throw new Error(`Book is not valid:\n${problems.join('\n')}`);

  await db.init();
  const client = new OpenAI();
  const existing = await db.getBackgrounds(book.id);
  for (const page of book.pages) {
    if (existing[page.n]) {
      console.log(`page ${page.n}: already stored, skipped`);
      continue;
    }
    await makeBackground(client, book.id, page);
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
