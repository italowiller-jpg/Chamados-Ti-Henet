// server.js (versão final — atribui assigned_name automaticamente e é defensivo)
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const DB_FILE = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_FILE);

// --- Middleware ---
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '16mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque_essa_chave',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 3600 * 1000 }
}));

// Multer para uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// Helpers defensivos para attachments (evitam erro se a coluna url não existir)
function selectAttachmentsForTicket(ticketId, cb) {
  db.all("PRAGMA table_info('attachments')", (err, cols) => {
    if (err) return cb(err);
    const names = (cols || []).map(c => c.name);
    const fields = [];
    if (names.includes('id')) fields.push('id');
    if (names.includes('filename')) fields.push('filename');
    if (names.includes('url')) fields.push('url');
    if (names.includes('created_at')) fields.push('created_at');
    if (!fields.length) return cb(null, []);
    const sql = `SELECT ${fields.join(', ')} FROM attachments WHERE ticket_id = ?`;
    db.all(sql, [ticketId], (e, rows) => {
      if (e) return cb(e);
      return cb(null, rows || []);
    });
  });
}

function getAttachmentUrlsForTicket(ticketId, cb) {
  db.all("PRAGMA table_info('attachments')", (err, cols) => {
    if (err) return cb(err);
    const names = (cols || []).map(c => c.name);
    if (!names.includes('url')) return cb(null, []);
    db.all(`SELECT url FROM attachments WHERE ticket_id = ?`, [ticketId], (e, rows) => {
      if (e) return cb(e);
      const urls = (rows || []).map(r => r.url).filter(Boolean);
      cb(null, urls);
    });
  });
}

// --- Inicializar tabelas (criadoras se não existirem) ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'operator',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    display_name TEXT,
    email TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_email TEXT,
    requester_id INTEGER,
    ticket_token TEXT,
    status TEXT DEFAULT 'new',
    urgency TEXT DEFAULT 'medium',
    assigned_to INTEGER,
    assigned_name TEXT,
    category_id TEXT,
    sla_hours INTEGER,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    filename TEXT,
    url TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    text TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  // criar superadmin default se não houver users
  db.get(`SELECT COUNT(*) as cnt FROM users`, (err, row) => {
    if (!err && row && row.cnt === 0) {
      const pw = 'admin';
      bcrypt.hash(pw, 10).then(hash => {
        db.run(`INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)`, ['Super Admin', 'admin@localhost', hash, 'superadmin']);
        console.log('Usuário default criado: admin@localhost / senha: admin — altere no primeiro login!');
      }).catch(()=>{});
    }
  });
});

// --- Auth helpers ---
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
function requireRoles(...roles) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}
function safeJson(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(data);
}

// --- AUTH endpoints ---
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Credenciais inválidas' });
  db.get(`SELECT id, name, email, password, role FROM users WHERE email = ?`, [email], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(400).json({ error: 'Credenciais inválidas' });
    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.status(400).json({ error: 'Credenciais inválidas' });
    req.session.user = { id: row.id, name: row.name, email: row.email, role: row.role };
    safeJson(res, { ok: true, user: req.session.user });
  });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => { safeJson(res, req.session.user || null); });

// --- USERS CRUD ---
app.get('/api/users', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  db.all(`SELECT id, name, email, role, created_at FROM users ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, rows);
  });
});
app.post('/api/users', requireLogin, requireRoles('admin','superadmin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  const hash = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (name,email,password,role) VALUES (?, ?, ?, ?)`, [name, email, hash, role || 'operator'], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { id: this.lastID });
  });
});
app.put('/api/users/:id', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const id = req.params.id;
  const { name, role } = req.body;
  db.run(`UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role) WHERE id = ?`, [name || null, role || null, id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { ok: true });
  });
});
app.delete('/api/users/:id', requireLogin, requireRoles('superadmin'), (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM users WHERE id = ?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { ok: true });
  });
});

// --- SETTINGS ---
app.get('/api/settings', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });
    safeJson(res, out);
  });
});
app.put('/api/settings', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (!keys.length) return safeJson(res, { ok: true });

  db.serialize(() => {
    const stmtIns = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    keys.forEach(k => {
      let val = updates[k];
      if (typeof val === 'object') val = JSON.stringify(val);
      stmtIns.run(k, String(val));
    });
    stmtIns.finalize(err => {
      if (err) return res.status(500).json({ error: err.message });
      safeJson(res, { ok: true });
    });
  });
});

// --- TECHNICIANS CRUD ---
app.get('/api/technicians', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  db.all(`SELECT id, user_id, display_name, email, active, created_at FROM technicians ORDER BY active DESC, id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, rows);
  });
});
app.post('/api/technicians', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const { user_id, display_name, email } = req.body;
  db.run(`INSERT INTO technicians (user_id, display_name, email, active) VALUES (?, ?, ?, 1)`, [user_id || null, display_name || null, email || null], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { id: this.lastID });
  });
});
app.put('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const id = req.params.id;
  const { display_name, active } = req.body;
  const updates = [];
  const params = [];
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (updates.length === 0) return safeJson(res, { ok: true });
  params.push(id);
  db.run(`UPDATE technicians SET ${updates.join(', ')} WHERE id = ?`, params, function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { ok: true });
  });
});
app.delete('/api/technicians/:id', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM technicians WHERE id = ?`, [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { ok: true });
  });
});

// --- TICKETS CRUD & COMMENTS ---
app.get('/api/tickets', (req, res) => {
  const status = req.query.status;
  const urgency = req.query.urgency;
  const wh = [];
  const params = [];

  if (status) { wh.push('status = ?'); params.push(status); }
  if (urgency) { wh.push('urgency = ?'); params.push(urgency); }

  const user = req.session && req.session.user;
  const isPrivileged = user && (['admin','superadmin','technician'].includes(user.role));

  if (!isPrivileged) {
    if (user) {
      wh.push('(requester_id = ? OR requester_email = ?)');
      params.push(user.id, user.email);
    } else if (req.query.requester_email) {
      wh.push('requester_email = ?');
      params.push(req.query.requester_email);
    } else {
      return safeJson(res, []);
    }
  }

  const where = wh.length ? `WHERE ${wh.join(' AND ')}` : '';
  db.all(`SELECT * FROM tickets ${where} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const tasks = (rows || []).map(r => new Promise((resolve) => {
      selectAttachmentsForTicket(r.id, (err2, atts) => {
        r.attachments = atts || [];
        // preencher assigned_name caso esteja vazio
        if ((!r.assigned_name || r.assigned_name === '') && r.assigned_to) {
          db.get(`SELECT display_name FROM technicians WHERE id = ?`, [r.assigned_to], (e, tr) => {
            if (!e && tr && tr.display_name) r.assigned_name = tr.display_name;
            resolve();
          });
        } else resolve();
      });
    }));
    Promise.all(tasks).then(() => safeJson(res, rows));
  });
});

// POST /api/tickets (com attachments)
app.post('/api/tickets', upload.array('attachments'), (req, res) => {
  try {
    const title = req.body && req.body.title ? String(req.body.title).trim() : '';
    const description = req.body && req.body.description ? String(req.body.description).trim() : '';
    const requester_name = req.body && req.body.requester_name ? String(req.body.requester_name).trim() : '';
    const requester_email = req.body && req.body.requester_email ? String(req.body.requester_email).trim() : null;
    const category_id = req.body && req.body.category_id ? String(req.body.category_id).trim() : null;
    const urgency = req.body && req.body.urgency ? String(req.body.urgency).trim() : 'medium';
    const sla_hours = req.body && req.body.sla_hours ? req.body.sla_hours : null;

    if (!title) return res.status(400).json({ error: 'title_required', message: 'Título é obrigatório.' });
    if (!description) return res.status(400).json({ error: 'description_required', message: 'Descrição é obrigatória.' });
    if (!requester_name) return res.status(400).json({ error: 'requester_name_required', message: 'Nome do solicitante é obrigatório.' });

    const requester_id = req.session && req.session.user ? req.session.user.id : null;
    const token = crypto.randomBytes(16).toString('hex');

    db.run(
      `INSERT INTO tickets (title, description, requester_name, requester_email, requester_id, ticket_token, category_id, urgency, sla_hours, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [title, description, requester_name, requester_email || null, requester_id, token, category_id || null, urgency || 'medium', sla_hours || null],
      function(err) {
        if (err) {
          console.error('DB INSERT TICKET ERROR', err);
          return res.status(500).json({ error: 'db_error', message: err.message });
        }
        const ticketId = this.lastID;
        const savedFiles = [];

        if (req.files && req.files.length) {
          req.files.forEach(file => {
            try {
              const ext = path.extname(file.originalname) || '';
              const dest = path.join(uploadDir, file.filename + ext);
              fs.renameSync(file.path, dest);
              const url = `/uploads/${path.basename(dest)}`;
              savedFiles.push({ filename: file.originalname, url });
              db.run(`INSERT INTO attachments (ticket_id, filename, url) VALUES (?, ?, ?)`, [ticketId, file.originalname, url], function(){});
            } catch(e) {
              console.error('Erro ao gravar anexo', e);
              try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch(_) {}
            }
          });
        }

        return safeJson(res, { ok: true, id: ticketId, token, attachments: savedFiles });
      });
  } catch(e) {
    console.error('POST /api/tickets - unexpected error', e);
    return res.status(500).json({ error: 'unexpected', message: e.message });
  }
});

// Public endpoint por token
app.get('/api/public/tickets/:token', (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });

  db.get(`SELECT id, title, description, requester_name, requester_email, status, urgency, assigned_name, created_at, updated_at, ticket_token, assigned_to FROM tickets WHERE ticket_token = ?`, [token], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Chamado não encontrado' });

    db.all(`SELECT id, user_id, user_name, text, created_at FROM comments WHERE ticket_id = ? ORDER BY created_at ASC`, [row.id], (err2, comms) => {
      if (err2) return res.status(500).json({ error: err2.message });
      selectAttachmentsForTicket(row.id, (e, atts) => {
        if (e) return res.status(500).json({ error: e.message });
        // preencher assigned_name se vazio
        if ((!row.assigned_name || row.assigned_name === '') && row.assigned_to) {
          db.get(`SELECT display_name FROM technicians WHERE id = ?`, [row.assigned_to], (te, tr) => {
            if (!te && tr && tr.display_name) row.assigned_name = tr.display_name;
            row.comments = comms || [];
            row.attachments = atts || [];
            safeJson(res, row);
          });
        } else {
          row.comments = comms || [];
          row.attachments = atts || [];
          safeJson(res, row);
        }
      });
    });
  });
});

app.get('/api/tickets/:id', requireLogin, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM tickets WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const user = req.session && req.session.user;
    const isPrivileged = user && (['admin','superadmin','technician'].includes(user.role));
    const isOwner = user && ((row.requester_id && Number(row.requester_id) === Number(user.id)) || (user.email && row.requester_email && user.email === row.requester_email));

    if (!isPrivileged && !isOwner) return res.status(403).json({ error: 'Forbidden' });

    db.all(`SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC`, [id], (err2, comms) => {
      if (err2) return res.status(500).json({ error: err2.message });
      selectAttachmentsForTicket(id, (e, atts) => {
        if (e) return res.status(500).json({ error: e.message });
        // preencher assigned_name se estiver vazio
        if ((!row.assigned_name || row.assigned_name === '') && row.assigned_to) {
          db.get(`SELECT display_name FROM technicians WHERE id = ?`, [row.assigned_to], (te, tr) => {
            if (!te && tr && tr.display_name) row.assigned_name = tr.display_name;
            row.comments = comms || [];
            row.attachments = atts || [];
            safeJson(res, row);
          });
        } else {
          row.comments = comms || [];
          row.attachments = atts || [];
          safeJson(res, row);
        }
      });
    });
  });
});

// PUT /api/tickets/:id  -> agora resolve assigned_name automaticamente se assigned_to for passado
app.put('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin','technician','operator'), (req, res) => {
  const id = req.params.id;
  let { status, assigned_to, assigned_name, urgency } = req.body;

  // normalize assigned_to: '' or null -> null, else number
  if (assigned_to === '' || assigned_to === null) assigned_to = null;
  else if (assigned_to !== undefined) assigned_to = Number(assigned_to);

  const doUpdate = (resolvedAssignedName) => {
    const updates = [];
    const params = [];
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to); updates.push('assigned_name = ?'); params.push(resolvedAssignedName || null); }
    else if (assigned_name !== undefined) { updates.push('assigned_name = ?'); params.push(assigned_name); }
    if (urgency !== undefined) { updates.push('urgency = ?'); params.push(urgency); }
    updates.push('updated_at = datetime("now")');
    const sql = `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);
    db.run(sql, params, function(err){
      if (err) return res.status(500).json({ error: err.message });
      safeJson(res, { ok: true });
    });
  };

  // if assigned_to provided, try to resolve assigned_name from technicians table (otherwise keep assigned_name from client)
  if (assigned_to !== undefined) {
    if (assigned_to === null) {
      // clearing assignment
      doUpdate(null);
    } else {
      db.get(`SELECT display_name FROM technicians WHERE id = ?`, [assigned_to], (err, row) => {
        const resolved = (!err && row && row.display_name) ? row.display_name : (assigned_name || null);
        doUpdate(resolved);
      });
    }
  } else {
    doUpdate(assigned_name);
  }
});

app.delete('/api/tickets/:id', requireLogin, requireRoles('admin','superadmin'), (req, res) => {
  const id = req.params.id;
  getAttachmentUrlsForTicket(id, (errUrls, urls) => {
    if (!errUrls && urls && urls.length) {
      urls.forEach(u => {
        try {
          const filePath = path.join(__dirname, 'public', u);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch(e){}
      });
    }
    db.run(`DELETE FROM attachments WHERE ticket_id = ?`, [id], function(err2){
      db.run(`DELETE FROM comments WHERE ticket_id = ?`, [id], function(err3){
        db.run(`DELETE FROM tickets WHERE id = ?`, [id], function(err4){
          if (err4) return res.status(500).json({ error: err4.message });
          safeJson(res, { ok: true });
        });
      });
    });
  });
});

// comments
app.post('/api/tickets/:id/comments', requireLogin, (req, res) => {
  const ticket_id = req.params.id;
  const user_id = req.session.user ? req.session.user.id : null;
  const user_name = req.session.user ? req.session.user.name : (req.body.user_name || 'Visitante');
  const text = req.body.text || '';
  db.run(`INSERT INTO comments (ticket_id, user_id, user_name, text) VALUES (?, ?, ?, ?)`, [ticket_id, user_id, user_name, text], function(err){
    if (err) return res.status(500).json({ error: err.message });
    safeJson(res, { id: this.lastID });
  });
});

// upload
app.post('/api/upload', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const dest = path.join(uploadDir, req.file.filename + path.extname(req.file.originalname));
  fs.renameSync(req.file.path, dest);
  const url = `/uploads/${path.basename(dest)}`;
  safeJson(res, { ok: true, url });
});

// serve static
app.use(express.static(path.join(__dirname, 'public')));

// explicit routes
app.get('/submit.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'submit.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-edit.html')));
app.get('/admin-edit.html', requireLogin, requireRoles('admin','superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-edit.html')));
app.get('/stats.html', requireLogin, requireRoles('admin','superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin-reports.html')));
app.get('/superadmin-reports.html', requireLogin, requireRoles('admin','superadmin'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin-reports.html')));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
