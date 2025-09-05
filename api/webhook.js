// api/webhook.js
const META_TOKEN      = process.env.META_TOKEN;
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN || 'aricilik123';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ÖRN: 855469457640686

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("WA send error:", r.status, err);
  }
}

async function askOpenAI(prompt) {
  // OpenAI çağrısı: Bakiye yoksa 429 dönebilir -> try/catch
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: prompt,
    })
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`OpenAI error ${r.status}: ${err}`);
  }

  const data = await r.json();
  // Responses API: çıktı text'i genelde data.output_text veya choices benzeri döner.
  // Emniyetli erişim:
  return data.output_text?.trim() ||
         data.choices?.[0]?.message?.content?.trim() ||
         "Kısa bir yanıt üretemedim.";
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      // Webhook doğrulama
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
      const body = req.body;

      // Webhook ping'lerini yanıtla
      if (body?.object !== "whatsapp_business_account") {
        return res.status(200).send("ignored");
      }

      // Gelen mesajı yakala
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      if (!msg || msg.type !== "text") {
        return res.status(200).send("no-text");
      }

      const from = msg.from;          // Gönderenin WhatsApp numarası (ülke kodlu)
      const text = msg.text?.body || "";

      // Basit filtre: sadece arıcılık konuları
      const isBee = /arı|arıcılık|kovan|bal|ana arı|oğul|varroa|nektar|polen|kovan/i.test(text);

      let reply;
      if (!isBee) {
        reply = "Bu hat yalnızca arıcılıkla ilgili sorulara yanıt veriyor 🐝 Lütfen arıcılıkla ilgili bir soru sor.";
      } else {
        // OpenAI dene; hata olursa fallback
        try {
          reply = await askOpenAI(
            `Sadece arıcılık alanında kısa, net ve Türkçe yanıt ver. Soru: ${text}`
          );
        } catch (e) {
          console.error(e.message);
          reply = "Şu an yoğunluktan dolayı yapay zekâ yanıtı veremiyorum. " +
                  "Kısa bir süre sonra tekrar dener misin? 🐝";
        }
      }

      await sendWhatsAppText(from, reply);
      return res.status(200).send("ok");
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("Webhook fatal error:", e);
    return res.status(500).send("server error");
  }
};
