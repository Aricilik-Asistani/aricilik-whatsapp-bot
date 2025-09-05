import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VERIFY_TOKEN     = process.env.VERIFY_TOKEN || "aricilik123";
const META_TOKEN       = process.env.META_TOKEN;
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID || process.env.WABA_PHONE_NUMBER_ID;

// 🔒 Aynı mesajı ikinci kez işlememek için basit bellek içi cache (aynı lambda ömründe)
const processed = new Set();
const cap = 500; // Çok büyürse hafızayı şişirmemek için sınır

const BEE_RE = /arı|arıcılık|kovan|bal|ana arı|oğul|varroa|nektar|polen|şurup|kışlatma|kek|çerçeve|petek/i;

async function sendWhatsApp(to, text) {
  if (!PHONE_NUMBER_ID) {
    console.error("PHONE_NUMBER_ID missing");
    return;
  }
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.error("WA send error:", r.status, await r.text());
  }
}

export default async function handler(req, res) {
  // 1) GET — webhook doğrulama
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // 2) POST — mesaj işleme
  if (req.method === "POST") {
    try {
      const body = req.body || {};

      // a) Status event'leri YOK SAY
      // (teslim/okunma durumları. Bunlara asla yanıt gönderme)
      const hasStatuses = Boolean(body?.entry?.[0]?.changes?.[0]?.value?.statuses);
      if (hasStatuses) return res.status(200).send("status-ignored");

      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const msg   = value?.messages?.[0];
      if (!msg) return res.status(200).send("no-message");

      // b) Aynı message.id'yi ikinci kez görürsek YOK SAY
      const msgId = msg.id;
      if (msgId) {
        if (processed.has(msgId)) return res.status(200).send("dup-ignored");
        processed.add(msgId);
        if (processed.size > cap) {
          // basit temizlik: ilk elemanı sil
          const first = processed.values().next().value;
          processed.delete(first);
        }
      }

      const from = msg.from;
      const text = msg.text?.body || "";

      // 🟢 200'ü HEMEN döndür → Meta retry yapmasın (en önemli adım)
      res.status(200).send("EVENT_RECEIVED");

      // c) Arıcılık filtresi
      if (!BEE_RE.test(text)) {
        await sendWhatsApp(from, "Bu hat yalnızca **arıcılık** ile ilgili soruları yanıtlar 🐝 Lütfen arıcılıkla ilgili bir soru sor.");
        return;
      }

      // d) OpenAI'den yanıt
      let reply;
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Sadece arıcılık hakkında kısa ve net cevap ver. Gereksiz ayrıntı verme." },
            { role: "user", content: text }
          ],
          temperature: 0.4,
          max_tokens: 220
        });
        reply = completion.choices?.[0]?.message?.content?.trim();
      } catch (e) {
        console.error("OpenAI error:", e?.status, e?.message);
        reply = "Şu an yoğunluktan dolayı yapay zekâ yanıtı veremiyorum. Lütfen biraz sonra tekrar dener misin? 🐝";
      }

      await sendWhatsApp(from, reply || "Kısa bir teknik sorun oldu, tekrar dener misin? 🐝");
      return;
    } catch (e) {
      console.error("Webhook error:", e);
      return res.status(200).send("handled");
    }
  }

  return res.status(405).send("Method Not Allowed");
}
