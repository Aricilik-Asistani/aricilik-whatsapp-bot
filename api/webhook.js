// /api/webhook.js

export const config = {
  runtime: 'edge',
};

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ''; // Vercel Env'den gelecek

// İstersen buraya OpenAI vb. değişkenleri de koyacağız:
// const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// const META_TOKEN = process.env.META_TOKEN || '';
// const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

export default async function handler(req) {
  const { method, url } = req;
  const { searchParams } = new URL(url);

  // 1) Facebook/WhatsApp “verify webhook” (GET)
  if (method === 'GET') {
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // 2) Mesajlar (POST)
  if (method === 'POST') {
    try {
      const body = await req.json();

      const changes = body?.entry?.[0]?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const from = msg.from;                 // gönderici
        const text = msg.text?.body || '';     // gelen metin

        console.log('INCOMING MESSAGE =>', { from, text });

        // --- Burada OpenAI çağrısı yapıp yanıtı WhatsApp API ile gönderebilirsin ---
        // Örn: arıcılık filtresi + OpenAI cevabı + WhatsApp "messages" POST
      }

      // Kapatma yanıtı
      return new Response('EVENT_RECEIVED', { status: 200 });
    } catch (err) {
      console.error('WEBHOOK_ERROR', err);
      return new Response('Server error', { status: 500 });
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
