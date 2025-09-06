// /api/webhook.js
import OpenAI from "openai";

// --- ENV ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Basit konu filtresi: arıcılık dışı ise kısayol cevabı
function isBeeTopic(text = "") {
  const kws = [
    "arı", "kovan", "bal", "oğul", "ana arı", "işçi arı",
    "varroa", "nektar", "arıcılık", "yavru", "koloni"
  ];
  const t = text.toLocaleLowerCase("tr");
  return kws.some(k => t.includes(k));
}

// WhatsApp’a mesaj gönder
async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    console.error("WA send error:", res.status, errTxt);
  }
}

// OpenAI’den arıcılık yanıtı al
async function getBeeReply(userText) {
  const sys =
    "Sen Beekeeper Buddy adlı uzman bir ARICILIK asistanısın. " +
    "Kısa ve net, sahada uygulanabilir, güvenli öneriler ver. " +
    "Riskli durumlarda koruyucu ekipman ve yerel mevzuat uyarıları ekle.";

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userText },
    ],
  });

  return resp.choices?.[0]?.message?.content?.trim() || "Bir şeyler ters gitti.";
}

// Vercel Node runtime
export default async function handler(req, res) {
  try {
    // 1) META Webhook doğrulaması (GET)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    // 2) Mesaj işleme (POST)
    if (req.method === "POST") {
      const body = req.body || {};
      if (body.object !== "whatsapp_business_account") {
        // Meta bazen farklı pingler atabilir
        return res.status(200).json({ received: true });
      }

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const messages = change.value?.messages || [];
          for (const message of messages) {
            const from = message.from;                // gönderen
            const text = message.text?.body || "";    // gelen metin

            console.log("Incoming:", { from, text });

            // Konu filtresi
            if (!isBeeTopic(text)) {
              await sendWhatsAppText(
                from,
                "Üzgünüm 🙏 Bu bot sadece arıcılık hakkında yardımcı oluyor. " +
                "Arılar, kovan yönetimi, varroa, bal ve benzeri konuları sorabilir misin?"
              );
              continue;
            }

            // OpenAI yanıtı
            try {
              const answer = await getBeeReply(text);
              await sendWhatsAppText(from, answer);
            } catch (err) {
              // Limit/bakiye/diğer hatalarda fallback
              const msg429 =
                "Şu an yoğunluktan dolayı cevap veremiyorum, lütfen biraz sonra tekrar dener misin? 🐝";
              console.error("OpenAI error:", err?.status || "", err?.message || err);
              await sendWhatsAppText(from, msg429);
            }
          }
        }
      }

      return res.status(200).json({ status: "ok" });
    }

    return res.status(405).send("Method Not Allowed");
  } catch (err) {
    console.error("Webhook fatal:", err);
    return res.status(500).send("Internal Server Error");
  }
}

// Vercel body parser açık kalsın
export const config = { api: { bodyParser: true } };
