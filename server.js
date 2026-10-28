require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'applications.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

const readDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
// Write to temp file then rename, so a crash never corrupts the data.
const writeDb = (rows) => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, DB_FILE);
};

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

app.post('/api/apply', applyLimiter, (req, res) => {
  // Honeypot: real users never fill this hidden field.
  if (req.body.website) return res.json({ ok: true, message: 'Application received.' });

  const { errors, out } = validate(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  const rows = readDb();
  if (rows.some(r => r.email === out.email || r.phone === out.phone)) {
    return res.status(409).json({ ok: false, message: 'An application with this email or phone number already exists.' });
  }
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'new',
    fullName: out.fullName, email: out.email, phone: out.phone, age: out.age,
    language: out.language, experience: out.experience,
    provider: out.provider, momoNumber: out.momoNumber
  };
  rows.push(record);
  writeDb(rows);
  res.status(201).json({ ok: true, message: 'Application received. We will contact you by email or phone with the next steps.' });
});

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
  if (!ADMIN_TOKEN || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/applications', requireAdmin, (req, res) => res.json(readDb()));

app.patch('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const allowed = ['new', 'contacted', 'onboarded', 'rejected'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
  const rows = readDb();
  const row = rows.find(r => r.id === req.params.id);
  if (!row) return res.status(404).json({ ok: false, message: 'Not found' });
  row.status = req.body.status;
  writeDb(rows);
  res.json(row);
});

app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const rows = readDb();
  const cols = ['createdAt', 'status', 'fullName', 'email', 'phone', 'age', 'language', 'provider', 'momoNumber', 'experience'];
  const esc = v => {
    let s = String(v ?? '');
    if (/^([=@-]|\+(?!\d))/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  res.type('text/csv').attachment('chatpay-applications.csv').send(csv);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Chatpay running on http://localhost:${PORT}`));
