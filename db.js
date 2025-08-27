// db.js (MongoDB Atlas)
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI; // coloque sua URI do MongoDB Atlas no Railway ou .env
const client = new MongoClient(uri);
let db;

async function conectar() {
  if (!db) {
    await client.connect();
    db = client.db("checklist"); // nome do banco
    console.log("✅ Conectado ao MongoDB Atlas!");
  }
  return db;
}

// ---- Funções ----

// Adiciona 1 tarefa
export async function adicionarTarefa(responsavel, tarefa, pontos) {
  const db = await conectar();
  await db.collection("tarefas").insertOne({
    responsavel,
    tarefa,
    pontos,
    concluido: false
  });
}

// Lista todas
export async function listarTarefas() {
  const db = await conectar();
  return await db.collection("tarefas").find().sort({ _id: 1 }).toArray();
}

// Concluir tarefa
export async function concluirTarefa(id) {
  const db = await conectar();
  const tarefa = await db.collection("tarefas").findOne({ _id: new ObjectId(id) });
  if (!tarefa || tarefa.concluido) return null;

  await db.collection("tarefas").updateOne(
    { _id: new ObjectId(id) },
    { $set: { concluido: true } }
  );

  await db.collection("ranking").updateOne(
    { nome: tarefa.responsavel },
    { $inc: { pontos: tarefa.pontos } },
    { upsert: true }
  );

  return tarefa;
}

// Penalizar pendentes
export async function penalizarPendentes() {
  const db = await conectar();
  const pendentes = await db.collection("tarefas").find({ concluido: false }).toArray();

  for (let t of pendentes) {
    await db.collection("ranking").updateOne(
      { nome: t.responsavel },
      { $inc: { pontos: -1 } },
      { upsert: true }
    );
  }

  return pendentes;
}

// Ranking
export async function ranking() {
  const db = await conectar();
  return await db.collection("ranking").find().sort({ pontos: -1, nome: 1 }).toArray();
}

// Resetar ranking
export async function resetarRanking() {
  const db = await conectar();
  await db.collection("ranking").deleteMany({});
}
