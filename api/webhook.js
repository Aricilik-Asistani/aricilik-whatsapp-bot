import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// Meta (Facebook) ayarları
const VERIFY_TOKEN = "aricilik_verify_123"; // Facebook Webhook için
const PAGE_ACCESS_TOKEN = "EAALmtJ8XTpEBPY2NxP2j8vOA6ekUya2kMqWceycM1hihr2Jx94PLL4tMAr52ZAd5hAcAqgN9acAwB7GmZAZC2xKXZB8Dft3LwthbOZC2Jim9QETuZCZCelMOYzZCZAcw1q7DGMR9VCLwunK5qsmIdYZCvYUt9ao4WtsDPJvzi5c5jJzygqXELLiJdZB96ZA0GK5WpQ7wVAsIAfgZCH8v1UZCIrZBUMueujbgNNRs2Qjpx60YKHmBzE5LcMZD"; 

// OpenAI ayarları
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Webhook doğrulama (Meta çağırıyor)
app.get("/api/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook doğrulandı!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Mesaj alıp cevaplama
app.post("/api/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const message = changes?.value?.messages?.[0];

      if (message && message.text) {
        const from = message.from; // gönderen numara
        const userMessage = message.text.body;

        console.log("📩 Gelen mesaj:", userMessage);

        // Arıcılıkla ilgili değilse cevap verme
        if (!userMessage.toLowerCase().includes("arı")) {
          console.log("❌ Arıcılık dışı mesaj, cevap gönderilmiyor.");
          return res.sendStatus(200);
        }

        // OpenAI’den yanıt al
        const completion = await openai.responses.create({
          model: "gpt-5-mini",
          input: `Sadece arıcılıkla ilgili asistan gibi cevap ver. Kullanıcı sorusu: ${userMessage}`,
        });

        const reply = completion.output[0].content[0].text;
        console.log("🤖 Yanıt:", reply);

        // WhatsApp API’ye gönder
        await fetch(
          `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              type: "text",
              text: { body: reply },
            }),
          }
        );
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Hata:", error);
    res.sendStatus(500);
  }
});

export default app;
