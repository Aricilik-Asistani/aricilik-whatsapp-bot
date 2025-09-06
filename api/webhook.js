import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Kullanıcıların günlük limitlerini tut
let userLimits = {};
const DAILY_LIMIT = 5;

// Beekeeper Buddy promptu
const systemPrompt = `
Sen Beekeeper Buddy isimli sıcak ve samimi bir arıcılık asistanısın. 
Sadece arıcılıkla ilgili konularda yardımcı ol, konuların dışına çıkma. 
Yanıtlarında dostça, samimi bir üslup kullan ve gerektiğinde pratik ipuçları ver. 
Kısa ve net anlat ama gerektiğinde detaylı tavsiyeler de sun. 
Arıcılık dışı sorulara: "Üzgünüm 🐝, bu konuda yardımcı olamıyorum." diye cevap ver.
`;

// Webhook doğrulama
app.get("/api/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook mesajları
app.post("/api/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message && message.type === "text") {
      const from = message.from;
      const text = message.text.body;

      // Kullanıcı limit kontrolü
 const today = new Date().toISOString().split("T")[0];
if (!userLimits[from]) userLimits[from] = { date: today, count: 0 };
if (userLimits[from].date !== today) {
  userLimits[from] = { date: today, count: 0 };
}
if (userLimits[from].count >= DAILY_LIMIT) {
  await sendMessage(
    from,
    "Bugünlük soru hakkınızı doldurdunuz 🐝 Yarın tekrar deneyin!"
  );
  return res.sendStatus(200);
}

      // OpenAI'den cevap al
      let reply = "";
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
          ],
        });
        reply = completion.choices[0].message.content.trim();
      } catch (error) {
        console.error("OpenAI error:", error);
        reply = "Üzgünüm 🐝 şu an yoğunluktan dolayı cevap veremiyorum.";
      }

      userLimits[from].count += 1;
      await sendMessage(from, reply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
});

// WhatsApp mesaj gönderme fonksiyonu
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

app.listen(3000, () => {
  console.log("Webhook server is running on port 3000");
});
