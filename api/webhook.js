import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// Token artık environment variable’dan okunuyor
const WHATSAPP_TOKEN = process.env.META_TOKEN; 
const VERIFY_TOKEN = "aricilik_verify"; // kendi belirlediğin verify token

// Kullanıcı başına günlük limit
const DAILY_LIMIT = 5;
let userLimits = {};

async function sendMessage(to, message) {
  await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: message }
    })
  });
}

// Webhook doğrulama
app.get("/api/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Mesajları yakalama
app.post("/api/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (messages && messages[0]) {
      const from = messages[0].from;
      const text = messages[0].text?.body;

      // Günlük limit kontrolü
      const today = new Date().toISOString().split("T")[0];
      if (!userLimits[from]) userLimits[from] = { date: today, count: 0 };
      if (userLimits[from].date !== today) {
        userLimits[from] = { date: today, count: 0 };
      }

      if (userLimits[from].count >= DAILY_LIMIT) {
        await sendMessage(from, "🐝 Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz.");
        return res.sendStatus(200);
      }

      userLimits[from].count++;

      // Burada OpenAI cevabı eklenecek
      await sendMessage(from, `📩 Mesajınız alındı: "${text}"`);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

app.listen(3000, () => console.log("Webhook server is running"));
