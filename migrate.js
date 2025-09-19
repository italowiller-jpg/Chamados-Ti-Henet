// migrate.js
// Uso: node migrate.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'data.db');

if (!fs.existsSync(DB_FILE)) {
  console.error('Arquivo data.db não encontrado em', DB_FILE);
  process.exit(1);
}

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Erro ao abrir banco:', err.message || err);
    process.exit(1);
  }
});

db.serialize(() => {
  console.log('Checando colunas da tabela tickets...');
  db.all("PRAGMA table_info('tickets')", (err, cols) => {
    if (err) {
      console.error('Erro ao consultar PRAGMA table_info:', err.message || err);
      db.close();
      process.exit(1);
    }

    const existing = (cols || []).map(c => c.name);
    const expected = [
      { name: 'requester_id', sql: "ALTER TABLE tickets ADD COLUMN requester_id INTEGER" },
      { name: 'ticket_token', sql: "ALTER TABLE tickets ADD COLUMN ticket_token TEXT" },
      { name: 'assigned_name', sql: "ALTER TABLE tickets ADD COLUMN assigned_name TEXT" },
      { name: 'category_id', sql: "ALTER TABLE tickets ADD COLUMN category_id TEXT" },
      { name: 'sla_hours', sql: "ALTER TABLE tickets ADD COLUMN sla_hours INTEGER" },
      { name: 'updated_at', sql: "ALTER TABLE tickets ADD COLUMN updated_at DATETIME" }
    ];

    const toAdd = expected.filter(e => !existing.includes(e.name));
    if (toAdd.length === 0) {
      console.log('Nenhuma coluna faltando — banco já está atualizado.');
      db.close();
      return;
    }

    console.log('Colunas faltando:', toAdd.map(t => t.name).join(', '));
    let i = 0;
    const next = () => {
      if (i >= toAdd.length) {
        console.log('Migração concluída com sucesso.');
        db.close();
        return;
      }
      const item = toAdd[i];
      console.log(`Adicionando coluna ${item.name} ...`);
      db.run(item.sql, function(err2) {
        if (err2) {
          console.error(`Erro ao adicionar ${item.name}:`, err2.message || err2);
        } else {
          console.log(`Coluna ${item.name} adicionada.`);
        }
        if (item.name === 'updated_at') {
          db.run("UPDATE tickets SET updated_at = datetime('now') WHERE updated_at IS NULL", (ue) => {
            if (ue) console.warn('Erro ao popular updated_at:', ue.message || ue);
            i++;
            next();
          });
        } else {
          i++;
          next();
        }
      });
    };
    next();
  });
});
