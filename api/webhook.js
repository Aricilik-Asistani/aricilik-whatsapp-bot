import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // Meta doğrulama (GET)
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }

  // Mesaj alma (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;

      if (body.object) {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
          const phone_number_id = value.metadata.phone_number_id;
          const from = messages[0].from; // gönderenin numarası
          const msg_body = messages[0].text?.body || "Merhaba!";

          let replyText;

          try {
            // OpenAI cevabı
            const completion = await client.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: msg_body }],
            });

            replyText = completion.choices[0].message.content;
          } catch (err) {
            console.error("OpenAI error:", err);

            // Bakiye biterse vs. fallback mesajı
            replyText = "Şu anda yoğunluktan dolayı cevap veremiyorum. Lütfen daha sonra tekrar deneyin.";
          }

          // Meta API ile cevap gönder
          await fetch(
            `https://graph.facebook.com/v18.0/${phone_number_id}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.META_TOKEN}`,
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: from,
                text: { body: replyText },
              }),
            }
          );
        }

        res.sendStatus(200);
      } else {
        res.sendStatus(404);
      }
    } catch (err) {
      console.error("Webhook Error:", err);
      res.sendStatus(500);
    }
  }
}
