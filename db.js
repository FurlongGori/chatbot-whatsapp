import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./tarefas.db");

// Tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tarefas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    responsavel TEXT,
    tarefa TEXT,
    pontos INTEGER,
    concluido INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ranking (
    nome TEXT PRIMARY KEY,
    pontos INTEGER DEFAULT 0
  )`);
});

// ---- Funções ----

// Adiciona 1 tarefa
export function adicionarTarefa(responsavel, tarefa, pontos, cb = () => {}) {
  db.run(
    "INSERT INTO tarefas (responsavel, tarefa, pontos, concluido) VALUES (?, ?, ?, 0)",
    [responsavel, tarefa, pontos],
    cb
  );
}

// Lista todas
export function listarTarefas(callback) {
  db.all("SELECT * FROM tarefas ORDER BY id ASC", (err, rows) => {
    if (err) {
      console.error(err);
      callback([]);
    } else {
      callback(rows || []);
    }
  });
}

// Concluir tarefa (retorna também os dados da tarefa)
export function concluirTarefa(id, callback) {
  db.get("SELECT * FROM tarefas WHERE id = ?", [id], (err, row) => {
    if (err) return callback(err, 0, null);
    if (!row || row.concluido) return callback(null, 0, null);

    db.run("UPDATE tarefas SET concluido = 1 WHERE id = ?", [id], function (uErr) {
      if (uErr) return callback(uErr, 0, null);

      // upsert no ranking somando pontos da tarefa concluída
      db.run(
        `INSERT INTO ranking (nome, pontos) VALUES (?, ?)
         ON CONFLICT(nome) DO UPDATE SET pontos = ranking.pontos + excluded.pontos`,
        [row.responsavel, row.pontos],
        (rErr) => callback(rErr, this.changes, row)
      );
    });
  });
}

// Penaliza 1 ponto por tarefa não concluída (retorna lista penalizada)
export function penalizarPendentes(callback) {
  db.all("SELECT * FROM tarefas WHERE concluido = 0", (err, rows) => {
    if (err) {
      console.error(err);
      return callback([]);
    }
    const pendentes = rows || [];
    // subtrai 1 ponto por tarefa pendente
    const stmt = db.prepare(
      `INSERT INTO ranking (nome, pontos) VALUES (?, ?)
       ON CONFLICT(nome) DO UPDATE SET pontos = ranking.pontos + excluded.pontos`
    );
    pendentes.forEach((t) => stmt.run([t.responsavel, -1]));
    stmt.finalize(() => callback(pendentes));
  });
}

// Retorna ranking ordenado
export function ranking(callback) {
  db.all("SELECT * FROM ranking ORDER BY pontos DESC, nome ASC", (err, rows) => {
    if (err) {
      console.error(err);
    }
    callback(rows || []);
  });
}

// Resetar ranking (usado no fim do mês)
export function resetarRanking(cb = () => {}) {
  db.run("DELETE FROM ranking", cb);
}
