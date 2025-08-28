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
import * as fs from "fs";

const { default: makeWASocket } = baileys;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 Escaneie o QR Code abaixo para conectar:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Dispositivo removido, limpando credenciais...");
        fs.rmSync("auth", { recursive: true, force: true }); // remove credenciais antigas
        startSock(); // força novo QR
      } else {
        console.log("⚠️ Conexão perdida, tentando reconectar...");
        startSock();
      }
    }

    if (connection === "open") {
      console.log("✅ Bot conectado com sucesso!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || !msg.key.remoteJid) return;

    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const remetente = msg.key.remoteJid;
    const lower = texto.trim().toLowerCase();

    // --- Comandos ---

    if (lower.startsWith("add")) {
      const partes = texto.substring(3).trim().split(":");
      if (partes.length < 3) {
        await sock.sendMessage(remetente, {
          text: "⚠️ Use: add Nome: Tarefa: Pontos"
        });
        return;
      }
      const [responsavel, tarefa, pontos] = partes.map((p) => p.trim());
      await adicionarTarefa(responsavel, tarefa, parseInt(pontos));
      await sock.sendMessage(remetente, { text: "✅ Tarefa adicionada!" });
      return;
    }

    if (lower === "listar") {
      const tarefas = await listarTarefas();
      if (!tarefas.length) {
        await sock.sendMessage(remetente, { text: "📋 Nenhuma tarefa encontrada." });
        return;
      }
      const lista = tarefas
        .map(
          (t, i) =>
            `${t._id} - ${t.responsavel ?? "N/A"} — ${t.tarefa} — ${
              t.concluido ? "✔️" : "⏳"
            } (${t.pontos} pts)`
        )
        .join("\n");
      await sock.sendMessage(remetente, { text: "📋 Checklist:\n" + lista });
      return;
    }

    if (lower.startsWith("concluir")) {
      const id = texto.replace("concluir", "").trim();
      try {
        const tarefa = await concluirTarefa(id);
        if (tarefa) {
          await sock.sendMessage(remetente, {
            text: `🎉 Tarefa concluída! ${tarefa.responsavel} ganhou ${tarefa.pontos} pontos.`
          });
        } else {
          await sock.sendMessage(remetente, { text: "❌ ID inválido ou tarefa já concluída." });
        }
      } catch (e) {
        console.error(e);
        await sock.sendMessage(remetente, { text: "⚠️ Erro ao concluir tarefa." });
      }
      return;
    }

    if (lower === "ranking") {
      const rank = await ranking();
      if (!rank.length) {
        await sock.sendMessage(remetente, { text: "📊 Nenhum ponto registrado ainda." });
        return;
      }
      const textoRanking = rank
        .map((r, i) => `${i + 1}. ${r.nome} — ${r.pontos} pts`)
        .join("\n");
      await sock.sendMessage(remetente, { text: "📊 Ranking:\n" + textoRanking });
      return;
    }

    if (lower === "penalizar") {
      const penalizados = await penalizarPendentes();
      if (!penalizados.length) {
        await sock.sendMessage(remetente, { text: "✅ Nenhuma tarefa pendente para penalizar." });
        return;
      }
      await sock.sendMessage(remetente, {
        text: `⚠️ Penalizados ${penalizados.length} responsáveis por tarefas pendentes.`
      });
      return;
    }

    if (lower === "resetar") {
      await resetarRanking();
      await sock.sendMessage(remetente, { text: "♻️ Ranking resetado!" });
      return;
    }
  });
}

startSock();