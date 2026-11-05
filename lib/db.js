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

async function createBook({ id, userId, childName }) {
  await pool.query('INSERT INTO books (id, user_id, child_name) VALUES ($1, $2, $3)', [id, userId, childName]);
}

async function finishBook(id, pdf) {
  await pool.query("UPDATE books SET status = 'done', pdf = $2 WHERE id = $1", [id, pdf]);
}

async function failBook(id, error) {
  await pool.query("UPDATE books SET status = 'error', error = $2 WHERE id = $1", [id, error]);
}

// Books still "working" at startup were killed by a restart.
async function failInterrupted() {
  const r = await pool.query(
    "UPDATE books SET status = 'error', error = 'Interrupted by a server restart. Please try again.' WHERE status = 'working'"
  );
  return r.rowCount;
}

async function getBook(id, userId) {
  const { rows } = await pool.query(
    'SELECT id, child_name, status, error, created_at FROM books WHERE id = $1 AND user_id = $2',
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
  pool, init, upsertUser, createBook, finishBook, failBook, failInterrupted, getBook, getPdf, listBooks,
};
