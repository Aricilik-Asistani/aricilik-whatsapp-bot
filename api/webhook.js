// /api/webhook.js — Vercel/Next.js API Route uyumlu (express yok)
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_token";
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // EA... token (güncel)
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // 855469457640686
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;   // sk-...

  // 1) Webhook doğrulama (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // 2) Mesaj alma (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      // WhatsApp webhook formatı
      if (body.object !== "whatsapp_business_account") {
        return res.sendStatus(200);
      }

      const change = body?.entry?.[0]?.changes?.[0];
      const message = change?.value?.messages?.[0];
      if (!message) {
        return res.sendStatus(200);
      }

      const from = message.from;
      const text =
        message.text?.body?.trim() ||
        message.button?.text?.trim() ||
        message.interactive?.button_reply?.title?.trim() ||
        "";

      // Arıcılık filtresi
      const lower = text.toLowerCase();
      const keywords = [
        "arı", "aricilik", "arıcılık", "kovan", "bal", "ana arı", "oğul",
        "invert", "şurup", "varroa", "nektar", "polen", "kışlatma",
        "besleme", "ilaçlama", "çıta", "petek", "yumurta", "larva",
        "arı sütü", "propolis", "kovan bakımı", "bal sağımı"
      ];
      const isBeekeeping = keywords.some(k => lower.includes(k));

      let reply;
      if (!isBeekeeping) {
        reply = "Bu bot yalnızca **arıcılık** ile ilgili soruları yanıtlar 🐝. Lütfen arıcılıkla ilgili bir soru yaz.";
      } else {
        // OpenAI çağrısı (hata olursa fallback)
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "Yalnızca arıcılık hakkında cevap ver. Kısa ve net yaz." },
                { role: "user", content: text },
              ],
              temperature: 0.4,
              max_tokens: 300,
            }),
          });
          const data = await r.json();
          reply = data?.choices?.[0]?.message?.content?.trim();
          if (!reply) throw new Error("empty-openai");
        } catch (err) {
          console.error("OpenAI error:", err);
          reply = "Şu an yoğunluktan dolayı cevap veremiyorum, lütfen daha sonra deneyin 🐝";
        }
      }

      // WhatsApp’a yanıt gönder
      const waResp = await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: reply },
        }),
      });

      if (!waResp.ok) {
        const errText = await waResp.text();
        console.error("WhatsApp send error:", waResp.status, errText);
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error("Webhook error:", e);
      return res.sendStatus(200);
    }
  }

  return res.sendStatus(405);
}
