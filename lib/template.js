// The shared 20-page layout. Every book uses this, so layout quality is the same across books.
// A book supplies content (see lib/books/*.js); this file decides where text, faces and Jack go.

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

// Where Jack stands. His feet sit on a fixed line, and his height is set by the text zone,
// so his head stays in the middle band and his legs stay clear of the caption.
// Bottom captions push him up; top captions let him stand lower.
const JACK_PLACEMENT = {
  top: { feetY: 0.94, height: 0.56 },
  bottom: { feetY: 0.64, height: 0.40 },
};

// Pixel rectangle for a zone, on a SIZE x SIZE page.
function zoneRect(name) {
  const z = ZONES[name];
  if (!z) throw new Error(`Unknown zone: ${name}`);
  return { x: 0, y: Math.round(z.y * SIZE), w: SIZE, h: Math.round(z.h * SIZE) };
}

// Where Jack's picture goes on a page. A page can set jack.scale (default 1) for a smaller Jack.
function jackRect(page) {
  const p = JACK_PLACEMENT[page.textZone];
  if (!p) throw new Error(`Page ${page.n}: no Jack placement for ${page.textZone}`);
  const h = Math.round(p.height * SIZE * ((page.jack && page.jack.scale) || 1));
  const feet = Math.round(p.feetY * SIZE);
  return { y: feet - h, h, feetY: feet };
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
      if (!p.jack || !p.jack.expression || !p.jack.pose) problems.push(`Page ${n}: Jack needs an expression and a pose.`);
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
  jackRect,
  validateBook,
  todoPages,
};
