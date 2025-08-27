import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.CHATBOT_KEY,
});

export async function responderIA(mensagem) {
  try {
    const resposta = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: mensagem }],
    });
    return resposta.choices[0].message.content;
  } catch (error) {
    console.error("❌ Erro na IA:", error.message);

    if (error.message.includes("insufficient_quota")) {
      return "⚠️ Limite da IA atingido. Mas fique tranquilo, o bot continua funcionando normalmente!";
    }

    return "⚠️ A IA não conseguiu responder agora. Tente novamente mais tarde!";
  }
}
