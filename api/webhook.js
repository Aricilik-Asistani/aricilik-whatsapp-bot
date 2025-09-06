// api/webhook.js
import OpenAI from "openai";

// ---- ENV ----
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;                 // 60 günlük veya sistem kullanıcısı token
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;       // WhatsApp test/gerçek numarasının ID'si
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);

// ---- OpenAI ----
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---- In-memory rate limit ve idempotency (server yeniden başlarsa sıfırlanır) ----
/** userLimits[waNumber] = { date: 'YYYY-MM-DD', count: number } */
const userLimits = {};
/** seenMessages[waMsgId] = true  (aynı mesaj tekrar gelirse cevaplama) */
const seenMessages = {};

// ---- Yardımcılar ----
const json = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
};

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    console.error("WA send error:", r.status, err);
    throw new Error(`WA_SEND_${r.status}`);
  }
}

// sadece arıcılık konuları
function isBeekeepingRelated(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const keywords = [
    "arı", "arıcılık", "kovan", "petek", "bal", "ana arı", "oğul",
    "varroa", "nektar", "yavru", "çerçeve", "kışlatma", "koloni",
    "kek", "şurup", "kovanı", "kovandan", "kovana", "kat at", "besleme"
  ];
  return keywords.some(k => t.includes(k));
}

async function getBeekeeperAnswer(userText) {
  const sys = `Sen "Beekeeper Buddy" adlı samimi bir arıcılık asistanısın.
- Cevapları kısa, açık ve uygulanabilir adımlarla ver.
- Gerektiğinde maddeler kullan (1-2-3).
- Tehlikeli durumlarda uyar.
- Tamamen arıcılık dışı konulara girme.`;

  const messages = [
    { role: "system", content: sys },
    { role: "user", content: userText }
  ];

  try {
    const out = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages
    });
    return (out?.choices?.[0]?.message?.content || "").trim();
  } catch (err) {
    console.error("OpenAI error:", err?.status, err?.message);
    // Kota/429 gibi durumlarda kullanıcıya nazik mesaj
    if (err?.status === 429) {
      return "Şu an yoğunluk nedeniyle cevap veremiyorum. Lütfen biraz sonra tekrar dener misiniz? 🐝";
    }
    return "Beklenmeyen bir hata oluştu, lütfen tekrar deneyin. 🐝";
  }
}

function handleRateLimit(from) {
  const today = new Date().toISOString().split("T")[0];
  if (!userLimits[from]) userLimits[from] = { date: today, count: 0 };
  if (userLimits[from].date !== today) {
    userLimits[from] = { date: today, count: 0 };
  }
  return userLimits[from];
}

// ---- Vercel handler ----
export default async function handler(req, res) {
  // --- GET: Webhook doğrulama ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.statusCode = 200;
      res.end(challenge);
    } else {
      res.statusCode = 403;
      res.end("Forbidden");
    }
    return;
  }

  // --- POST: WhatsApp Webhook ---
  if (req.method === "POST") {
    try {
      const body = req.body || {};

      // Meta bazen boş keepalive gönderir
      if (!body.entry || !Array.isArray(body.entry)) {
        return json(res, 200, { status: "ignored" });
      }

      const change = body.entry[0]?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      // Sadece gerçek mesajları ele al
      if (!msg || msg.type !== "text") {
        return json(res, 200, { status: "ignored" });
      }

      const waMsgId = msg.id;
      const from = msg.from; // örn: "905xxxxxxxxx"
      const text = msg.text?.body?.trim() || "";

      // --- İdempotency: Aynı mesajı ikinci kez cevaplama ---
      if (seenMessages[waMsgId]) {
        return json(res, 200, { status: "duplicate_ignored" });
      }
      seenMessages[waMsgId] = true;

      // --- Günlük limit kontrolü (erken çıkış) ---
      const lt = handleRateLimit(from);
      if (lt.count >= DAILY_LIMIT) {
        await sendWhatsAppText(
          from,
          "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz."
        );
        return json(res, 200, { status: "limit_reached" }); // <-- ERKEN RETURN
      }

      // --- Konu filtresi: arıcılık dışı ise nazik red + erken çıkış ---
      if (!isBeekeepingRelated(text)) {
        await sendWhatsAppText(
          from,
          "Üzgünüm, ben sadece arıcılık konusunda yardımcı olabilirim 🐝"
        );
        return json(res, 200, { status: "non_beekeeping" }); // <-- ERKEN RETURN
      }

      // --- OpenAI cevabı ---
      const answer = await getBeekeeperAnswer(text);

      // --- WhatsApp’a gönder ---
      await sendWhatsAppText(from, answer);

      // --- Sayaç +1 ---
      lt.count += 1;

      return json(res, 200, { status: "ok" });
    } catch (err) {
      console.error("Webhook POST error:", err);
      return json(res, 200, { status: "handled_with_error" }); // 200 dön ki Meta yeniden denemesin
    }
  }

  // Diğer metotlar
  res.statusCode = 405;
  res.end("Method Not Allowed");
}

// Vercel’in JSON body’yi parse etmesi için
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
  },
};
