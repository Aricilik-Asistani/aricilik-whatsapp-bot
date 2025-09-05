export const config = { runtime: "edge" };

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const WABA_PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function ok(body = "OK") {
  return new Response(body, { status: 200 });
}
function bad(msg = "Forbidden") {
  return new Response(msg, { status: 403 });
}

// Basit arıcılık anahtar kelime filtresi
const BEE_KEYWORDS = [
  "arı", "arıcılık", "kovan", "bal", "oğul", "ana arı", "varroa",
  "kat atma", "besleme", "şurup", "temel petek", "kışlatma",
  "nektar", "polen", "ruşet", "kek", "çerçeve", "memesi", "çıta"
];

function isBeekeeping(text) {
  const t = (text || "").toLowerCase().normalize("NFKD");
  return BEE_KEYWORDS.some(k => t.includes(k));
}

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v23.0/${WABA_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  // Hata olursa logla
  if (!res.ok) {
    const e = await res.text().catch(() => "");
    console.error("WA send error:", res.status, e);
  }
}

async function askOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      input: prompt
    })
  });

  if (!res.ok) {
    const e = await res.text().catch(() => "");
    console.error("OpenAI error:", res.status, e);
    return null;
  }

  const data = await res.json();
  // responses API: output_text (tek string) alanı döner
  return data.output_text || "";
}

export default async function handler(req) {
  // 1) GET — webhook doğrulama
  if (req.method === "GET") {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return ok(challenge || "OK");
    }
    return bad("Token mismatch");
  }

  // 2) POST — mesaj işleme
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return ok(); // Meta bazen boş ping atabiliyor
    }

    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (Array.isArray(messages) && messages.length > 0) {
        const msg = messages[0];
        const from = msg.from;                 // gönderen (telefon)
        const type = msg.type;

        if (type === "text") {
          const text = msg.text?.body || "";

          // Arıcılık filtresi
          if (!isBeekeeping(text)) {
            await sendWhatsAppText(
              from,
              "Şu an sadece **arıcılık** ile ilgili soruları yanıtlayabilirim. Arıcılık hakkında bir şey sormayı dener misin?"
            );
            return ok("EVENT_RECEIVED");
          }

          // OpenAI'dan yanıt al
          const prompt = `Sen arıcılık danışmanısın. Kısa ve net, teknik doğruluğu yüksek yanıt ver.
Soru: ${text}
Yanıt:`;
          const ai = await askOpenAI(prompt);

          const answer = ai?.trim() || "Sorunu tam anlayamadım. Arıcılık hakkında biraz daha detay verebilir misin?";
          await sendWhatsAppText(from, answer);
        }
      }
    } catch (e) {
      console.error("Webhook handle error:", e);
      // Meta'ya 200 döndürmek, tekrar tekrar denemesini engeller
    }

    return ok("EVENT_RECEIVED");
  }

  return new Response("Method Not Allowed", { status: 405 });
}
