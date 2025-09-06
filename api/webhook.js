// api/webhook.js
import OpenAI from "openai";

// ==== ENV ====
const {
  META_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  OPENAI_API_KEY,
} = process.env;

// === Basit guardlar (deploy öncesi eksikleri yakalamak için) ===
function must(env, name) {
  if (!env) throw new Error(`Missing ENV: ${name}`);
}
must(META_TOKEN, "META_TOKEN");
must(PHONE_NUMBER_ID, "PHONE_NUMBER_ID");
must(VERIFY_TOKEN, "VERIFY_TOKEN");
must(OPENAI_API_KEY, "OPENAI_API_KEY");

// ==== OpenAI ====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ==== Idempotency: Aynı message.id'yi 1 saat sakla ====
const processedMessageIds = new Set();
function rememberMessage(id) {
  processedMessageIds.add(id);
  setTimeout(() => processedMessageIds.delete(id), 60 * 60 * 1000);
}

// ==== Günlük limit storage (in-memory) ====
const DAILY_LIMIT = 5;
const userLimits = {}; // { [from]: { date: 'YYYY-MM-DD', count: number } }

// ==== Yardımcı: WhatsApp mesaj gönder ====
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error("WA send error:", res.status, err);
  }
}

// ==== Yardımcı: Konu filtresi (arıcılık dışını ele) ====
const ARICILIK_KELIMELERI = [
  "arı", "arıcılık", "kovan", "ana arı", "ballık", "yavru",
  "oğul", "kestane balı", "nektar", "propolis", "varroa",
  "polen", "temel petek", "arı sütü", "flora", "bal", "petek"
];

function isAricilikKapsami(text) {
  const t = (text || "").toLowerCase();
  return ARICILIK_KELIMELERI.some(k => t.includes(k));
}

// ==== OpenAI cevabı üret ====
async function generateBeeKeeperReply(userText) {
  const system = `Sen "Arıcılık Asistanı" (Beekeeper Buddy) adında sıcak, samimi bir uzmansın.
- Sadece arıcılık/arı sağlığı/kovan yönetimi konularında cevap ver.
- Kısa, net, uygulanabilir öneriler ver. Gerektiğinde madde madde yaz.
- Kimyasal kullanımında dikkatli ol, güvenlik uyarıları ekle.
- Üslup: sıcak, destekleyici, emojiyi aşırı kaçmadan kullan (🐝 uygun).`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText }
    ],
  });

  const content = completion.choices?.[0]?.message?.content?.trim();
  return content || "Bu konuda yardımcı olamadım, soruyu biraz daha açabilir misin? 🐝";
}

// ==== Vercel API Route ====
export default async function handler(req, res) {
  try {
    // --- GET: Webhook doğrulama ---
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }

    // --- POST: WhatsApp webhook events ---
    if (req.method === "POST") {
      const body = req.body || {};
      // WhatsApp Cloud API yapısı: entry[0].changes[0].value
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // status güncellemelerini atla
      if (value?.statuses?.length) {
        return res.sendStatus(200);
      }

      const msg = value?.messages?.[0];
      if (!msg || msg.type !== "text") {
        // sadece text'e yanıtlıyoruz
        return res.sendStatus(200);
      }

      // Aynı mesaj ikinci kez gelirse cevaplama
      if (processedMessageIds.has(msg.id)) {
        return res.sendStatus(200);
      }
      rememberMessage(msg.id);

      const from = msg.from;                 // müşteri numarası
      const text = msg.text?.body?.trim() || "";

      let reply = null;

      // 1) Konu filtresi (arıcılık dışı ise tek yanıt)
      if (!isAricilikKapsami(text)) {
        reply = "Üzgünüm, ben sadece arıcılık konusunda yardımcı olabilirim 🐝";
      }

      // 2) Limit kontrolü (sadece konu içi ise uygula)
      if (!reply) {
        const today = new Date().toISOString().split("T")[0];
        if (!userLimits[from]) userLimits[from] = { date: today, count: 0 };
        if (userLimits[from].date !== today) {
          userLimits[from] = { date: today, count: 0 };
        }

        if (userLimits[from].count >= DAILY_LIMIT) {
          reply = "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz.";
        } else {
          // OpenAI çağrısı
          try {
            reply = await generateBeeKeeperReply(text);
            userLimits[from].count += 1; // sadece AI cevabı yollandıysa arttır
          } catch (e) {
            console.error("OpenAI error:", e?.status || "", e?.message || e);
            reply = "Şu an yoğunluktan dolayı yanıt veremiyorum, lütfen biraz sonra tekrar dener misiniz? 🐝";
          }
        }
      }

      // 3) Tek seferde gönder
      if (reply) {
        await sendMessage(from, reply);
      }

      return res.sendStatus(200);
    }

    // Diğer metodlar
    return res.sendStatus(405);
  } catch (err) {
    console.error("Webhook fatal error:", err);
    return res.sendStatus(500);
  }
}
