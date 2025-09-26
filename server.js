// server.js - versão ajustada para compatibilidade com seu public/app.js
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
import { WebClient } from '@slack/web-api';
import fetch from 'node-fetch';

const app = express();
const __dirname = path.resolve();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/helpdesk';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB'))
  .catch(err => { console.error('Erro MongoDB:', err); process.exit(1); });

// --- Schemas / Models ---
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  password: String,
  role: { type: String, default: 'operator' },
  approved: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const technicianSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  display_name: String,
  email: String,
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: String });

const pageSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true },
  title: String, slug: String, html: String,
  visible: { type: Boolean, default: true }, meta: String,
  created_at: { type: Date, default: Date.now }, updated_at: { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema({
  ticket_number: Number,
  title: String,
  description: String,
  requester_name: String,
  requester_email: String,
  requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ticket_token: String,
  status: { type: String, default: 'new' },
  urgency: { type: String, default: 'medium' },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician', default: null },
  assigned_name: String,
  category_id: String,
  sla_hours: Number,
  created_at: { type: Date, default: Date.now }, updated_at: { type: Date, default: Date.now }
});

const attachmentSchema = new mongoose.Schema({
  ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  filename: String, url: String,
  created_at: { type: Date, default: Date.now }
});

const commentSchema = new mongoose.Schema({
  ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name: String, text: String, created_at: { type: Date, default: Date.now }
});

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

const User = mongoose.model('User', userSchema);
const Technician = mongoose.model('Technician', technicianSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Page = mongoose.model('Page', pageSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Attachment = mongoose.model('Attachment', attachmentSchema);
const Comment = mongoose.model('Comment', commentSchema);
const Counter = mongoose.model('Counter', counterSchema);

// Signup token model (usado por Slack/set-password)
const signupTokenSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  token: String,
  expires_at: Date,
  created_at: { type: Date, default: Date.now }
});
const SignupToken = mongoose.model('SignupToken', signupTokenSchema);

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
    await User.create({ name: 'Super Admin', email: 'admin@localhost', password: hash, role: 'superadmin', approved: true });
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

// --- SSE: Server-Sent Events for real-time updates ---
const sseClients = new Set(); // each item: { id, res, user, created_at }

function addSseClient(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders && res.flushHeaders();

  const client = { id: Date.now() + Math.random(), res, user: req.session.user || null, created_at: new Date() };
  sseClients.add(client);

  // initial ping
  try {
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  } catch (e) { /* ignore */ }

  req.on('close', () => {
    sseClients.delete(client);
  });

  return client;
}

// Register SSE route (reuse for multiple paths)
function registerSsePath(pathRoute) {
  app.get(pathRoute, requireLogin, (req, res) => {
    try {
      addSseClient(req, res);
    } catch (e) {
      console.error('SSE add client error', e);
      try { res.status(500).end(); } catch (e) {}
    }
  });
}

// Register the common paths your frontend may try
registerSsePath('/events');
registerSsePath('/api/events');
registerSsePath('/api/stream');
registerSsePath('/sse');

function broadcastEvent(eventName, payload) {
  // Build messages:
  const namedStr = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const genericStr = `data: ${JSON.stringify({ event: eventName, payload })}\n\n`;
  // For backwards compat: if server emits 'ticket_updated', also emit 'ticket_update'
  const aliasForTicket = (eventName === 'ticket_updated') ? `event: ticket_update\ndata: ${JSON.stringify(payload)}\n\n` : '';

  for (const c of Array.from(sseClients)) {
    try {
      c.res.write(namedStr);
      if (aliasForTicket) c.res.write(aliasForTicket);
      // always also send a generic message so onmessage handlers catch something
      c.res.write(genericStr);
    } catch (e) {
      // Ignore broken client but remove it
      try { c.res.end(); } catch (er) {}
      sseClients.delete(c);
    }
  }
}
// --- end SSE ---

// --- AUTH ---
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Credenciais inválidas' });
    const user = await User.findOne({ email }).lean();
    if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });

    if (!user.approved) {
      return res.status(403).json({ error: 'awaiting_approval', message: 'Conta pendente de aprovação pelo administrador.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Credenciais inválidas' });

    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
    safeJson(res, { ok: true, user: req.session.user });
  } catch (e) {
    console.error('POST /api/login error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.warn('Session destroy error', err);
    res.json({ ok: true });
  });
});
app.get('/api/me', (req, res) => safeJson(res, req.session.user || null));

// --- PUBLIC REGISTER ---
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

    const existing = await User.findOne({ email }).lean();
    if (existing) return res.status(409).json({ error: 'email_exists', message: 'E-mail já cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hash, role: 'operator', approved: false });
    safeJson(res, { ok: true, message: 'Cadastro enviado. Aguarde aprovação do administrador.' });
  } catch (err) {
    console.error('POST /api/register', err);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

// --- USERS (admin endpoints) ---
app.get('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const users = await User.find({}, { password: 0 }).sort({ _id: -1 }).lean();
  const mapped = users.map(u => ({ id: u._id.toString(), name: u.name, email: u.email, role: u.role, approved: !!u.approved, created_at: u.created_at }));
  safeJson(res, mapped);
});

app.post('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const u = await User.create({ name, email, password: hash, role: role || 'operator', approved: true });
    safeJson(res, { id: u._id.toString() });
  } catch (err) { console.error('POST /api/users', err); res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  try {
    const payload = { name: req.body.name, role: req.body.role };
    if (typeof req.body.approved === 'boolean') payload.approved = req.body.approved;
    if (req.body.password && typeof req.body.password === 'string' && req.body.password.trim() !== '') {
      const hashed = await bcrypt.hash(req.body.password, 10);
      payload.password = hashed;
    }
    await User.findByIdAndUpdate(req.params.id, { $set: payload });
    safeJson(res, { ok: true });
  } catch (err) {
    console.error('PUT /api/users/:id error', err);
    res.status(500).json({ error: 'db_error', message: err.message });
  }
});

app.delete('/api/users/:id', requireLogin, requireRoles('superadmin'), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

// --- SETTINGS ---
app.get('/api/settings', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const all = await Setting.find({}).lean();
  const obj = {}; all.forEach(s => obj[s.key] = s.value);
  safeJson(res, obj);
});
app.put('/api/settings', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const updates = req.body || {};
  for (const [k,v] of Object.entries(updates)) {
    await Setting.findOneAndUpdate({ key: k }, { value: typeof v === 'object' ? JSON.stringify(v) : String(v) }, { upsert: true });
  }
  safeJson(res, { ok: true });
});

// --- MENU endpoints ---
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
  const id = req.params.id; if (isObjectIdString(id)) await Page.findByIdAndDelete(id); else await Page.findOneAndDelete({ clientId: id });
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

app.get('/api/technicians/me', requireLogin, async (req, res) => {
  try {
    const t = await Technician.findOne({ user_id: req.session.user.id }).lean();
    if (!t) return safeJson(res, null);
    t.id = t._id.toString();
    safeJson(res, t);
  } catch (e) {
    console.error('GET /api/technicians/me', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// --- TICKETS ---
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
    t.assigned_to = t.assigned_to ? String(t.assigned_to) : null;
  }
  safeJson(res, tickets);
});

// --- SUBMIT (abre chamado público) ---
app.post('/submit', async (req, res) => {
  try {
    const { title, description, user, requester_name, requester_email, category_id, urgency, sla_hours } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

    const requester_id = req.session?.user?.id || null;
    const seq = await getNextSequence('ticket_number');
    const token = crypto.randomBytes(16).toString('hex');

    const newTicket = await Ticket.create({
      ticket_number: seq,
      title,
      description,
      requester_name: requester_name || (user ? user.name : ''),
      requester_email: requester_email || (user ? user.email : ''),
      requester_id: requester_id ? requester_id : null,
      ticket_token: token,
      category_id,
      urgency,
      sla_hours
    });

    // broadcast creation
    try {
      broadcastEvent('ticket_created', { ticketId: newTicket._id.toString(), ticket_number: newTicket.ticket_number, title: newTicket.title, status: newTicket.status, assigned_to: newTicket.assigned_to ? String(newTicket.assigned_to) : null });
    } catch (e) { /* ignore */ }

    res.status(201).json({
      ok: true,
      message: 'Chamado enviado!',
      protocolo: `#${newTicket.ticket_number}`,
      ticket_number: newTicket.ticket_number,
      id: newTicket._id.toString()
    });
  } catch (error) {
    console.error('POST /submit error:', error);
    res.status(500).json({ error: 'Erro ao criar chamado.' });
  }
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
      requester_id: requester_id ? requester_id : null,
      ticket_token: token, category_id, urgency, sla_hours
    });

    const savedFiles = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname) || '';
        const dest = path.join(uploadDir, file.filename + ext);
        try { fs.renameSync(file.path, dest); } catch(e){ /* ignore */ }
        const url = `/uploads/${path.basename(dest)}`;
        savedFiles.push({ filename: file.originalname, url });
        try { await Attachment.create({ ticket_id: t._id, filename: file.originalname, url }); } catch(e){}
      }
    }

    // broadcast creation
    try {
      broadcastEvent('ticket_created', { ticketId: t._id.toString(), ticket_number: t.ticket_number, title: t.title, status: t.status, assigned_to: t.assigned_to ? String(t.assigned_to) : null });
    } catch (e) { /* ignore */ }

    safeJson(res, {
      ok: true,
      id: t._id.toString(),
      ticket_number: t.ticket_number,
      protocol: `#${t.ticket_number}`,
      ticket: `Ticket ${t.ticket_number}`,
      token,
      attachments: savedFiles
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error', message: e.message });
  }
});

// PUT update ticket
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
        if (req.session?.user?.role === 'technician') {
          const myTech = await Technician.findOne({ user_id: req.session.user.id });
          if (!myTech) return res.status(403).json({ error: 'forbidden_no_technician_record' });
          if (myTech._id.toString() !== techId) return res.status(403).json({ error: 'forbidden_assign' });
          payload.assigned_to = myTech._id;
          payload.assigned_name = myTech.display_name || myTech.email || '';
        } else {
          if (isObjectIdString(techId)) {
            const tech = await Technician.findById(techId);
            if (tech) { payload.assigned_to = tech._id; payload.assigned_name = tech.display_name || tech.email || ''; }
            else { payload.assigned_to = null; payload.assigned_name = ''; }
          } else {
            payload.assigned_to = null; payload.assigned_name = '';
          }
        }
      }
    }

    payload.updated_at = new Date();
    const upd = await Ticket.findByIdAndUpdate(id, { $set: payload }, { new: true });

    // broadcast update (note: broadcastEvent will also emit alias 'ticket_update' for retrocompat)
    try {
      broadcastEvent('ticket_updated', { ticketId: id, status: upd ? upd.status : null, assigned_to: upd && upd.assigned_to ? String(upd.assigned_to) : null, urgency: upd ? upd.urgency : null });
    } catch (e) { /* ignore */ }

    safeJson(res, { ok: true, ticket: upd ? { id: upd._id.toString(), ticket_number: upd.ticket_number } : null });
  } catch (err) { console.error('PUT /api/tickets/:id', err); res.status(500).json({ error: 'db_error', message: err.message }); }
});

// COMMENTS
app.post('/api/tickets/:id/comments', requireLogin, async (req, res) => {
  try {
    const c = await Comment.create({ ticket_id: req.params.id, user_id: req.session.user.id, user_name: req.session.user.name, text: req.body.text });
    // broadcast comment
    try {
      broadcastEvent('comment_created', { ticketId: req.params.id, comment: { id: c._id.toString(), user_name: c.user_name, text: c.text, created_at: c.created_at } });
    } catch (e) { /* ignore */ }
    safeJson(res, { id: c._id.toString() });
  } catch (e) {
    console.error('POST comment error', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// DELETE ticket
app.delete('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const attachments = await Attachment.find({ ticket_id: req.params.id });
  for (const a of attachments) {
    try { const filePath = path.join(__dirname, 'public', a.url); if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  await Attachment.deleteMany({ ticket_id: req.params.id });
  await Comment.deleteMany({ ticket_id: req.params.id });
  await Ticket.findByIdAndDelete(req.params.id);

  // broadcast delete
  try { broadcastEvent('ticket_deleted', { ticketId: req.params.id }); } catch (e){}

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
    t.assigned_to = t.assigned_to ? String(t.assigned_to) : null;
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

// FRONTEND ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/submit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'submit.html')));
app.get('/admin', requireLogin, requireRoles('admin','superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-edit.html')));
app.get('/superadmin-reports', requireLogin, requireRoles('superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin-reports.html')));

// ---------- Slack Integration (mantive como estava) ----------
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN || '');
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI;

// verifySlackRequest, createTicketFromSlack, auth endpoints and interactions...
// (preserve the logic you already had; omitted here for brevity in the snippet,
// but keep the same content from your original server.js — if you want I can paste
// the full Slack block again; it was unchanged except the SSE improvements above.)

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
