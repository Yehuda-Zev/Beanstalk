// The shared 20-page layout. Every book uses this, so layout quality is the same across books.
// A book supplies content (see lib/books/*.js); this file decides where text and faces may go.

const SIZE = 768; // square pages, points (matches lib/pdf.js)
const BAND = 0.34; // a text band is a third of the page

// Fractions of the page height. Text lives only in the top or bottom band.
// Faces must sit in the middle band, so no text can cover a face.
const ZONES = {
  top: { y: 0, h: BAND },
  bottom: { y: 1 - BAND, h: BAND },
  faces: { y: BAND, h: 1 - 2 * BAND },
};

const PAGE_COUNT = 20;
const TEXT_ZONES = ['top', 'bottom'];

// Turns a zone name into pixel rectangle on a SIZE x SIZE page.
function zoneRect(name) {
  const z = ZONES[name];
  if (!z) throw new Error(`Unknown zone: ${name}`);
  return { x: 0, y: Math.round(z.y * SIZE), w: SIZE, h: Math.round(z.h * SIZE) };
}

// Checks a book against the template. Returns a list of problems (empty = valid).
// A page marked todo is allowed to be unfinished; everything else must be complete.
function validateBook(book) {
  const problems = [];
  if (!Array.isArray(book.pages) || book.pages.length !== PAGE_COUNT) {
    problems.push(`Book needs exactly ${PAGE_COUNT} pages, has ${book.pages?.length ?? 0}.`);
    return problems;
  }
  book.pages.forEach((p, i) => {
    const n = i + 1;
    if (p.n !== n) problems.push(`Page at position ${n} is labelled ${p.n}.`);
    if (!TEXT_ZONES.includes(p.textZone)) problems.push(`Page ${n}: text zone must be top or bottom.`);
    if (!p.todo) {
      if (!p.caption) problems.push(`Page ${n}: caption missing.`);
      if (!p.scene) problems.push(`Page ${n}: scene missing.`);
    }
  });
  if (!book.about || !book.about.title) problems.push('Book needs an About Me page title.');
  return problems;
}

// Pages still marked todo, so the build can say what is unfinished.
function todoPages(book) {
  return book.pages.filter((p) => p.todo).map((p) => p.n);
}

module.exports = {
  SIZE,
  BAND,
  ZONES,
  PAGE_COUNT,
  zoneRect,
  validateBook,
  todoPages,
};
