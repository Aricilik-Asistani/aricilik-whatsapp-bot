// Vercel Serverless Function (Node 22, no dependency)

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;        // Meta'daki Verify Token ile birebir aynı olmalı
const WHATSAPP_TOKEN = process.env.WHATSAPP_SYSTEM_USER_TOKEN; // System User uzun süreli token
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;  // 760162310518429

// Basit günlük limit ve konu filtresi (RAM'de tutulur)
const DAILY_LIMIT = 5;
const userLimits = new Map();
const isAricilik = (t) =>
  /(arı|aricilik|arıcılık|kovan|bal|ana arı|oğul|nektar|polen|propolis|varroa|invert|şurup|kış stoğu)/i.test(t || "");

async function sendText(to, body) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  const j = await r.text();
  console.log("WA send resp:", r.status, j);
  return r.ok;
}

export default async function handler(req, res) {
  // 1) Webhook doğrulama (Meta "Verify and Save" çağrısı)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verification failed");
  }

  // 2) Mesaj alma
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("INCOMING:", JSON.stringify(body, null, 2));

      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      // Sadece text mesajları işle
      const from = msg?.from;
      const text = msg?.text?.body;

      if (from && text) {
        // Günlük limit kontrolü
        const today = new Date().toISOString().slice(0, 10);
        const key = `${from}:${today}`;
        const used = userLimits.get(key) || 0;

        if (used >= DAILY_LIMIT) {
          await sendText(from, "Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz. 🐝");
          return res.status(200).send("EVENT_RECEIVED");
        }

        // Konu filtresi: sadece arıcılık; değilse kibar red
        if (!isAricilik(text)) {
          await sendText(from, "Üzgünüm, sadece arıcılıkla ilgili soruları yanıtlayabiliyorum. 🐝");
          return res.status(200).send("EVENT_RECEIVED");
        }

        // Burada ister “akıllı” yanıt üret, ister basit echo (şimdilik kısa yanıt)
        const reply =
          "🧑‍🌾 Arıcılık asistanı: Sorunuz alındı. Gerekli kontrolleri yapıp yanıtlıyorum. (Deneme sürümü)";

        await sendText(from, reply);

        // Kullanım sayacını güncelle
        userLimits.set(key, used + 1);
      }

      // WhatsApp 200 görmek ister
      return res.status(200).send("EVENT_RECEIVED");
    } catch (e) {
      console.error("WEBHOOK ERROR:", e);
      // 200 dön; yoksa Meta yeniden dener
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).send("Method Not Allowed");
}
