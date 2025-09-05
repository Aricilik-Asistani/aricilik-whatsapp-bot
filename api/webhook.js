export default function handler(req, res) {
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        // ✅ Doğru token → challenge geri döndür
        res.status(200).send(challenge);
      } else {
        // ❌ Yanlış token
        res.status(403).send("Forbidden");
      }
    }
  } else if (req.method === "POST") {
    const body = req.body;

    if (body.object) {
      console.log("📩 Gelen mesaj:", JSON.stringify(body, null, 2));
      res.status(200).send("EVENT_RECEIVED");
    } else {
      res.status(404).send("Not Found");
    }
  } else {
    res.status(405).send("Method Not Allowed");
  }
}
