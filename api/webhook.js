// pages/api/webhook.js

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

/**
 * ENV değişkenleri (Vercel -> Settings -> Environment Variables):
 * - VERIFY_TOKEN = kovan-verify-123   (Meta Webhooks ekranına da aynı yazılacak)
 * - WHATSAPP_SYSTEM_USER_TOKEN  (veya WHATSAPP_TOKEN) = EA....  (System User uzun token)
 * - WHATSAPP_PHONE_NUMBER_ID = 760162310518429
 * - OPENAI_API_KEY = sk-proj-...
 */

export default async function handler(req, res) {
  // --- 1) Webhook VERIFY (GET) ---
  if (req.method === 'GET') {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === (process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN)) {
        return res.status(200).send(challenge);
      }
      return res.status(403).send('Verification token mismatch');
    } catch (e) {
      console.error('VERIFY ERROR', e);
      return res.status(500).send('Server error');
    }
  }

  // --- 2) Webhook EVENTS (POST) ---
  if (req.method === 'POST') {
    try {
      const body = req.body || {};

      // WhatsApp standard payload
      const entry  = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value  = change?.value;

      // status/read gibi event’ler için hızlı 200
      if (value?.statuses) {
        return res.status(200).end();
      }

      const phoneNumberId = value?.metadata?.phone_number_id;  // bizim WABA phone id
      const msgObj        = value?.messages?.[0];
      const fromWaId      = msgObj?.from;                      // gönderen (905... format)
      const msgType       = msgObj?.type;

      // text içeriği
      let userText = '';
      if (msgType === 'text') {
        userText = (msgObj?.text?.body || '').trim();
      } else if (msgType === 'interactive') {
        userText =
          msgObj?.interactive?.button_reply?.title ||
          msgObj?.interactive?.list_reply?.title ||
          '';
      } else {
        userText = '';
      }

      // Mesaj yoksa veya kritik alanlar yoksa 200 dön
      if (!phoneNumberId || !fromWaId || !msgObj) {
        console.log('Non-message event:', JSON.stringify(body));
        return res.status(200).end();
      }

      console.log('INCOMING:', { fromWaId, msgType, userText });

      // ---- 3) (İsteğe bağlı) Konu filtresi: sadece arıcılık soruları ----
      // İstersen bu kısmı pasifleştir.
      const beekeepKeywords = ['arı', 'bal', 'kovan', 'petek', 'arı sütü', 'balmumu', 'koloni', 'ana arı', 'oğul'];
      const isBeekeeping = beekeepKeywords.some(k => userText.toLowerCase().includes(k));
      if (!isBeekeeping && userText) {
        await waSendText(fromWaId, '🐝 Şu an sadece arıcılık ile ilgili sorulara yanıt verebiliyorum.');
        return res.status(200).end();
      }

      // ---- 4) OpenAI ile kısa cevap üret (yoksa basit fallback) ----
      const replyText = await generateAIReply(userText);

      // ---- 5) WhatsApp’a yanıt gönder ----
      await waSendText(fromWaId, replyText || 'Mesajınızı aldım 🐝 Kısa süre içinde döneceğim.');

      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('WEBHOOK ERROR:', err);
      // Meta retry etmesin diye yine 200 dönmek mantıklı
      return res.status(200).json({ ok: true });
    }
  }

  // Diğer methodlar
  return res.status(405).send('Method Not Allowed');
}

// ---------------- Yardımcılar ----------------

async function waSendText(toWaId, text) {
  const token = process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_TOKEN || process.env.META_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const url = `${GRAPH_BASE}/${phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toWaId,
    type: 'text',
    text: { body: String(text || '').slice(0, 4096) }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const t = await r.text();
  if (!r.ok) {
    console.error('WA SEND ERROR:', r.status, t);
  } else {
    try { console.log('WA SEND OK:', r.status, JSON.parse(t)); } catch { console.log('WA SEND OK:', r.status, t); }
  }
}

async function generateAIReply(userText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !userText) {
    return userText
      ? `Selam! Mesajını aldım: “${userText}”.`
      : 'Selam! Nasıl yardımcı olabilirim?';
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              "Sen 'Beekeeper Buddy' adında samimi bir arıcılık asistanısın. Yalnızca arıcılıkla ilgili konularda kısa, açık ve uygulanabilir Türkçe yanıt ver. Konu dışı sorularda: 'Üzgünüm, şu an sadece arıcılıkla ilgili yardımcı olabilirim 🐝' de."
          },
          { role: 'user', content: userText }
        ]
      })
    });

    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content?.trim();
    if (!txt) {
      console.error('OpenAI empty response:', j);
    }
    return txt || `Mesajınızı aldım: “${userText}”.`;
  } catch (e) {
    console.error('OpenAI error:', e);
    return `Mesajınızı aldım: “${userText}”. Birazdan yeniden deneyeceğim.`;
  }
}
