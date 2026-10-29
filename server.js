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
    momo_number TEXT NOT NULL
  )`);

const toApi = r => ({
  id: r.id, createdAt: r.created_at.toISOString(), status: r.status,
  fullName: r.full_name, email: r.email, phone: r.phone, age: r.age,
  language: r.language, experience: r.experience, provider: r.provider, momoNumber: r.momo_number
});
const listApplications = async () =>
  (await pool.query('SELECT * FROM applications ORDER BY created_at ASC')).rows.map(toApi);

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

  if (b.consent !== true) errors.consent = 'You must accept the Terms and Privacy Policy.';
  return { errors, out };
}

const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many attempts. Please try again later.' }
});

app.post('/api/apply', applyLimiter, async (req, res) => {
  // Honeypot: real users never fill this hidden field.
  if (req.body.website) return res.json({ ok: true, message: 'Application received.' });

  const { errors, out } = validate(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  try {
    await pool.query(
      `INSERT INTO applications (id, full_name, email, phone, age, language, experience, provider, momo_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [crypto.randomUUID(), out.fullName, out.email, out.phone, out.age, out.language, out.experience, out.provider, out.momoNumber]
    );
    res.status(201).json({ ok: true, message: 'Application received. We will contact you by email or phone with the next steps.' });
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

app.get('/api/health', wrap(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Chatpay running on port ${PORT}`)))
  .catch(e => { console.error('Database connection failed:', e.message); process.exit(1); });
