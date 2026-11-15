const { Pool } = require('pg');
const { logError } = require('./log');

// Neon's connection string already carries ?sslmode=require.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (e) => logError('pg_pool_error', e));

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      google_id   TEXT UNIQUE NOT NULL,
      email       TEXT,
      name        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS books (
      id          UUID PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      child_name  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'working',
      error       TEXT,
      pdf         BYTEA,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS books_user_idx ON books (user_id, created_at DESC);
    -- Character-sheet approval step: the photo and sheet are kept only until the book is finished.
    ALTER TABLE books ADD COLUMN IF NOT EXISTS about     JSONB;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS photo     BYTEA;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS sheet     BYTEA;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS redraws   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS review_at TIMESTAMPTZ;
  `);
}

async function upsertUser({ googleId, email, name }) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_id, email, name) VALUES ($1, $2, $3)
     ON CONFLICT (google_id)
     DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login = now()
     RETURNING id, email, name`,
    [googleId, email, name]
  );
  return rows[0];
}

// status: sheet (drawing Jack) -> review (user checks Jack) -> working (drawing pages) -> done | error
async function createBook({ id, userId, childName, about, photo }) {
  await pool.query(
    "INSERT INTO books (id, user_id, child_name, status, about, photo) VALUES ($1, $2, $3, 'sheet', $4, $5)",
    [id, userId, childName, JSON.stringify(about), photo]
  );
}

async function setSheet(id, sheet) {
  await pool.query(
    "UPDATE books SET sheet = $2, status = 'review', review_at = now() WHERE id = $1 AND status = 'sheet'",
    [id, sheet]
  );
}

// Atomic: only one request can move a book out of 'review', so a double click can't start two runs.
async function startRedraw(id, userId, maxRedraws) {
  const { rows } = await pool.query(
    `UPDATE books SET status = 'sheet', redraws = redraws + 1, sheet = NULL
     WHERE id = $1 AND user_id = $2 AND status = 'review' AND redraws < $3
     RETURNING photo`,
    [id, userId, maxRedraws]
  );
  return rows[0] || null;
}

async function startApprove(id, userId) {
  const { rows } = await pool.query(
    `UPDATE books SET status = 'working'
     WHERE id = $1 AND user_id = $2 AND status = 'review'
     RETURNING photo, sheet, about`,
    [id, userId]
  );
  return rows[0] || null;
}

async function getSheet(id, userId) {
  const { rows } = await pool.query(
    "SELECT sheet FROM books WHERE id = $1 AND user_id = $2 AND status = 'review'",
    [id, userId]
  );
  return rows[0] ? rows[0].sheet : null;
}

// "Start over": removes an unfinished book and everything stored for it (photo, picture).
async function discardBook(id, userId) {
  const r = await pool.query(
    "DELETE FROM books WHERE id = $1 AND user_id = $2 AND status IN ('sheet', 'review', 'error')",
    [id, userId]
  );
  return r.rowCount > 0;
}

// Finished or failed books keep no photo and no character sheet.
async function finishBook(id, pdf) {
  await pool.query(
    "UPDATE books SET status = 'done', pdf = $2, photo = NULL, sheet = NULL WHERE id = $1",
    [id, pdf]
  );
}

async function failBook(id, error) {
  await pool.query(
    "UPDATE books SET status = 'error', error = $2, photo = NULL, sheet = NULL WHERE id = $1",
    [id, error]
  );
}

// Books in 'sheet' or 'working' at startup were killed by a restart. 'review' books survive restarts.
async function failInterrupted() {
  const r = await pool.query(
    `UPDATE books SET status = 'error', error = 'Interrupted by a server restart. Please try again.',
       photo = NULL, sheet = NULL
     WHERE status IN ('sheet', 'working')`
  );
  return r.rowCount;
}

// Privacy: a photo left waiting for approval is deleted after an hour.
async function expireStaleReviews(minutes) {
  const r = await pool.query(
    `UPDATE books SET status = 'error', error = 'Expired while waiting for approval. Please start again.',
       photo = NULL, sheet = NULL
     WHERE status = 'review' AND review_at < now() - make_interval(mins => $1)`,
    [minutes]
  );
  return r.rowCount;
}

async function getBook(id, userId) {
  const { rows } = await pool.query(
    'SELECT id, child_name, status, error, redraws, created_at FROM books WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

async function getPdf(id, userId) {
  const { rows } = await pool.query(
    "SELECT pdf FROM books WHERE id = $1 AND user_id = $2 AND status = 'done'",
    [id, userId]
  );
  return rows[0] ? rows[0].pdf : null;
}

async function listBooks(userId) {
  const { rows } = await pool.query(
    'SELECT id, child_name, status, error, created_at FROM books WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [userId]
  );
  return rows;
}

module.exports = {
  pool, init, upsertUser, createBook, setSheet, discardBook, startRedraw, startApprove, getSheet,
  finishBook, failBook, failInterrupted, expireStaleReviews, getBook, getPdf, listBooks,
};
