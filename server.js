// server.js (MongoDB + Mongoose - ES Modules)
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
import MongoStore from 'connect-mongo'; // <- Import direto como classe

const app = express();
const __dirname = path.resolve(); // necessário em ES Modules

// ---- CONEXÃO MONGODB ----
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/helpdesk';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB'))
  .catch(err => { console.error('Erro MongoDB:', err); process.exit(1); });

// ---- SCHEMAS E MODELOS ----
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'operator' },
  created_at: { type: Date, default: Date.now }
});

const technicianSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  display_name: String,
  email: String,
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});

const ticketSchema = new mongoose.Schema({
  title: String,
  description: String,
  requester_name: String,
  requester_email: String,
  requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ticket_token: String,
  status: { type: String, default: 'new' },
  urgency: { type: String, default: 'medium' },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  assigned_name: String,
  category_id: String,
  sla_hours: Number,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

const attachmentSchema = new mongoose.Schema({
  ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  filename: String,
  url: String,
  created_at: { type: Date, default: Date.now }
});

const commentSchema = new mongoose.Schema({
  ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name: String,
  text: String,
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Technician = mongoose.model('Technician', technicianSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Attachment = mongoose.model('Attachment', attachmentSchema);
const Comment = mongoose.model('Comment', commentSchema);

// ---- MIDDLEWARE ----
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '16mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque_essa_chave',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }), // <- Correção aqui
  cookie: { maxAge: 24 * 3600 * 1000 }
}));

// Multer para uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// ---- CRIAR SUPERADMIN PADRÃO ----
(async () => {
  const count = await User.countDocuments();
  if (count === 0) {
    const hash = await bcrypt.hash('admin', 10);
    await User.create({ name: 'Super Admin', email: 'admin@localhost', password: hash, role: 'superadmin' });
    console.log('Usuário padrão criado: admin@localhost / senha: admin');
  }
})();

// ---- HELPERS ----
function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
function requireRoles(...roles) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
function safeJson(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(data);
}

// ---- AUTH ----
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Credenciais inválidas' });
  const user = await User.findOne({ email }).lean();
  if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Credenciais inválidas' });
  req.session.user = { id: user._id, name: user.name, email: user.email, role: user.role };
  safeJson(res, { ok: true, user: req.session.user });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => safeJson(res, req.session.user || null));

// ---- USERS CRUD ----
app.get('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const users = await User.find({}, { password: 0 }).sort({ _id: -1 });
  safeJson(res, users);
});
app.post('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const u = await User.create({ name, email, password: hash, role: role || 'operator' });
    safeJson(res, { id: u._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/users/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { $set: { name: req.body.name, role: req.body.role } });
  safeJson(res, { ok: true });
});
app.delete('/api/users/:id', requireLogin, requireRoles('superadmin'), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

// ---- SETTINGS ----
app.get('/api/settings', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const all = await Setting.find({});
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

// ---- TECHNICIANS CRUD ----
app.get('/api/technicians', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const techs = await Technician.find({}).sort({ active: -1, _id: -1 });
  safeJson(res, techs);
});
app.post('/api/technicians', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const t = await Technician.create({ user_id: req.body.user_id, display_name: req.body.display_name, email: req.body.email });
  safeJson(res, { id: t._id });
});
app.put('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await Technician.findByIdAndUpdate(req.params.id, req.body);
  safeJson(res, { ok: true });
});
app.delete('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  await Technician.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

// ---- TICKETS CRUD ----
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
  }
  safeJson(res, tickets);
});

app.post('/api/tickets', upload.array('attachments'), async (req, res) => {
  try {
    const { title, description, requester_name, requester_email, category_id, urgency, sla_hours } = req.body;
    if (!title) return res.status(400).json({ error: 'title_required' });
    if (!description) return res.status(400).json({ error: 'description_required' });
    if (!requester_name) return res.status(400).json({ error: 'requester_name_required' });

    const requester_id = req.session?.user?.id || null;
    const token = crypto.randomBytes(16).toString('hex');

    const t = await Ticket.create({
      title, description, requester_name, requester_email, requester_id, ticket_token: token,
      category_id, urgency, sla_hours
    });

    const savedFiles = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname) || '';
        const dest = path.join(uploadDir, file.filename + ext);
        fs.renameSync(file.path, dest);
        const url = `/uploads/${path.basename(dest)}`;
        savedFiles.push({ filename: file.originalname, url });
        await Attachment.create({ ticket_id: t._id, filename: file.originalname, url });
      }
    }
    safeJson(res, { ok: true, id: t._id, token, attachments: savedFiles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error', message: e.message });
  }
});

// ---- COMMENTS ----
app.post('/api/tickets/:id/comments', requireLogin, async (req, res) => {
  const c = await Comment.create({
    ticket_id: req.params.id,
    user_id: req.session.user.id,
    user_name: req.session.user.name,
    text: req.body.text
  });
  safeJson(res, { id: c._id });
});

// ---- DELETE TICKET ----
app.delete('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const attachments = await Attachment.find({ ticket_id: req.params.id });
  for (const a of attachments) {
    try {
      const filePath = path.join(__dirname, 'public', a.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
  await Attachment.deleteMany({ ticket_id: req.params.id });
  await Comment.deleteMany({ ticket_id: req.params.id });
  await Ticket.findByIdAndDelete(req.params.id);
  safeJson(res, { ok: true });
});

//
