// migrate_attachments.js
// Executar: node migrate_attachments.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_FILE = path.join(__dirname, 'data.db');

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) return console.error('Erro abrindo DB:', err);
  console.log('Conectado a', DB_FILE);
});

db.serialize(() => {
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='attachments'", (err, row) => {
    if (err) {
      console.error('Erro checando tabela attachments:', err.message || err);
      db.close();
      return;
    }
    if (!row) {
      console.log('Tabela attachments não existe — criando tabela nova com coluna url.');
      db.run(`CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER,
        filename TEXT,
        url TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
      )`, (e) => {
        if (e) console.error('Erro criando attachments:', e.message || e);
        else console.log('Tabela attachments criada com sucesso.');
        db.close();
      });
      return;
    }

    db.all("PRAGMA table_info('attachments')", (err2, cols) => {
      if (err2) {
        console.error('Erro PRAGMA table_info:', err2.message || err2);
        db.close(); return;
      }
      const names = (cols || []).map(c => c.name);
      const toAdd = [];
      if (!names.includes('url')) toAdd.push("ALTER TABLE attachments ADD COLUMN url TEXT");
      if (!names.includes('created_at')) toAdd.push("ALTER TABLE attachments ADD COLUMN created_at DATETIME DEFAULT (datetime('now'))");
      if (!toAdd.length) {
        console.log('Nenhuma alteração necessária na tabela attachments.');
        db.close();
        return;
      }
      const runNext = () => {
        if (!toAdd.length) { console.log('Migração attachments concluída.'); db.close(); return; }
        const sql = toAdd.shift();
        console.log('Executando:', sql);
        db.run(sql, (er) => {
          if (er) console.error('Erro ao executar:', sql, er.message || er);
          else console.log('OK ->', sql);
          runNext();
        });
      };
      runNext();
    });
  });
});
