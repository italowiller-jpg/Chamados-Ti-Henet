// migrate_technicians.js
// Uso: node migrate_technicians.js
// Faz alteração segura: checa colunas existentes e adiciona as faltantes.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_FILE);

const expectedCols = {
  user_id: 'INTEGER',
  display_name: 'TEXT',
  email: 'TEXT',
  active: 'INTEGER',
  created_at: "DATETIME"
};

console.log('Abrindo banco:', DB_FILE);
db.serialize(() => {
  db.all("PRAGMA table_info('technicians')", (err, rows) => {
    if (err) {
      console.error('Erro ao ler schema technicians:', err.message || err);
      process.exit(1);
    }
    const existing = (rows || []).map(r => r.name);
    const toAdd = Object.entries(expectedCols).filter(([c]) => !existing.includes(c));
    if (toAdd.length === 0) {
      console.log('Nenhuma coluna faltando na tabela technicians. Nada a fazer.');
      db.close();
      return;
    }
    console.log('Colunas faltando:', toAdd.map(x=>x[0]).join(', '));
    (function next(i){
      if (i >= toAdd.length) {
        console.log('Migração concluída com sucesso.');
        db.close();
        return;
      }
      const [col, type] = toAdd[i];
      const sql = `ALTER TABLE technicians ADD COLUMN ${col} ${type}`;
      console.log('Adicionando coluna', col, type);
      db.run(sql, [], (e) => {
        if (e) {
          console.error('Erro ao adicionar coluna', col, e.message || e);
          // continuar mesmo com erro para não travar demais
        } else {
          console.log('Coluna adicionada:', col);
        }
        next(i+1);
      });
    })(0);
  });
});
