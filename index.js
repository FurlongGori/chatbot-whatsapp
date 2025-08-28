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

const { default: makeWASocket } = baileys;

let tarefasPadrao = []; // tarefas padrão em memória

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  // reconexão
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startSock();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // --- CRON JOBS ---
  // 06h → enviar tarefas padrão
  cron.schedule("0 6 * * *", async () => {
    if (tarefasPadrao.length) {
      const lista = tarefasPadrao.map((t, i) => `${i + 1}. ${t}`).join("\n");
      await sock.sendMessage("120363420653381076@g.us", {
        text: `🌅 Bom dia! Aqui estão as tarefas padrão de hoje:\n${lista}`
      });
    }
  });

  // 20h → pendentes
  cron.schedule("0 20 * * *", async () => {
    const pendentes = await listarTarefas();
    const aindaPendentes = pendentes.filter(t => !t.concluido);
    if (aindaPendentes.length) {
      const lista = aindaPendentes.map(t => `${t.responsavel} — ${t.tarefa}`).join("\n");
      await sock.sendMessage("YOUR_GROUP_OR_USER_ID@s.whatsapp.net", {
        text: `⏰ Aviso das 20h!\nTarefas pendentes:\n${lista}`
      });
    }
  });

  // 23h → penalizar
  cron.schedule("0 23 * * *", async () => {
    const penalizados = await penalizarPendentes();
    if (penalizados.length) {
      await sock.sendMessage("YOUR_GROUP_OR_USER_ID@s.whatsapp.net", {
        text: `⚠️ Penalização aplicada! ${penalizados.length} responsáveis perderam pontos por tarefas não concluídas.`
      });
    }
  });

  // último dia do mês → ranking final + reset
  cron.schedule("59 23 28-31 * *", async () => {
    const hoje = new Date();
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);

    if (amanha.getDate() === 1) {
      const rank = await ranking();
      if (rank.length) {
        const textoRanking = rank
          .map((r, i) => `${i + 1}. ${r.nome} — ${r.pontos} pts`)
          .join("\n");
        await sock.sendMessage("120363420653381076@g.us", {
          text: `🏆 Ranking Final do Mês:\n${textoRanking}\n\n🥇 Vencedor: ${rank[0].nome} com ${rank[0].pontos} pontos!`
        });
      }
      await resetarRanking();
    }
  });

  // --- MENSAGENS ---
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || !msg.key.remoteJid) return;

    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const remetente = msg.key.remoteJid;
    const lower = texto.trim().toLowerCase();

    if (!lower.startsWith("!")) return; // só responde comandos que começam com !

    const [cmd, ...args] = lower.split(" ");

    switch (cmd) {
      case "!help":
        await sock.sendMessage(remetente, {
          text: `📖 *Comandos Disponíveis*:
!adicionar Nome, Tarefa, Pontos → adiciona tarefa
!listar → lista tarefas
!concluir ID → conclui tarefa
!ranking → mostra ranking
!penalizar → penaliza pendentes
!resetar → reseta ranking
!addpadrao Tarefa → adiciona tarefa padrão
!removepadrao ID → remove tarefa padrão
!listarpadrao → lista tarefas padrão`
        });
        break;

      case "!adicionar":
        {
          const partes = texto.replace("!adicionar", "").trim().split(",");
          if (partes.length < 3) {
            await sock.sendMessage(remetente, {
              text: "⚠️ Use: !adicionar Nome, Tarefa, Pontos"
            });
            return;
          }
          const [responsavel, tarefa, pontos] = partes.map(p => p.trim());
          await adicionarTarefa(responsavel, tarefa, parseInt(pontos));
          await sock.sendMessage(remetente, { text: "✅ Tarefa adicionada!" });
        }
        break;

      case "!listar":
        {
          const tarefas = await listarTarefas();
          if (!tarefas.length) {
            await sock.sendMessage(remetente, { text: "📋 Nenhuma tarefa encontrada." });
            return;
          }
          const lista = tarefas
            .map(
              (t) =>
                `${t._id} - ${t.responsavel ?? "N/A"} — ${t.tarefa} — ${
                  t.concluido ? "✔️" : "⏳"
                } (${t.pontos} pts)`
            )
            .join("\n");
          await sock.sendMessage(remetente, { text: "📋 Checklist:\n" + lista });
        }
        break;

      case "!concluir":
        {
          const id = texto.replace("!concluir", "").trim();
          try {
            const tarefa = await concluirTarefa(id);
            if (tarefa) {
              await sock.sendMessage(remetente, {
                text: `🎉 Tarefa concluída! ${tarefa.responsavel} ganhou ${tarefa.pontos} pontos.`
              });
            } else {
              await sock.sendMessage(remetente, { text: "❌ ID inválido ou já concluída." });
            }
          } catch (e) {
            console.error(e);
            await sock.sendMessage(remetente, { text: "⚠️ Erro ao concluir tarefa." });
          }
        }
        break;

      case "!ranking":
        {
          const rank = await ranking();
          if (!rank.length) {
            await sock.sendMessage(remetente, { text: "📊 Nenhum ponto registrado ainda." });
            return;
          }
          const textoRanking = rank
            .map((r, i) => `${i + 1}. ${r.nome} — ${r.pontos} pts`)
            .join("\n");
          await sock.sendMessage(remetente, { text: "📊 Ranking:\n" + textoRanking });
        }
        break;

      case "!penalizar":
        {
          const penalizados = await penalizarPendentes();
          if (!penalizados.length) {
            await sock.sendMessage(remetente, { text: "✅ Nenhuma tarefa pendente." });
            return;
          }
          await sock.sendMessage(remetente, {
            text: `⚠️ Penalizados ${penalizados.length} responsáveis.`
          });
        }
        break;

      case "!resetar":
        await resetarRanking();
        await sock.sendMessage(remetente, { text: "♻️ Ranking resetado!" });
        break;

      // tarefas padrão
      case "!addpadrao":
        {
          const tarefa = texto.replace("!addpadrao", "").trim();
          if (!tarefa) {
            await sock.sendMessage(remetente, { text: "⚠️ Use: !addpadrao Tarefa" });
            return;
          }
          tarefasPadrao.push(tarefa);
          await sock.sendMessage(remetente, { text: "✅ Tarefa padrão adicionada!" });
        }
        break;

      case "!removepadrao":
        {
          const id = parseInt(texto.replace("!removepadrao", "").trim());
          if (isNaN(id) || id < 1 || id > tarefasPadrao.length) {
            await sock.sendMessage(remetente, { text: "⚠️ ID inválido." });
            return;
          }
          tarefasPadrao.splice(id - 1, 1);
          await sock.sendMessage(remetente, { text: "🗑️ Tarefa padrão removida!" });
        }
        break;

      case "!listarpadrao":
        {
          if (!tarefasPadrao.length) {
            await sock.sendMessage(remetente, { text: "📋 Nenhuma tarefa padrão definida." });
            return;
          }
          const lista = tarefasPadrao.map((t, i) => `${i + 1}. ${t}`).join("\n");
          await sock.sendMessage(remetente, { text: "📋 Tarefas padrão:\n" + lista });
        }
        break;
    }
  });
}

startSock();
