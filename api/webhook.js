// /api/webhook.js
// Node 22 + Vercel Serverless

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====== CONFIG ======
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "aricilik123";
const META_TOKEN   = process.env.META_TOKEN; // Graph API token (60 günlük veya kalıcı)
const DAILY_LIMIT  = 5;                      // Kişi başı günlük soru hakkı
const COOLDOWN_MS  = 15_000;                 // Flood koruması: aynı kişiye min. 15sn'de bir cevap
const IDEMP_TTL_MS = 24 * 60 * 60 * 1000;    // 24 saat idempotency TTL
// =====================

// Bellek içi (serverless instance başına) basit depolar
const userLimits = new Map();   // phone -> { date, count, lastReplyAt, limitNotified }
const seenWamids = new Map();   // wamid -> timestamp

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function cleanupIdempotency() {
  const now = Date.now();
  for (const [id, ts] of seenWamids.entries()) {
    if (now - ts > IDEMP_TTL_MS) seenWamids.delete(id);
  }
}

function markSeen(wamid) {
  cleanupIdempotency();
  seenWamids.set(wamid, Date.now());
}

function alreadySeen(wamid) {
  cleanupIdempotency();
  return seenWamids.has(wamid);
}

function canReplyNow(from) {
  const rec = userLimits.get(from);
  if (!rec) return true;
  if (!rec.lastReplyAt) return true;
  return Date.now() - rec.lastReplyAt > COOLDOWN_MS;
}

function bumpUsage(from) {
  const d = todayStr();
  const rec = userLimits.get(from) || { date: d, count: 0, limitNotified: false, lastReplyAt: 0 };
  if (rec.date !== d) {
    rec.date = d;
    rec.count = 0;
    rec.limitNotified = false;
  }
  rec.count += 1;
  rec.lastReplyAt = Date.now();
  userLimits.set(from, rec);
  return rec;
}

function getUsage(from) {
  const d = todayStr();
  const rec = userLimits.get(from) || { date: d, count: 0, limitNotified: false, lastReplyAt: 0 };
  if (rec.date !== d) {
    rec.date = d;
    rec.count = 0;
    rec.limitNotified = false;
  }
  userLimits.set(from, rec);
  return rec;
}

async function sendMessage(phoneNumberId, to, text) {
  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  // Meta hata verirse logla ama webhook'u kilitleme
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error("WA send error:", resp.status, t);
  }
}

function isBeekeepingQuestion(text) {
  // basit konu filtresi — Türkçe anahtar kelimeler
  const kw = [
    "arı", "kovan", "bal", "ana arı", "işçi arı", "arı sütü",
    "kovan", "varroa", "petek", "nektar", "arı hastalığı", "arıcılık"
  ];
  const lower = (text || "").toLowerCase();
  return kw.some(k => lower.includes(k));
}

function beekeeperPrompt(userText) {
  return `Sen "Beekeeper Buddy" adlı sıcak, samimi bir arıcılık asistanısın.
Kısa, net ve uygulanabilir cevaplar ver. Madde işaretleri kullan.
Emojiyi abartma ama ara sıra 🐝 kullanabilirsin.
Konu arıcılık dışına çıkarsa yardımcı olamayacağını kibarca söyle ve tekrar arıcılık sorusu iste.

Kullanıcının sorusu: """${userText}"""`;
}

export default async function handler(req, res) {
  // ----- GET: Webhook doğrulama -----
  if (req.method === "GET") {
    const mode  = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const chal  = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(chal);
    }
    return res.sendStatus(403);
  }

  // ----- POST: Bildirim -----
  if (req.method !== "POST") return res.sendStatus(405);

  try {
    const body = req.body;
    // Meta beklenen yapıda mı?
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Sadece mesaj eventlerini işleyelim
    const messages = value?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      // status vs. ise sessizce 200 dön
      return res.sendStatus(200);
    }

    const phoneNumberId = value?.metadata?.phone_number_id; // Gönderim için gerekli
    const message = messages[0];

    // Idempotency: aynı wamid’i ikinci kez görürsek çık
    const wamid = message.id;
    if (!wamid || alreadySeen(wamid)) {
      return res.sendStatus(200);
    }
    markSeen(wamid);

    const from = message.from;               // "905xxxxxxxxx" formatında
    const type = message.type;
    const text = type === "text" ? message.text?.body : "";

    // Flood koruması
    if (!canReplyNow(from)) {
      return res.sendStatus(200);
    }

    // --- Günlük limit kontrolü (cevap göndermeden ÖNCE) ---
    const usage = getUsage(from);
    if (usage.count >= DAILY_LIMIT) {
      if (!usage.limitNotified) {
        // Limit doldu uyarısını bir kez gönder
        await sendMessage(phoneNumberId, from, "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz.");
        usage.limitNotified = true;
        userLimits.set(from, usage);
      }
      // Sonraki mesajlarda tamamen sessiz kal
      return res.sendStatus(200);
    }

    // --- Konu filtresi ---
    if (!isBeekeepingQuestion(text)) {
      // Arıcılık dışı ise bir kez kibar uyarı gönder ve sayacı artırma
      await sendMessage(phoneNumberId, from, "Üzgünüm, ben sadece arıcılık konusunda yardımcı olabilirim 🐝");
      usage.lastReplyAt = Date.now();
      userLimits.set(from, usage);
      return res.sendStatus(200);
    }

    // Bu noktada cevap üreteceğiz → 200’ü geciktirmemek için hızlı davran
    // (İstersen aşağıdaki openai çağrısından önce 200 döndürüp arka planda da çalıştırabilirsin,
    // fakat Vercel serverless’ta işlem süresi kısa olduğu sürece bu akış yeterli.)
    const prompt = beekeeperPrompt(text);

    let ai = "Kısa, net bir cevap üretilemedi.";
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
      });
      ai = resp.choices?.[0]?.message?.content?.trim() || ai;
    } catch (err) {
      console.error("OpenAI error:", err?.status || "", err?.message || err);
      ai = "Şu an yoğunluktayız, lütfen biraz sonra tekrar deneyin 🐝";
    }

    // WhatsApp’a gönder
    await sendMessage(phoneNumberId, from, ai);

    // Kullanım sayacı & zaman damgası
    const updated = bumpUsage(from);
    userLimits.set(from, updated);

    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    // Meta tekrar denemesin diye yine de 200 dönüyoruz
    return res.sendStatus(200);
  }
}
