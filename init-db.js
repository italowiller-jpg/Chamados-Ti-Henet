// init-db.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./data.db');

async function run() {
  db.serialize(async () => {
    // users
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT, 
      email TEXT UNIQUE, 
      password TEXT, 
      role TEXT, 
      created_at TEXT
    )`);

    // technicians
    db.run(`CREATE TABLE IF NOT EXISTS technicians (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      user_id INTEGER, 
      display_name TEXT, 
      active INTEGER DEFAULT 1
    )`);

    // categories (dropdown editable)
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT UNIQUE, 
      active INTEGER DEFAULT 1, 
      created_at TEXT
    )`);

    // settings
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, 
      value TEXT
    )`);

    // tickets
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      requester_name TEXT,
      requester_email TEXT,
      urgency TEXT DEFAULT 'medium',
      sla_hours INTEGER DEFAULT NULL,
      status TEXT DEFAULT 'new',
      assigned_to INTEGER DEFAULT NULL,
      created_at TEXT,
      updated_at TEXT
    )`);

    // comments
    db.run(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      user_id INTEGER,
      text TEXT,
      created_at TEXT
    )`);

    // attachments
    db.run(`CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      filename TEXT,
      originalname TEXT,
      uploaded_at TEXT
    )`);

    // seed categories
    const now = new Date().toISOString();
    const categories = ['Rede / Internet', 'Hardware', 'Software', 'Acesso / Senha', 'Solicitação de Serviço'];
    const stmtCat = db.prepare(`INSERT OR IGNORE INTO categories (name, active, created_at) VALUES (?,1,?)`);
    categories.forEach(c => stmtCat.run(c, now));
    stmtCat.finalize();

    // seed settings (já corrigido para Henet)
    const settings = [
      ['site.title', 'Henet - Sistema de Chamados'],
      ['site.subtitle', 'Abra um chamado e nossa equipe de TI irá lhe atender.'],
      ['submit.instructions', 'Descreva o problema com o máximo de detalhes.']
    ];
    const stmtSet = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)`);
    settings.forEach(s => stmtSet.run(s[0], s[1]));
    stmtSet.finalize();

    // usuário inicial: garantir superadmin
    const adminEmail = 'Tiadm@henet.com.br';
    const adminPass = 'Grupoti123@';
    const adminName = 'Admin Henet';
    const saltRounds = 10;

    db.get(`SELECT id FROM users WHERE email = ?`, [adminEmail], async (err, row) => {
      if (err) {
        console.error('Erro ao verificar usuário admin:', err);
        db.close();
        return;
      }

      if (!row) {
        // cria o usuário como superadmin
        const hash = await bcrypt.hash(adminPass, saltRounds);
        db.run(
          `INSERT INTO users (name,email,password,role,created_at) VALUES (?,?,?,?,?)`,
          [adminName, adminEmail, hash, 'superadmin', now],
          function (insertErr) {
            if (insertErr) {
              console.error('Erro ao criar superadmin:', insertErr);
              db.close();
              return;
            }
            console.log('Usuário superadmin criado:', adminEmail, '/', adminPass);
            // cria técnico vinculado
            db.run(
              `INSERT INTO technicians (user_id, display_name, active) VALUES (?,?,1)`,
              [this.lastID, adminName],
              (techErr) => {
                if (techErr) console.error('Erro ao criar técnico vinculado ao superadmin:', techErr);
                else console.log('Técnico vinculado ao superadmin criado.');
                console.log('Banco inicializado (data.db).');
                db.close();
              }
            );
          }
        );
      } else {
        // garante que a role seja superadmin se já existir
        db.run(`UPDATE users SET role = ? WHERE email = ?`, ['superadmin', adminEmail], function (updateErr) {
          if (updateErr) {
            console.error('Erro ao atualizar role para superadmin:', updateErr);
            db.close();
            return;
          }
          console.log('Admin já existia — role garantida como superadmin:', adminEmail);
          // opcional: garantir que exista um técnico vinculado
          db.get(`SELECT id FROM technicians WHERE user_id = ?`, [row.id], (tErr, tRow) => {
            if (tErr) {
              console.error('Erro verificando técnico vinculado:', tErr);
              db.close();
              return;
            }
            if (!tRow) {
              db.run(`INSERT INTO technicians (user_id, display_name, active) VALUES (?,?,1)`, [row.id, adminName], (insErr) => {
                if (insErr) console.error('Erro ao criar técnico vinculado:', insErr);
                else console.log('Técnico vinculado ao superadmin criado (registro ausente).');
                console.log('Banco inicializado (data.db).');
                db.close();
              });
            } else {
              console.log('Técnico já vinculado ao usuário superadmin.');
              console.log('Banco inicializado (data.db).');
              db.close();
            }
          });
        });
      }
    });
  });
}

run();
