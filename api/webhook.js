// api/webhook.js
const META_TOKEN       = process.env.META_TOKEN;
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN || 'aricilik123';
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
// İKİ İSMİ DE DESTEKLE: PHONE_NUMBER_ID yoksa WABA_PHONE_NUMBER_ID kullan
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID || process.env.WABA_PHONE_NUMBER_ID;

async function sendWhatsAppText(to, text) {
  if (!PHONE_NUMBER_ID) {
    console.error("PHONE_NUMBER_ID missing!");
    return;
  }
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
  const t = await r.text();
  if (!r.ok) console.error("WA send error:", r.status, t);
}

async function askOpenAI(prompt) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: "gpt-5-mini", input: prompt })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.output_text?.trim()
      || data.choices?.[0]?.message?.content?.trim()
      || "";
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
      return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (body?.object !== "whatsapp_business_account") return res.status(200).send("ignored");

      const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!msg || msg.type !== "text") return res.status(200).send("no-text");

      const from = msg.from;
      const text = msg.text?.body || "";

      // Sadece arıcılık
      const isBee = /arı|arıcılık|kovan|bal|ana arı|oğul|varroa|nektar|polen|şurup|kışlatma|kek|çerçeve|petek/i.test(text);
      let reply;

      if (!isBee) {
        reply = "Bu hat yalnızca arıcılıkla ilgili sorulara yanıt verir 🐝 Lütfen arıcılık hakkında bir soru yaz.";
      } else {
        try {
          reply = await askOpenAI(
            `Sadece arıcılık alanında kısa, net ve Türkçe yanıt ver. Soru: ${text}\nYanıt:`
          );
          if (!reply) reply = "Kısa bir teknik sorun oldu, lütfen tekrar dener misin? 🐝";
        } catch (e) {
          // 429/insufficient_quota dahil tüm hatalarda nazik fallback
          console.error("OpenAI error:", e.message);
          reply = "Şu an yoğunluktan dolayı yapay zekâ yanıtı veremiyorum. Kısa bir süre sonra tekrar dener misin? 🐝";
        }
      }

      await sendWhatsAppText(from, reply);
      return res.status(200).send("ok");
    }

    return res.status(405).send("Method Not Allowed");
  } catch (e) {
    console.error("Webhook fatal:", e);
    return res.status(500).send("server error");
  }
};
