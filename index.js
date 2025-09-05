// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express().use(bodyParser.json());

// 🔐 Bu üç satırı KENDİ DEĞERLERİNLE doldur:
const VERIFY_TOKEN = "verify_token";                 // Meta paneline yazacağınla birebir aynı
const WHATSAPP_TOKEN = "EAAXXX...";                  // Access Token (Generate access token ile aldığın)
const PHONE_NUMBER_ID = "855469457640686";           // API Setup'taki Phone Number ID

// Sağlık kontrolü (isteğe bağlı)
app.get("/", (_, res) => res.send("Arıcılık Asistanı webhook hazır ✅"));

// 1) Meta webhook DOĞRULAMA (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2) Mesaj ALMA ve CEVAP gönderme (POST)
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = entry?.messages || [];
    if (messages.length === 0) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;                      // "9053..." formatlı numara
    const text = msg.text?.body || "";          // kullanıcının yazdığı

    console.log("GELEN:", from, text);

    // Basit karşılama cevabı
    const reply = "🐝 Merhaba! Ben Arıcılık Asistanıyım. Arıcılıkla ilgili sorun varsa yazabilirsin.";

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    return res.sendStatus(500);
  }
});

// Vercel’de local port dinlemek sorun olmaz; sadece development için kullanılır.
app.listen(3000, () => console.log("✅ Webhook yerel 3000'de hazır (Vercel prod'da serverless)."));
