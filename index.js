import baileys, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import {
  adicionarTarefa,
  listarTarefas,
  concluirTarefa,
  penalizarPendentes,
  ranking,
  resetarRanking
} from "./db.js";
import qrcode from "qrcode-terminal";
import cron from "node-cron";

// Helper: extrair texto de diferentes tipos de mensagem do Baileys
function getTexto(msg) {
  const m = msg.message;
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    ""
  ).trim();
}

const GRUPO_ID = "120363420653381076@g.us"; // ajuste aqui

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const sock = baileys.default({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("📱 Escaneie o QR Code para conectar.");
    }
    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Conexão fechada, reconectar:", shouldReconnect);
      if (shouldReconnect) iniciarBot();
    } else if (connection === "open") {
      console.log("✅ Conectado!");
    }
  });

  // ---------- CRONs ----------
  // 06h - Checklist
  cron.schedule("0 6 * * *", async () => {
    listarTarefas(async (tarefas) => {
      if (!tarefas.length) {
        await sock.sendMessage(GRUPO_ID, { text: "☀️ Bom dia! Nenhuma tarefa cadastrada hoje." });
        return;
      }
      const lista = tarefas
        .map(t => `${t.id}. ${t.tarefa} — ${t.responsavel ?? "N/A"} — ${t.concluido ? "✔️" : "⏳"} (${t.pontos} pts)`)
        .join("\n");
      await sock.sendMessage(GRUPO_ID, { text: "☀️ Bom dia! Checklist de hoje:\n\n" + lista });
    });
  });

  // 18h - Pendentes
  cron.schedule("0 18 * * *", async () => {
    listarTarefas(async (tarefas) => {
      const pend = (tarefas || []).filter(t => !t.concluido);
      if (!pend.length) {
        await sock.sendMessage(GRUPO_ID, { text: "🎉 18h: Sem tarefas pendentes. Mandaram bem!" });
        return;
      }
      const lista = pend.map(t => `${t.id}. ${t.tarefa} — ${t.responsavel ?? "N/A"} (${t.pontos} pts)`).join("\n");
      await sock.sendMessage(GRUPO_ID, { text: "⏳ 18h — Tarefas pendentes:\n\n" + lista });
    });
  });

  // 23h - Penalização
  cron.schedule("0 23 * * *", async () => {
    penalizarPendentes(async (pend) => {
      if (!pend.length) {
        await sock.sendMessage(GRUPO_ID, { text: "🌙 23h: Tudo concluído hoje. Sem penalizações! ✅" });
        return;
      }
      const lista = pend.map(t => `${t.tarefa} — ${t.responsavel ?? "N/A"}`).join("\n");
      await sock.sendMessage(GRUPO_ID, {
        text: `⚠️ 23h — Penalização aplicada às tarefas não concluídas:\n\n${lista}\n\nCada responsável perdeu -1 ponto por tarefa.`
      });
    });
  });

  // 23:59 do último dia — Ranking final + reset
  cron.schedule("59 23 28-31 * *", async () => {
    const hoje = new Date();
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    if (hoje.getDate() !== ultimoDia) return;

    ranking(async (r) => {
      const texto =
        (r || []).length
          ? r.map((p, i) => `${i + 1}º ${p.nome} — ${p.pontos} pts`).join("\n")
          : "Sem pontuações neste mês.";
      await sock.sendMessage(GRUPO_ID, { text: "🏆 Ranking final do mês:\n\n" + texto });
      resetarRanking(() => console.log("📊 Ranking resetado para o novo mês."));
    });
  });

  // ---------- Mensagens ----------
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;

    const remetente = msg.key.remoteJid;
    const textoBruto = getTexto(msg);
    if (!textoBruto) return;

    const texto = textoBruto.trim();
    const lower = texto.toLowerCase();

    console.log("📩 Mensagem:", texto);

    // Comando: help
    if (lower === "help") {
      const helpMessage = `
    📖 *Lista de Comandos Disponíveis* 📖

    🟢 *adicionar Nome, Tarefa, Pontos*
       ➝ Adiciona uma nova tarefa para uma pessoa.
       Ex: adicionar Fabio, Estudar, 10

    🟢 *listar*
       ➝ Lista todas as tarefas cadastradas.

    🟢 *concluir ID*
       ➝ Marca a tarefa de acordo com o ID como concluída e soma os pontos.
       Ex: concluir 1

    🟢 *ranking*
       ➝ Mostra o ranking de pontos acumulados.

    🟢 *id*
       ➝ Mostra o ID do grupo ou do chat atual.

    🟢 *help*
       ➝ Exibe esta lista de comandos.
      `;

      await sock.sendMessage(remetente, { text: helpMessage });
      return;
    }

    // Comando: ID do chat
    if (lower === "id") {
      await sock.sendMessage(remetente, { text: `📌 ID deste chat:\n${remetente}` });
      return;
    }

    // Comando: adicionar (com vírgulas)
    if (lower.startsWith("adicionar")) {
      const linhas = texto
        .slice(9) // remove "adicionar"
        .trim()
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      if (!linhas.length) {
        await sock.sendMessage(remetente, {
          text:
            "⚠️ Formato inválido!\nUse:\n" +
            "adicionar Nome, Tarefa, Pontos\n" +
            "Tarefa 2, Pontos (opcional, mantém o mesmo Nome)\n"
        });
        return;
      }

      let responsavelAtual = null;
      const respostas = [];

      for (let i = 0; i < linhas.length; i++) {
        const partes = linhas[i].split(",").map(p => p.trim()).filter(Boolean);

        if (i === 0 && partes.length === 3) {
          const [resp, tarefa, ptsStr] = partes;
          const pts = parseInt(ptsStr, 10);
          if (!resp || !tarefa || isNaN(pts)) {
            respostas.push(`⚠️ Linha inválida: "${linhas[i]}"`);
            continue;
          }
          responsavelAtual = resp;
          await new Promise(res => adicionarTarefa(resp, tarefa, pts, res));
          respostas.push(`✅ Tarefa adicionada para ${resp}: "${tarefa}" valendo ${pts} pts.`);
        } else if (i > 0 && partes.length === 2 && responsavelAtual) {
          const [tarefa, ptsStr] = partes;
          const pts = parseInt(ptsStr, 10);
          if (!tarefa || isNaN(pts)) {
            respostas.push(`⚠️ Linha inválida: "${linhas[i]}"`);
            continue;
          }
          await new Promise(res => adicionarTarefa(responsavelAtual, tarefa, pts, res));
          respostas.push(`✅ Tarefa adicionada para ${responsavelAtual}: "${tarefa}" valendo ${pts} pts.`);
        } else if (partes.length === 3) {
          const [resp, tarefa, ptsStr] = partes;
          const pts = parseInt(ptsStr, 10);
          if (!resp || !tarefa || isNaN(pts)) {
            respostas.push(`⚠️ Linha inválida: "${linhas[i]}"`);
            continue;
          }
          responsavelAtual = resp;
          await new Promise(res => adicionarTarefa(resp, tarefa, pts, res));
          respostas.push(`✅ Tarefa adicionada para ${resp}: "${tarefa}" valendo ${pts} pts.`);
        } else {
          respostas.push(`⚠️ Linha inválida: "${linhas[i]}"`);
        }
      }

      await sock.sendMessage(remetente, { text: respostas.join("\n") });
      return;
    }

    // Comando: listar
    if (lower === "listar") {
      listarTarefas(async (tarefas) => {
        if (!tarefas.length) {
          await sock.sendMessage(remetente, { text: "📋 Nenhuma tarefa encontrada." });
          return;
        }
        const lista = tarefas
          .map(t => `${t.id}. ${t.tarefa} — ${t.responsavel ?? "N/A"} — ${t.concluido ? "✔️" : "⏳"} (${t.pontos} pts)`)
          .join("\n");
        await sock.sendMessage(remetente, { text: "📋 Checklist:\n" + lista });
      });
      return;
    }

    // Comando: concluir <id>
    if (lower.startsWith("concluir")) {
      const id = parseInt(lower.replace("concluir", "").trim(), 10);
      if (isNaN(id)) {
        await sock.sendMessage(remetente, { text: "⚠️ Use: concluir <id>" });
        return;
      }
      concluirTarefa(id, async (err, changes, tarefaRow) => {
        if (changes > 0 && tarefaRow) {
          await sock.sendMessage(remetente, {
            text: `🎉 Tarefa ${id} concluída! ${tarefaRow.responsavel} ganhou ${tarefaRow.pontos} pontos.`
          });
        } else {
          await sock.sendMessage(remetente, { text: "❌ ID inválido ou tarefa já concluída." });
        }
      });
      return;
    }

    // Comando: ranking
    if (lower === "ranking") {
      ranking(async (r) => {
        const textoRanking =
          (r || []).length
            ? r.map((p, i) => `${i + 1}º ${p.nome} — ${p.pontos} pts`).join("\n")
            : "Sem pontuações ainda.";
        await sock.sendMessage(remetente, { text: "🏆 Ranking atual:\n\n" + textoRanking });
      });
      return;
    }
  });
}

iniciarBot();
