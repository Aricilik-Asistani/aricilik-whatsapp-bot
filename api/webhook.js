// /pages/api/webhook.js  (Next.js için)
export const config = { api: { bodyParser: false } }; // Meta imza doğrulama vs. için ham body gerekebilir

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const WA_TOKEN = process.env.WHATSAPP_SYSTEM_USER_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  try {
    // 1) GET: Webhook verify (şu an çalıştığını test etmiştin)
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
      } else {
        res.status(403).send('Forbidden');
      }
      return;
    }

    // 2) POST: Gelen mesajları yakala
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};

      // Güvenlik: WhatsApp Business Account webhook yapısına göre filtrele
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Status update (delivery/read) ise hemen 200 dön
      if (value?.statuses) {
        res.status(200).json({ ok: true });
        return;
      }

      // Mesaj var mı?
      const messages = value?.messages;
      const contacts = value?.contacts;
      if (!messages || !contacts) {
        res.status(200).json({ ok: true }); // spam/boş event
        return;
      }

      const msg = messages[0];
      const from = msg.from; // gönderenin wa_id'si (905... format)
      const type = msg.type;

      // Sadece text mesajı ele alalım
      let userText = '';
      if (type === 'text') {
        userText = msg.text?.body?.trim() || '';
      } else if (type === 'interactive') {
        // buton, list vs. varsa fallback al
        userText = msg?.interactive?.button_reply?.title
          || msg?.interactive?.list_reply?.title
          || '';
      } else {
        userText = '(metin dışı bir mesaj gönderildi)';
      }

      // 3) OpenAI ile cevap üret (kısa ve net)
      const aiReply = await generateAIReply(OPENAI_KEY, userText);

      // 4) WhatsApp’tan cevapla
      await waSendText(WA_TOKEN, PHONE_ID, from, aiReply);

      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end('Method Not Allowed');
  } catch (err) {
    console.error('WEBHOOK ERROR', err);
    res.status(200).json({ ok: true }); // Meta tekrar denesin diye 200 döneriz
  }
}

// ---- yardımcılar ----

async function waSendText(token, phoneId, to, text) {
  const url = `https://graph.facebook.com/v23.0/${phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text.slice(0, 4096) }, // güvenli uzunluk
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('WA SEND ERROR', r.status, t);
  }
}

async function generateAIReply(openaiKey, userText) {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Kısa ve anlaşılır, samimi ama profesyonel Türkçe yanıt ver.' },
          { role: 'user', content: userText || 'Merhaba' },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim()
      || 'Mesajınızı aldım. Nasıl yardımcı olabilirim?';
  } catch {
    return 'Şu an yanıt üretirken bir sorun oldu, birazdan tekrar deneyeceğim.';
  }
}
