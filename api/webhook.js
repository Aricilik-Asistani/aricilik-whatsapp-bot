// api/webhook.js  — Vercel (Node 22, ESM) uyumlu tek dosya

// ==== ENV ====
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN;          // Webhook verify
const META_TOKEN       = process.env.META_TOKEN;            // WhatsApp Cloud API token (kalıcı/system user önerilir)
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;       // Örn: 855469457640686
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;        // OpenAI key
const WA_API_VERSION   = "v23.0";                           // Meta Graph versiyonu

// ==== OpenAI ====
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ==== Basit anti-spam & limit yapıları (serverless'ta in-memory, tanıtım için yeterli) ====
const processedWamIds = new Set();        // aynı mesaj (wamid) ikinci kez işlenmesin
const lastReplyAt     = new Map();        // numara başı son yanıt zamanı
const COOLDOWN_MS     = 15_000;           // 15 saniye
const DAILY_LIMIT     = 5;                // günlük soru hakkı
const userLimits      = {};               // { phone: { date: 'YYYY-MM-DD', count: n } }

// ==== Yardımcılar ====
function isBeeTopic(text = "") {
  const t = text.toLowerCase();
  const kws = [
    "arı","ari","arıcılık","aricilik","kovan","bal","nektar","polen",
    "ana arı","ana ari","işçi arı","isci ari","oğul","ogul",
    "varroa","nosema","kışlatma","kislatma","kat atma","besleme",
    "şurup","surup","invert","temel petek","ruşet","ruset","kek","çerçeve","petek",
    "eşek arısı","esek arisi","vespa","sarıca arı","kasap arı"
  ];
  return kws.some(k => t.includes(k));
}

function rememberWamid(id) {
  if (!id) return false;
  if (processedWamIds.has(id)) return false;
  processedWamIds.add(id);
  if (processedWamIds.size > 1000) {
    const first = processedWamIds.values().next().value;
    processedWamIds.delete(first);
  }
  return true;
}

function underCooldown(phone) {
  const now = Date.now();
  const last = lastReplyAt.get(phone) || 0;
  if (now - last < COOLDOWN_MS) return true;
  lastReplyAt.set(phone, now);
  return false;
}

function consumeDailySlot(phone) {
  const today = new Date().toISOString().slice(0, 10);
  if (!userLimits[phone] || userLimits[phone].date !== today) {
    userLimits[phone] = { date: today, count: 0 };
  }
  if (userLimits[phone].count >= DAILY_LIMIT) return false;
  userLimits[phone].count++;
  return true;
}

// WhatsApp’a TEXT gönder
async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const out = await r.text().catch(() => "");
  if (!r.ok) console.error("WA send error:", r.status, out);
  else console.log("WA send ok:", out);
  return { ok: r.ok, text: out };
}

// 24 saat penceresi kapalıysa (551) pencereyi ŞABLONLA aç, sonra tekrar text gönder
async function sendTemplate(to, name = "reengage_bee", lang = "tr") {
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: to }] }
      ]
    }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await r.text().catch(() => "");
  if (!r.ok) console.error("WA template send error:", r.status, out);
  return r.ok;
}

async function safeSendTextThenReengage(to, text) {
  const result = await sendWhatsAppText(to, text);
  if (result.ok) return true;

  // 551 (outside 24h window) kontrolü — gövdede 551 metni geçer
  if (result.text.includes('"code":551') || result.text.includes("outside the 24-hour window")) {
    console.log("551 detected → sending template to reopen window");
    const ok = await sendTemplate(to, "reengage_bee", "tr");
    if (ok) {
      await new Promise(res => setTimeout(res, 600)); // kısa gecikme
      const retry = await sendWhatsAppText(to, text);
      return retry.ok;
    }
  }
  return false;
}

// OpenAI yanıtı (Beekeeper Buddy, sıcak & samimi)
async function getBeeReply(userText) {
  const systemPrompt = `
Sen "Beekeeper Buddy" isimli sıcak ve samimi bir arıcılık asistanısın.
Sadece arıcılıkla ilgili konularda yardımcı ol; konu dışına çıkma.
Yanıtlarında dostça, samimi bir üslup kullan; kısa ve net yaz ama gerektiğinde pratik ipuçları ver.
Riskli işlemlerde koruyucu ekipman ve mevsimsel/yerel koşullara dikkat çek.
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    max_tokens: 220,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userText }
    ],
  });

  return (resp.choices?.[0]?.message?.content || "").trim();
}

// ==== Vercel default handler ====
export default async function handler(req, res) {
  try {
    // 1) META Webhook doğrulaması (GET)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    // 2) Mesaj işleme (POST)
    if (req.method === "POST") {
      const value   = req.body?.entry?.[0]?.changes?.[0]?.value;

      // a) Status event'lerini tamamen yok say
      if (value?.statuses) return res.status(200).send("status-ignored");

      const message = value?.messages?.[0];
      if (!message || message.type !== "text") return res.status(200).send("no-text");

      const from  = message.from;
      const text  = message.text?.body || "";
      const wamid = message.id;

      // b) Aynı mesaj ikinci kez geldiyse işleme
      if (!rememberWamid(wamid)) return res.status(200).send("dup-ignored");

      // c) Cooldown: 15 sn içinde ikinci yanıtı kes
      if (underCooldown(from)) return res.status(200).send("cooldown");

      console.log("Incoming:", { from, text });

      // d) Günlük 5 soru limiti (OpenAI çağrısından önce!)
      if (!consumeDailySlot(from)) {
        await safeSendTextThenReengage(from, "Günlük soru limitiniz dolmuştur. Yarın yeniden deneyebilirsiniz. 🐝");
        return res.status(200).send("limit-reached");
      }

      // e) Konu filtresi: arıcılık dışıysa OpenAI'ye sorma
      if (!isBeeTopic(text)) {
        await safeSendTextThenReengage(
          from,
          "Üzgünüm, bu konu arıcılıkla ilgili olmadığı için yardımcı olamıyorum. " +
          "Beekeeper Buddy sadece arıcılık sorularını yanıtlar 🐝"
        );
        return res.status(200).send("filtered");
      }

      // f) OpenAI yanıtı
      let reply = "";
      try {
        reply = await getBeeReply(text);
        if (!reply) reply = "Kısa bir teknik sorun oldu, tekrar dener misin? 🐝";
      } catch (e) {
        console.error("OpenAI error:", e?.status, e?.message);
        reply = "Şu an yoğunluktan dolayı yanıt veremiyorum. Lütfen biraz sonra tekrar dener misin? 🐝";
      }

      // g) İmza ekle ve gönder
      const signed = `${reply}\n\n🐝 — Beekeeper Buddy`;
      await safeSendTextThenReengage(from, signed);

      return res.status(200).send("ok");
    }

    return res.status(405).send("Method Not Allowed");
  } catch (err) {
    console.error("Webhook fatal:", err);
    return res.status(200).send("handled"); // Meta retry yapmasın
  }
}

// Vercel body parser açık
export const config = { api: { bodyParser: true } };
