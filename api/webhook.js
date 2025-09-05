export default function handler(req, res) {
  if (req.method === "GET") {
    // Meta webhook doğrulaması
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED");
        return res.status(200).send(challenge);
      } else {
        return res.sendStatus(403);
      }
    }
  } else if (req.method === "POST") {
    // Gelen mesajı yakala
    console.log("Gelen Mesaj:", JSON.stringify(req.body, null, 2));

    // Meta'ya 200 OK dönmek çok önemli
    return res.sendStatus(200);
  } else {
    res.sendStatus(405);
  }
}
