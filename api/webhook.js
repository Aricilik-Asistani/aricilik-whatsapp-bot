// api/webhook.js — Vercel Serverless Function
export default async function handler(req, res) {
  // KENDİ DEĞERLERİN:
  const VERIFY_TOKEN = "verify_token";       // Meta paneline yazacağınla birebir aynı olmalı
  const WHATSAPP_TOKEN = "EAAXXX...";        // (Doğrulama için şart değil, ama sonra lazım)
  const PHONE_NUMBER_ID = "855469457640686"; // (Doğrulama için şart değil)

  // 1) Meta doğrulama (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = "EAALmtJ8XTpEBPUXmamOrc09TgxUZAfEv52zRL23uubzf1ovG1PEsRPBfqjdA3lmDOsZC468zvyIAlcZACoSgJLe0CJHWUAWakxI5ZCcXeWXP6d1sPqY46KXeXiwUAMARldOBVo3Fl2OFZC9ki1rzaZC1DZCp1bObOfzTn1uVrXKjV6hHQfWSIcylLXWZAyf7UL9ABEl4ZBWTbHrRlQfvZBJZAnGjzEVvZBoZCTJh82Ix6ZCQxsAHYWOQZDZD";

    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verification failed");
  }

  // 2) Mesaj alma ve basit cevap (POST)
  if (req.method === "POST") {
    try {
      const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
      const messages = entry?.messages || [];
      if (!messages.length) return res.status(200).json({ ok: true });

      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body || "";

      // Basit karşılama — istersen sonra akıllandırırız
      const reply = "🐝 Merhaba! Ben Arıcılık Asistanıyım. Sorunu yaz, yardımcı olayım.";

      // WhatsApp’a yanıt (doğrulama için şart değil)
      await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: reply }
        })
      });

      return res.status(200).json({ sent: true });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
