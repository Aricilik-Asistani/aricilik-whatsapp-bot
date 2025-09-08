// api/webhook.js
import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";

// --- ENV ---
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;   // Meta verification
const META_TOKEN     = process.env.META_TOKEN;     // Kalıcı/60g access token
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // OpenAI key

// --- OpenAI (gpt-4o-mini) ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- App ---
const app = express();
app.use(bodyParser.json());

// ========== Idempotency & eski mesaj koruması ==========
const processed = new Set();
const SEEN_TTL_MS = 10 * 60 * 1000; // 10 dk: aynı id gelirse görmezden gel
function remember(id) {
  processed.add(id);
  setTimeout(() => processed.delete(id), SEEN_TTL_MS);
}
// ========================================================

// ========== Günlük limit ==========
const DAILY_LIMIT = 5;
const userLimits = {}; // { phone: { date: 'YYYY-MM-DD', count: N } }
// ========================================================

// ========== Yardımcılar ==========
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isBeeTopic(text = "") {
  const t = text.toLowerCase();
  // Arıcılık ile ilgili basit anahtarlar
  const keys = [
    "arı", "aricilik", "arıcılık", "kovan", "bal", "ana arı", "işçi arı",
    "oğul", "nektar", "polen", "varroa", "propolis", "arı sütü", "kovanı",
    "çerçeve", "yavru", "petek", "kestane balı", "karniyol", "kafkas"
  ];
  return keys.some(k => t.includes(k));
}

async function sendMessage(phoneNumberId, to, text) {
  // Cloud API: POST /v{ver}/PHONE_NUMBER_ID/messages
  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const e = await r.text().catch(() => "");
    console.error("WA send error:", r.status, e);
  }
}

async function askOpenAI(prompt) {
  const sys = `Sen "Beekeeper Buddy" gibi, "Kovan Dili" adında sıcak, samimi bir arıcılık asistanısın.
Kısa, net, uygulanabilir ve nazik cevap ver. Gereksiz uzun yazma. Bilgilerin doğruluğundan emin ol.
Güvenlik/sağlık risklerinde dikkat uyarıları ekle. Madde işaretleri sevilebilir.
Sadece arıcılık, arı yetiştiricili, arı sağlığı; "varroa, yavru çürüğü, kireç hastalığı, arı kuşları, eşek arıları, nosema gibi" konularına doğruluğundan eminolduğun cevabı ver.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user",   content: prompt }
    ],
    temperature: 0.3,
  });

  return resp.choices?.[0]?.message?.content?.trim() || "Bir cevap oluşturulamadı.";
}
// ========================================================

// ========== GET: Webhook doğrulama ==========
app.get("/api/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ========== POST: Mesaj al ==========
app.post("/api/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const value  = change?.value;
    const msg    = value?.messages?.[0];

    // Sadece text mesajları işle
    if (!msg || msg.type !== "text") return res.sendStatus(200);

    // ---- Anti-stale: 5 dakikadan eskiyse atla
    const MAX_AGE_SEC = 5 * 60;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - Number(msg.timestamp || 0) > MAX_AGE_SEC) {
      return res.sendStatus(200);
    }

    // ---- Anti-duplicate: aynı id'yi ikinci kez görme
    if (processed.has(msg.id)) return res.sendStatus(200);
    remember(msg.id);

    // WA alanları
    const from = msg.from;                          // gönderen numara
    const text = msg.text?.body?.trim() || "";      // mesaj içeriği
    const phoneNumberId = value?.metadata?.phone_number_id; // kendi WA phone id

    if (!phoneNumberId || !from) return res.sendStatus(200);

    // ---- Günlük limit kontrolü
    const t = todayStr();
    if (!userLimits[from]) userLimits[from] = { date: t, count: 0 };
    if (userLimits[from].date !== t) userLimits[from] = { date: t, count: 0 };

    if (userLimits[from].count >= DAILY_LIMIT) {
      await sendMessage(phoneNumberId, from, "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz.");
      return res.sendStatus(200);
    }

    // ---- Konu filtresi
    if (!isBeeTopic(text)) {
      await sendMessage(phoneNumberId, from, "Üzgünüm, ben sadece arıcılık konusunda yardımcı olabilirim 🐝");
      return res.sendStatus(200);
    }

    // ---- OpenAI yanıtı
    const reply = await askOpenAI(text);

    // Gönder & sayaç artır
    await sendMessage(phoneNumberId, from, reply);
    userLimits[from].count += 1;

    // ÖNEMLİ: Burada bitir
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

// Vercel için
export default app;
