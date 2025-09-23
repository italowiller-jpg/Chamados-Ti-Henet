// server.js (MongoDB + Mongoose - ES MODULES) - COM TICKET SEQUENCE E assigned_to COMO STRING
import express from 'express';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import path from 'path';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import helmet from 'helmet';
import crypto from 'crypto';
import MongoStore from 'connect-mongo';

const app = express();
const __dirname = path.resolve();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/helpdesk';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB'))
  .catch(err => { console.error('Erro MongoDB:', err); process.exit(1); });

// --- Schemas / Models ---
const userSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, sparse: true }, password: String,
  role: { type: String, default: 'operator' }, created_at: { type: Date, default: Date.now }
});
const technicianSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  display_name: String, email: String, active: { type: Boolean, default: true }, created_at: { type: Date, default: Date.now }
});
const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: String });
const pageSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true }, title: String, slug: String, html: String,
  visible: { type: Boolean, default: true }, meta: String, created_at: { type: Date, default: Date.now }, updated_at: { type: Date, default: Date.now }
});
const ticketSchema = new mongoose.Schema({
  ticket_number: Number, title: String, description: String, requester_name: String, requester_email: String,
  requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, ticket_token: String,
  status: { type: String, default: 'new' }, urgency: { type: String, default: 'medium' },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician', default: null },
  assigned_name: String, category_id: String, sla_hours: Number,
  created_at: { type: Date, default: Date.now }, updated_at: { type: Date, default: Date.now }
});
const attachmentSchema = new mongoose.Schema({ ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }, filename: String, url: String, created_at: { type: Date, default: Date.now }});
const commentSchema = new mongoose.Schema({ ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }, user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, user_name: String, text: String, created_at: { type: Date, default: Date.now }});

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

const User = mongoose.model('User', userSchema);
const Technician = mongoose.model('Technician', technicianSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Page = mongoose.model('Page', pageSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Attachment = mongoose.model('Attachment', attachmentSchema);
const Comment = mongoose.model('Comment', commentSchema);
const Counter = mongoose.model('Counter', counterSchema);

// --- Middleware ---
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '16mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque_essa_chave',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 24 * 3600 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// --- Superadmin default ---
(async () => {
  const count = await User.countDocuments();
  if (count === 0) {
    const hash = await bcrypt.hash('admin', 10);
    await User.create({ name: 'Super Admin', email: 'admin@localhost', password: hash, role: 'superadmin' });
    console.log('Usuário padrão criado: admin@localhost / senha: admin');
  }
})();

// --- Helpers ---
function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}
function requireRoles(...roles) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: 'not_authenticated' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
function safeJson(res, data) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.json(data); }
function isObjectIdString(s){ return typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s); }
async function getNextSequence(name){
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}

// --- AUTH ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Credenciais inválidas' });
  const user = await User.findOne({ email }).lean();
  if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Credenciais inválidas' });
  req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
  safeJson(res, { ok: true, user: req.session.user });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => safeJson(res, req.session.user || null));

// --- USERS ---
app.get('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const users = await User.find({}, { password: 0 }).sort({ _id: -1 }).lean();
  const mapped = users.map(u => ({ id: u._id.toString(), name: u.name, email: u.email, role: u.role, created_at: u.created_at }));
  safeJson(res, mapped);
});
app.post('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const u = await User.create({ name, email, password: hash, role: role || 'operator' });
    safeJson(res, { id: u._id.toString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/users/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { $set: { name: req.body.name, role: req.body.role } });
  safeJson(res, { ok: true });
});
app.delete('/api/users/:id', requireLogin, requireRoles('superadmin'), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

// --- SETTINGS ---
app.get('/api/settings', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const all = await Setting.find({}).lean();
  const obj = {};
  all.forEach(s => obj[s.key] = s.value);
  safeJson(res, obj);
});
app.put('/api/settings', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const updates = req.body || {};
  for (const [k,v] of Object.entries(updates)) {
    await Setting.findOneAndUpdate({ key: k }, { value: typeof v === 'object' ? JSON.stringify(v) : String(v) }, { upsert: true });
  }
  safeJson(res, { ok: true });
});

// --- MENU endpoints (uses settings.menu_items) ---
app.get('/api/menu', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const s = await Setting.findOne({ key: 'menu' }).lean();
  if (!s) return safeJson(res, [{ label: 'Início', slug: '/' }, { label: 'Abrir chamado', slug: '/submit' }]);
  try { const val = JSON.parse(s.value); safeJson(res, Array.isArray(val) ? val : []); } catch(e){ safeJson(res, []); }
});
app.put('/api/menu', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : [];
  await Setting.findOneAndUpdate({ key: 'menu' }, { value: JSON.stringify(arr) }, { upsert: true });
  safeJson(res, { ok: true });
});

// --- PAGES CRUD ---
app.get('/api/pages', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const pages = await Page.find({}).sort({ created_at: -1 }).lean();
  const mapped = pages.map(p => ({ id: p.clientId || p._id.toString(), title: p.title, slug: p.slug, html: p.html, visible: !!p.visible, meta: p.meta, created_at: p.created_at, updated_at: p.updated_at }));
  safeJson(res, mapped);
});
app.post('/api/pages', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const body = req.body || {}; const clientId = body.id || body.clientId || null;
  try {
    const doc = new Page({ clientId: clientId || undefined, title: body.title || 'Nova página', slug: body.slug || ('/pagina-' + Date.now()), html: body.html || '<h2>Nova página</h2>', visible: body.visible === undefined ? true : !!body.visible, meta: body.meta || '' });
    await doc.save();
    safeJson(res, { id: doc.clientId || doc._id.toString() });
  } catch (e) { console.error('POST /api/pages error', e); res.status(500).json({ error: e.message }); }
});
app.put('/api/pages', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const body = req.body; if (!Array.isArray(body)) return res.status(400).json({ error: 'expect_array' });
  const incomingIds = [];
  for (const p of body) {
    const clientId = p.id || p.clientId || null;
    const payload = { title: p.title || 'Sem título', slug: p.slug || '', html: p.html || '', visible: p.visible === undefined ? true : !!p.visible, meta: p.meta || '', updated_at: new Date() };
    if (clientId) { incomingIds.push(clientId); await Page.findOneAndUpdate({ clientId }, { $set: payload }, { upsert: true }); }
    else { const n = new Page({ ...payload, clientId: 'p-' + Date.now() + '-' + Math.floor(Math.random()*1000) }); await n.save(); incomingIds.push(n.clientId); }
  }
  await Page.deleteMany({ clientId: { $nin: incomingIds } });
  safeJson(res, { ok: true });
});
app.put('/api/pages/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const id = req.params.id; const body = req.body || {};
  const payload = { title: body.title, slug: body.slug, html: body.html, visible: body.visible, meta: body.meta, updated_at: new Date() };
  let q = {}; if (isObjectIdString(id)) q = { _id: id }; else q = { clientId: id };
  await Page.findOneAndUpdate(q, { $set: payload }, { upsert: false });
  safeJson(res, { ok: true });
});
app.delete('/api/pages/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const id = req.params.id;
  if (isObjectIdString(id)) await Page.findByIdAndDelete(id); else await Page.findOneAndDelete({ clientId: id });
  safeJson(res, { ok: true });
});

// --- TECHNICIANS ---
app.get('/api/technicians', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const techs = await Technician.find({}).sort({ active: -1, _id: -1 }).lean();
  const mapped = techs.map(t => ({ id: t._id.toString(), display_name: t.display_name, email: t.email, active: t.active, created_at: t.created_at }));
  safeJson(res, mapped);
});
app.post('/api/technicians', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const t = await Technician.create({ display_name: req.body.display_name, email: req.body.email, user_id: req.body.user_id || null });
  safeJson(res, { id: t._id.toString() });
});
app.put('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await Technician.findByIdAndUpdate(req.params.id, req.body);
  safeJson(res, { ok: true });
});
app.delete('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await Technician.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

// --- TICKETS ---
// GET tickets
app.get('/api/tickets', async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.urgency) query.urgency = req.query.urgency;
  const user = req.session?.user;
  const privileged = user && ['admin','superadmin','technician'].includes(user.role);
  if (!privileged) {
    if (user) query.$or = [{ requester_id: user.id }, { requester_email: user.email }];
    else if (req.query.requester_email) query.requester_email = req.query.requester_email;
    else return safeJson(res, []);
  }
  const tickets = await Ticket.find(query).sort({ created_at: -1 }).lean();
  for (const t of tickets) {
    t.attachments = await Attachment.find({ ticket_id: t._id }).lean();
    if ((!t.assigned_name || t.assigned_name === '') && t.assigned_to) {
      const tech = await Technician.findById(t.assigned_to);
      if (tech) t.assigned_name = tech.display_name;
    }
    t.id = t._id.toString();
    t.assigned_to = t.assigned_to ? String(t.assigned_to) : null; // important: send as string
  }
  safeJson(res, tickets);
});

// POST create ticket (assign sequence number)
app.post('/api/tickets', upload.array('attachments'), async (req, res) => {
  try {
    const { title, description, requester_name, requester_email, category_id, urgency, sla_hours } = req.body;
    if (!title) return res.status(400).json({ error: 'title_required' });
    if (!description) return res.status(400).json({ error: 'description_required' });
    if (!requester_name) return res.status(400).json({ error: 'requester_name_required' });
    const requester_id = req.session?.user?.id || null;
    const token = crypto.randomBytes(16).toString('hex');
    const seq = await getNextSequence('ticket_number');
    const t = await Ticket.create({
      ticket_number: seq,
      title, description, requester_name, requester_email,
      requester_id: requester_id ? requester_id : null, ticket_token: token, category_id, urgency, sla_hours
    });
    const savedFiles = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname) || '';
        const dest = path.join(uploadDir, file.filename + ext);
        try { fs.renameSync(file.path, dest); } catch(e){ /* ignore */ }
        const url = `/uploads/${path.basename(dest)}`;
        savedFiles.push({ filename: file.originalname, url });
        await Attachment.create({ ticket_id: t._id, filename: file.originalname, url });
      }
    }
    safeJson(res, { ok: true, id: t._id.toString(), ticket_number: t.ticket_number, token, attachments: savedFiles });
  } catch (e) { console.error(e); res.status(500).json({ error: 'db_error', message: e.message }); }
});

// PUT update ticket (status/assigned_to/urgency)
app.put('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin','technician'), async (req, res) => {
  try {
    const id = req.params.id;
    const payload = {};
    if (req.body.status !== undefined) payload.status = req.body.status;
    if (req.body.urgency !== undefined) payload.urgency = req.body.urgency;
    if (req.body.assigned_to !== undefined) {
      if (!req.body.assigned_to) {
        payload.assigned_to = null; payload.assigned_name = '';
      } else {
        const techId = req.body.assigned_to;
        // techId must be a Mongo _id string
        if (isObjectIdString(techId)) {
          const tech = await Technician.findById(techId);
          if (tech) { payload.assigned_to = tech._id; payload.assigned_name = tech.display_name || tech.email || ''; }
          else { payload.assigned_to = null; payload.assigned_name = ''; }
        } else {
          payload.assigned_to = null; payload.assigned_name = '';
        }
      }
    }
    payload.updated_at = new Date();
    const upd = await Ticket.findByIdAndUpdate(id, { $set: payload }, { new: true });
    safeJson(res, { ok: true, ticket: upd ? { id: upd._id.toString(), ticket_number: upd.ticket_number } : null });
  } catch (err) { console.error('PUT /api/tickets/:id', err); res.status(500).json({ error: 'db_error', message: err.message }); }
});

// COMMENTS / DELETE / DETAIL
app.post('/api/tickets/:id/comments', requireLogin, async (req, res) => {
  const c = await Comment.create({ ticket_id: req.params.id, user_id: req.session.user.id, user_name: req.session.user.name, text: req.body.text });
  safeJson(res, { id: c._id.toString() });
});
app.delete('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const attachments = await Attachment.find({ ticket_id: req.params.id });
  for (const a of attachments) {
    try { const filePath = path.join(__dirname, 'public', a.url); if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  await Attachment.deleteMany({ ticket_id: req.params.id });
  await Comment.deleteMany({ ticket_id: req.params.id });
  await Ticket.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});
app.get('/api/tickets/:id', requireLogin, async (req, res) => {
  try {
    const t = await Ticket.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: 'not_found' });
    t.attachments = await Attachment.find({ ticket_id: t._id }).lean();
    t.comments = await Comment.find({ ticket_id: t._id }).sort({ created_at: -1 }).lean();
    if ((!t.assigned_name || t.assigned_name === '') && t.assigned_to) {
      const tech = await Technician.findById(t.assigned_to);
      if (tech) t.assigned_name = tech.display_name;
    }
    t.id = t._id.toString();
    t.assigned_to = t.assigned_to ? String(t.assigned_to) : null; // send assigned_to as string
    safeJson(res, t);
  } catch (err) { console.error(err); res.status(500).json({ error: 'db_error', message: err.message }); }
});

// UPLOAD
app.post('/api/upload', requireLogin, requireRoles('admin','superadmin'), upload.single('file'), (req, res) => {
  const file = req.file; if (!file) return res.status(400).json({ error: 'no_file' });
  const ext = path.extname(file.originalname) || ''; const dest = path.join(uploadDir, file.filename + ext);
  try { fs.renameSync(file.path, dest); } catch(e){ console.warn('rename upload error', e); }
  const url = '/uploads/' + path.basename(dest);
  safeJson(res, { ok: true, url });
});

// REPORTS
app.get('/api/reports', requireLogin, requireRoles('superadmin'), async (req, res) => {
  const kpis = { total: await Ticket.countDocuments(), open: await Ticket.countDocuments({ status: { $in: ['new','in_progress'] } }), closed: await Ticket.countDocuments({ status: 'closed' }), techs: await Technician.countDocuments() };
  const now = Date.now();
  const labels = []; const data = [];
  for (let i = 6; i >= 0; i--) { labels.push(new Date(now - i * 24 * 3600 * 1000).toLocaleDateString()); data.push(Math.floor(Math.random()*12 + 2)); }
  const list = (await Ticket.find({}).sort({ created_at: -1 }).limit(50).lean()).map((t) => ({ id: t._id.toString(), title: t.title, status: t.status, tech: t.assigned_name || '-', date: t.created_at }));
  const techSummary = (await Technician.find({}).lean()).map(t => ({ name: t.display_name || t.email, count: Math.floor(Math.random()*40) }));
  safeJson(res, { kpis, timeseries: { labels, data }, list, techSummary });
});
app.get('/api/reports/export', requireLogin, requireRoles('superadmin'), async (req, res) => {
  const rows = [['id','title','status','tech','date']]; const tickets = await Ticket.find({}).limit(200).lean();
  for (const t of tickets) rows.push([t._id.toString(), t.title, t.status, t.assigned_name || '', (t.created_at || new Date()).toISOString()]);
  res.setHeader('Content-Type','text/csv'); res.send(rows.map(r=>r.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n'));
});

// FRONTEND ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/submit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'submit.html')));
app.get('/admin', requireLogin, requireRoles('admin','superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-edit.html')));
app.get('/superadmin-reports', requireLogin, requireRoles('superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin-reports.html')));

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
