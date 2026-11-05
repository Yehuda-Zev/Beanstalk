const crypto = require('crypto');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const { log, logError } = require('./log');

const COOKIE = 'beanstalk.sid';
const promisify = (fn) => new Promise((resolve, reject) => fn((e) => (e ? reject(e) : resolve())));

// Adds the session middleware and the /auth/*, /logout and /api/me routes.
// Call after express.static so asset requests don't create sessions.
function setup(app) {
  const baseUrl = process.env.BASE_URL.replace(/\/+$/, '');
  const oauth = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    baseUrl + '/auth/google/callback'
  );

  app.use(
    session({
      name: COOKIE,
      store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax', // lax still sends the cookie when Google redirects back
        secure: baseUrl.startsWith('https://'),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // 1. Send the browser to Google.
  app.get('/auth/google', async (req, res, next) => {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      req.session.oauthState = state;
      await promisify((cb) => req.session.save(cb));
      res.redirect(
        oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' })
      );
    } catch (e) { next(e); }
  });

  // 2. Google sends the browser back here with a one-time code.
  app.get('/auth/google/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) {
        log('login_denied', { reason: String(error) });
        return res.redirect('/');
      }
      if (!code || !state || state !== req.session.oauthState) {
        log('login_bad_state');
        return res.status(400).send('Login failed. Please go back and try again.');
      }
      const { tokens } = await oauth.getToken(String(code));
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const p = ticket.getPayload();
      const user = await db.upsertUser({ googleId: p.sub, email: p.email, name: p.name || p.email });

      await promisify((cb) => req.session.regenerate(cb)); // new session id on login
      req.session.user = { id: user.id, name: user.name, email: user.email };
      await promisify((cb) => req.session.save(cb));
      log('login', { userId: user.id });
      res.redirect('/');
    } catch (e) {
      logError('login_failed', e);
      res.status(500).send('Login failed. Please go back and try again.');
    }
  });

  app.post('/logout', (req, res) => {
    const userId = req.session.user && req.session.user.id;
    req.session.destroy(() => {
      res.clearCookie(COOKIE);
      log('logout', { userId });
      res.json({ ok: true });
    });
  });

  app.get('/api/me', (req, res) => {
    res.json({ user: req.session.user || null });
  });
}

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

module.exports = { setup, requireLogin };
