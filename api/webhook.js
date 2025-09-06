// api/webhook.js
import OpenAI from "openai";

const META_TOKEN       = process.env.META_TOKEN;            // WhatsApp Cloud API token
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN;          // Webhook doğrulama token
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;        // OpenAI key
const ENV_PHONE_ID     = process.env.PHONE_NUMBER_ID || process.env.WABA_PHONE_NUMBER_ID;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Aynı mesajı iki kez işlememek için basit cache (aynı lambda ömründe)
const processed = new Set();
const CAP = 500;

// Arıcılık konu filtresi
function isBeeRelated(text = "") {
  const t = text.toLowerCase().normalize("NFKD");
  const keywords = [
    "arı","ari","arıcılık","aricilik","kovan","bal","nektar","polen",
    "ana arı","ana ari","işçi arı","isci ari","oğul","ogul",
    "varroa","nosema","kışlatma","kislatma","kat atma","besleme",
    "şurup","surup","invert","temel petek","ruşet","ruset","kek","çerçeve","petek",
    "eşek arısı","esek arisi","vespa","sarıca arı","kasap arı"
  ];
  return keywords.some(k => t.includes(k));
}

async function sendWhatsAppText({ phoneNumberId, to, body }) {
  const id = phoneNumberId || ENV_PHONE_ID;
  if (!id) {
    console.error("PHONE_NUMBER_ID missing");
    return;
  }
  const url = `https://graph.facebook.com/v23.0/${id}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) console.error("WA send error:", r.status, await r.text());
}

export default async function handler(req, res) {
  // GET — Webhook verify
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  // POST — Events
  if (req.method === "POST") {
    try {
      const body = req.body || {};

      // a) Status event'lerini (delivered, read vs.) yok say
      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (statuses) return res.status(200).send("status-ignored");

      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id || ENV_PHONE_ID;
      const msg = value?.messages?.[0];
      if (!msg) return res.status(200).send("no-message");

      const msgId = msg.id;
      const from  = msg.from;
      const text  = msg.text?.body || "";

      // b) Duplicate koruması
      if (msgId) {
        if (processed.has(msgId)) return res.status(200).send("dup-ignored");
        processed.add(msgId);
        if (processed.size > CAP) processed.delete(processed.values().next().value);
      }

      // c) 200'ü erken dön → Meta retry yapmasın
      res.status(200).send("EVENT_RECEIVED");

      // d) Konu filtresi
      if (!isBeeRelated(text)) {
        await sendWhatsAppText({
          phoneNumberId,
          to: from,
          body: "Üzgünüm, bu konu arıcılıkla ilgili olmadığı için yardımcı olamıyorum. "
              + "Beekeeper Buddy sadece arıcılık sorularını yanıtlar 🐝"
        });
        return;
      }

      // e) OpenAI — Beekeeper Buddy kimliğiyle yanıt
      let reply = "";
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: 220,
          messages: [
            {
              role: "system",
              content:
                "Sen 'Beekeeper Buddy' isimli dost canlısı bir arıcılık asistanısın. "
              + "Sadece arıcılık hakkında kısa, net ve uygulanabilir yanıt ver. "
              + "Gereksiz ayrıntıdan kaçın, güvenli ve pratik öneriler sun."
            },
            { role: "user", content: text }
          ]
        });
        reply = completion.choices?.[0]?.message?.content?.trim() || "";
      } catch (e) {
        console.error("OpenAI error:", e?.status, e?.message);
        reply = "Şu an yoğunluktan dolayı yanıt veremiyorum. Lütfen biraz sonra tekrar dener misin? 🐝\n— Beekeeper Buddy";
      }

      // f) İmza ekle
      const signed = reply ? `${reply}\n\n🐝 — Beekeeper Buddy` : "Kısa bir teknik sorun oldu, tekrar dener misin? 🐝\n\n— Beekeeper Buddy";
      await sendWhatsAppText({ phoneNumberId, to: from, body: signed });
      return;
    } catch (e) {
      console.error("Webhook error:", e);
      return res.status(200).send("handled");
    }
  }

  return res.status(405).send("Method Not Allowed");
}
