import { MongoClient } from "mongodb";
if (!pendentes.length) return callback([]);


const bulkOps = pendentes.map((t) => ({
updateOne: {
filter: { nome: t.responsavel },
update: { $inc: { pontos: -1 } },
upsert: true
}
}));


if (bulkOps.length) await db.collection("ranking").bulkWrite(bulkOps);
callback(pendentes);
} catch (err) {
console.error("penalizarPendentes error:", err);
callback([]);
}
})
.catch((e) => callback([]));
}


// Retorna ranking ordenado
export function ranking(callback = () => {}) {
ready
.then(async () => {
try {
const rows = await db
.collection("ranking")
.find({})
.sort({ pontos: -1, nome: 1 })
.toArray();
callback(rows || []);
} catch (err) {
console.error("ranking error:", err);
callback([]);
}
})
.catch((e) => callback([]));
}


// Resetar ranking (usado no fim do mês)
export function resetarRanking(cb = () => {}) {
ready
.then(async () => {
try {
await db.collection("ranking").deleteMany({});
cb();
} catch (err) {
console.error("resetarRanking error:", err);
cb(err);
}
})
.catch((e) => cb(e));
}


// exportar função para fechar conexão caso precise (opcional)
export async function fecharConexao() {
if (client) await client.close();
}