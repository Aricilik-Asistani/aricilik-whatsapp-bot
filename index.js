const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express().use(bodyParser.json());

// Meta’dan aldığın Access Token ve Telefon ID’yi buraya yaz
const token = "BURAYA_ACCESS_TOKEN";
const phoneNumberId = "BURAYA_PHONE_NUMBER_ID";

// Ana route
app.get("/", (req, res) => {
  res.send("Arıcılık Asistanı WhatsApp Botu Çalışıyor 🚀");
});

// Webhook doğrulama
app.get("/webhook", (req, res) => {
  let verify_token = "aricilik_verify_token"; // istediğin özel bir kelime olabilir

  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("Webhook doğrulandı!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Mesajları alma ve cevap verme
app.post("/webhook", (req, res) => {
  let body = req.body;

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      let message = body.entry[0].changes[0].value.messages[0];
      let from = message.from; // mesajı gönderen numara
      let text = message.text.body; // mesajın içeriği

      console.log(`Mesaj geldi: ${text}`);

      // Cevap gönder
      sendMessage(from, "🐝 Merhaba! Ben Arıcılık Asistanıyım. Bana arıcılık ile ilgili sorular sorabilirsin.");
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// WhatsApp API ile mesaj gönderme
function sendMessage(to, message) {
  axios({
    method: "POST",
    url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: {
      messaging_product: "whatsapp",
      to: to,
      text: { body: message },
    },
  })
    .then((res) => {
      console.log("Mesaj gönderildi:", res.data);
    })
    .catch((err) => {
      console.error("Mesaj gönderilemedi:", err.response ? err.response.data : err);
    });
}

// Sunucuyu çalıştır
app.listen(3000, () => {
  console.log("✅ Bot 3000 portunda çalışıyor");
});
