require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add your PostgreSQL connection string to .env');
  process.exit(1);
}
// Render's external URLs need SSL; internal URLs and local databases do not.
const useSsl = /render\.com|neon\.tech|supabase\.co/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

const initDb = () => pool.query(`
  CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'new',
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    age INT NOT NULL,
    language TEXT NOT NULL,
    experience TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL,
    momo_number TEXT NOT NULL,
    pw_hash TEXT
  )`)
  .then(() => pool.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS pw_hash TEXT'))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY,
      application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    )`));

const toApi = r => ({
  id: r.id, createdAt: r.created_at.toISOString(), status: r.status,
  fullName: r.full_name, email: r.email, phone: r.phone, age: r.age,
  language: r.language, experience: r.experience, provider: r.provider, momoNumber: r.momo_number
});
const listApplications = async () =>
  (await pool.query('SELECT * FROM applications ORDER BY created_at ASC')).rows.map(toApi);


// ---- Passwords and sessions for the worker dashboard ----
const SECRET = process.env.SESSION_SECRET || ADMIN_TOKEN;
const hashPw = pw => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const t = crypto.scryptSync(pw, salt, 64), hb = Buffer.from(h, 'hex');
  return hb.length === t.length && crypto.timingSafeEqual(t, hb);
};
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const makeSession = id => { const p = Buffer.from(JSON.stringify({ id, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
const readSession = req => {
  const m = (req.headers.cookie || '').match(/(?:^|; )cp_session=([^;]+)/);
  if (!m || !SECRET) return null;
  const [p, sg] = m[1].split('.');
  if (!p || !sg) return null;
  const e = sign(p);
  if (sg.length !== e.length || !crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(e))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() ? d.id : null; } catch { return null; }
};
const setCookie = (req, res, val, maxAge) =>
  res.setHeader('Set-Cookie', `cp_session=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
const maskNum = n => n.slice(0, 7) + '***' + n.slice(-3);

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const LANGUAGES = ['Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Lunda', 'Luvale', 'Other'];
const PROVIDERS = ['airtel', 'mtn'];

// Zambian mobile numbers: Airtel 097/077, MTN 096/076, Zamtel 095/055.
// Accepts 0971234567, 971234567, +260971234567, 260971234567.
function normalizeZmPhone(raw) {
  const digits = String(raw || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
  const m = digits.match(/^(?:260|0)?(9[567]\d{7}|7[67]\d{7}|55\d{7})$/);
  return m ? '+260' + m[1] : null;
}
const clean = (s, max) => String(s || '').trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

function validate(b) {
  const errors = {};
  const out = {};
  out.fullName = clean(b.fullName, 100);
  if (out.fullName.length < 3 || !out.fullName.includes(' ')) errors.fullName = 'Enter your first and last name.';

  out.email = clean(b.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errors.email = 'Enter a valid email address.';

  out.phone = normalizeZmPhone(b.phone);
  if (!out.phone) errors.phone = 'Enter a valid Zambian number, e.g. 097 123 4567.';

  out.age = parseInt(b.age, 10);
  if (!Number.isInteger(out.age) || out.age < 18 || out.age > 80) errors.age = 'You must be 18 or older to apply.';

  out.language = clean(b.language, 20);
  if (!LANGUAGES.includes(out.language)) errors.language = 'Choose a language.';

  out.experience = clean(b.experience, 1000);

  out.provider = clean(b.provider, 10);
  if (!PROVIDERS.includes(out.provider)) errors.provider = 'Choose Airtel Money or MTN MoMo.';

  out.momoNumber = normalizeZmPhone(b.momoNumber);
  if (!out.momoNumber) errors.momoNumber = 'Enter a valid mobile money number.';
  else if (out.provider === 'airtel' && !/^\+260(97|77)/.test(out.momoNumber)) errors.momoNumber = 'Airtel Money numbers start with 097 or 077.';
  else if (out.provider === 'mtn' && !/^\+260(96|76)/.test(out.momoNumber)) errors.momoNumber = 'MTN MoMo numbers start with 096 or 076.';

  out.password = String(b.password || '');
  if (out.password.length < 8 || out.password.length > 100) errors.password = 'Choose a password of at least 8 characters.';

  if (b.consent !== true) errors.consent = 'You must accept the Terms and Privacy Policy.';
  return { errors, out };
}

const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many attempts. Please try again later.' }
});

// ---- Confirmation email (Brevo HTTP API; works on hosts that block SMTP) ----
const escHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendConfirmation(a) {
  const key = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM_EMAIL;
  if (!key || !fromEmail) { console.log('Email not configured; skipping confirmation.'); return; }
  const fromName = process.env.MAIL_FROM_NAME || 'Chatpay';
  const support = process.env.SUPPORT_EMAIL || fromEmail;
  const first = a.fullName.split(' ')[0];
  const provider = a.provider === 'airtel' ? 'Airtel Money' : 'MTN MoMo';
  const masked = a.momoNumber.slice(0, 7) + '***' + a.momoNumber.slice(-3);

  const text = [
    `Hello ${first},`, '',
    'Thank you for applying to Chatpay. Your registration has been received.', '',
    'What happens next:',
    '1. Our team reviews your application.',
    '2. We contact you by email or phone with onboarding details.',
    '3. Once onboarded, you can start chatting and teaching.', '',
    `Payments will go to your ${provider} number ${masked}.`, '',
    'Important:',
    '- Chatpay never charges a fee to join or start working.',
    '- We will never ask for your mobile money PIN or password.', '',
    `Questions? Reply to this email or write to ${support}.`, '',
    'The Chatpay team'
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#14231b;line-height:1.55">
    <h2 style="color:#0f4a30">Registration received</h2>
    <p>Hello ${escHtml(first)},</p>
    <p>Thank you for applying to Chatpay. Your registration has been received.</p>
    <p><strong>What happens next</strong></p>
    <ol><li>Our team reviews your application.</li><li>We contact you by email or phone with onboarding details.</li><li>Once onboarded, you can start chatting and teaching.</li></ol>
    <p>Payments will go to your <strong>${provider}</strong> number <strong>${escHtml(masked)}</strong>.</p>
    <p style="background:#f3f6f4;padding:12px;border-left:4px solid #c4733a"><strong>Stay safe:</strong> Chatpay never charges a fee to join or start working, and we will never ask for your mobile money PIN or password.</p>
    <p>Questions? Reply to this email or write to ${escHtml(support)}.</p>
    <p>The Chatpay team</p></div>`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: a.email, name: a.fullName }],
      replyTo: { email: support },
      subject: 'Your Chatpay registration was received',
      htmlContent: html,
      textContent: text
    })
  });
  if (!res.ok) throw new Error('Brevo responded ' + res.status + ': ' + (await res.text()).slice(0, 200));
}

app.post('/api/apply', applyLimiter, async (req, res) => {
  // Honeypot: real users never fill this hidden field.
  if (req.body.website) return res.json({ ok: true, message: 'Application received.' });

  const { errors, out } = validate(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  try {
    await pool.query(
      `INSERT INTO applications (id, full_name, email, phone, age, language, experience, provider, momo_number, pw_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [crypto.randomUUID(), out.fullName, out.email, out.phone, out.age, out.language, out.experience, out.provider, out.momoNumber, hashPw(out.password)]
    );
    // Send the email in the background; a mail failure must never undo a saved application.
    sendConfirmation(out).catch(e => console.error('Confirmation email failed:', e.message));
    const emailOn = !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
    res.status(201).json({ ok: true, message: emailOn
      ? 'Application received. A confirmation email is on its way. We will contact you with the next steps.'
      : 'Application received. We will contact you by email or phone with the next steps.' });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, message: 'An application with this email or phone number already exists.' });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: 'Server error. Please try again.' });
  }
});

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
  if (!ADMIN_TOKEN || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  next();
}

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ ok: false, message: 'Server error' }); });

app.get('/api/admin/applications', requireAdmin, wrap(async (req, res) => res.json(await listApplications())));

app.patch('/api/admin/applications/:id', requireAdmin, wrap(async (req, res) => {
  const allowed = ['new', 'contacted', 'onboarded', 'paid', 'rejected'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ ok: false, message: 'Not found' });
  const r = await pool.query('UPDATE applications SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ ok: false, message: 'Not found' });
  res.json(toApi(r.rows[0]));
}));

app.get('/api/admin/export.csv', requireAdmin, wrap(async (req, res) => {
  const rows = await listApplications();
  const cols = ['createdAt', 'status', 'fullName', 'email', 'phone', 'age', 'language', 'provider', 'momoNumber', 'experience'];
  const esc = v => {
    let s = String(v ?? '');
    if (/^([=@-]|\+(?!\d))/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  res.type('text/csv').attachment('chatpay-applications.csv').send(csv);
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many sign-in attempts. Try again in 15 minutes.' }
});

app.post('/api/login', loginLimiter, wrap(async (req, res) => {
  if (!SECRET) return res.status(503).json({ ok: false, message: 'Sign-in is not available yet.' });
  const email = clean(req.body.email, 120).toLowerCase();
  const pw = String(req.body.password || '').slice(0, 200);
  const row = (await pool.query('SELECT id, pw_hash FROM applications WHERE email=$1', [email])).rows[0];
  if (!checkPw(pw, row && row.pw_hash)) return res.status(401).json({ ok: false, message: 'Wrong email or password.' });
  setCookie(req, res, makeSession(row.id), 604800);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });

app.get('/api/me', wrap(async (req, res) => {
  const id = readSession(req);
  const a = id && (await pool.query('SELECT * FROM applications WHERE id=$1', [id])).rows[0];
  if (!a) return res.status(401).json({ ok: false });
  const p = (await pool.query('SELECT kind, amount, note, status, created_at FROM payouts WHERE application_id=$1 ORDER BY created_at DESC', [id])).rows;
  const sum = st => p.filter(x => x.status === st).reduce((t, x) => t + Number(x.amount), 0);
  res.json({
    ok: true,
    profile: { fullName: a.full_name, email: a.email, status: a.status, language: a.language, provider: a.provider, momoMasked: maskNum(a.momo_number), createdAt: a.created_at.toISOString() },
    totals: { pending: sum('pending'), paid: sum('paid') },
    payouts: p.map(x => ({ kind: x.kind, amount: Number(x.amount), note: x.note, status: x.status, createdAt: x.created_at.toISOString() }))
  });
}));

app.get('/api/admin/payouts', requireAdmin, wrap(async (req, res) => {
  const r = await pool.query(`SELECT p.id, p.kind, p.amount, p.note, p.status, p.created_at, a.full_name, a.provider, a.momo_number
    FROM payouts p JOIN applications a ON a.id = p.application_id ORDER BY p.created_at DESC`);
  res.json(r.rows.map(x => ({ id: x.id, kind: x.kind, amount: Number(x.amount), note: x.note, status: x.status, createdAt: x.created_at.toISOString(), fullName: x.full_name, provider: x.provider, momoNumber: x.momo_number })));
}));

app.post('/api/admin/applications/:id/payouts', requireAdmin, wrap(async (req, res) => {
  const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
  const kind = req.body.kind;
  if (!['earning', 'bonus'].includes(kind)) return res.status(400).json({ ok: false, message: 'Invalid type' });
  if (!(amount > 0 && amount <= 100000)) return res.status(400).json({ ok: false, message: 'Enter an amount between 0 and 100000.' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ ok: false, message: 'Not found' });
  const exists = await pool.query('SELECT 1 FROM applications WHERE id=$1', [req.params.id]);
  if (!exists.rows.length) return res.status(404).json({ ok: false, message: 'Not found' });
  await pool.query('INSERT INTO payouts (id, application_id, kind, amount, note) VALUES ($1,$2,$3,$4,$5)',
    [crypto.randomUUID(), req.params.id, kind, amount, clean(req.body.note, 200)]);
  res.status(201).json({ ok: true });
}));

app.patch('/api/admin/payouts/:id', requireAdmin, wrap(async (req, res) => {
  if (req.body.status !== 'paid') return res.status(400).json({ ok: false, message: 'Invalid status' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ ok: false, message: 'Not found' });
  const r = await pool.query("UPDATE payouts SET status='paid', paid_at=now() WHERE id=$1 RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ ok: false, message: 'Not found' });
  res.json({ ok: true });
}));

app.get('/api/health', wrap(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Chatpay running on port ${PORT}`)))
  .catch(e => { console.error('Database connection failed:', e.message); process.exit(1); });
