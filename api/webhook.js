// api/webhook.js
export default function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      res.status(200).send(challenge); // Meta’ya challenge geri gönder
    } else {
      res.status(403).send('Forbidden');
    }
  } else if (req.method === 'POST') {
    console.log('Webhook event received:', req.body);
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.status(405).send('Method Not Allowed');
  }
}
