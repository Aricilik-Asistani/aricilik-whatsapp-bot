import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Kullanıcı başına günlük limit
const DAILY_LIMIT = 5;
const userLimits = {};

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("WA send error:", err);
  } else {
    console.log("WA send ok:", await res.json());
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }

  if (req.method === "POST") {
    try {
      const entry = req.body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const message = changes?.value?.messages?.[0];
      const from = message?.from;
      const text = message?.text?.body;

      if (!from || !text) {
        return res.sendStatus(200);
      }

      // --- Günlük limit kontrolü ---
      const today = new Date().toISOString().split("T")[0];
      if (!userLimits[from]) userLimits[from] = { date: today, count: 0 };
      if (userLimits[from].date !== today) {
        userLimits[from] = { date: today, count: 0 };
      }

      if (userLimits[from].count >= DAILY_LIMIT) {
        await sendWhatsAppText(from, "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz.");
        return res.sendStatus(200);
      }

      userLimits[from].count++;

      // --- Arıcılık dışı mesaj kontrolü ---
      const lower = text.toLowerCase();
      const keywords = ["arı", "bal", "kovan", "arıcılık", "arılar"];
      const isBeekeeping = keywords.some(k => lower.includes(k));
      if (!isBeekeeping) {
        await sendWhatsAppText(from, "🐝 Bu asistan sadece **arıcılık** hakkında yardımcı olabilir. Lütfen sorularınızı bu konuyla ilgili sorun.");
        return res.sendStatus(200);
      }

      // --- OpenAI'den cevap alma ---
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Sen bir arıcılık asistanısın. Adın 'Beekeeper Buddy'. Kullanıcılara sıcak, samimi bir dille yalnızca arıcılık hakkında bilgi ver. Konu dışı sorular gelirse nazikçe 'Üzgünüm, ben sadece arıcılık konusunda yardımcı olabilirim 🐝' diye yanıtla." },
          { role: "user", content: text },
        ],
      });

      const reply = completion.choices[0].message?.content || "🐝 Şu an cevap veremiyorum.";
      await sendWhatsAppText(from, reply);

      return res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      return res.sendStatus(500);
    }
  }

  return res.sendStatus(404);
}

export const config = {
  api: { bodyParser: true },
};
