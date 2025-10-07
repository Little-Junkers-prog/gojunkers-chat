export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  res.status(200).json({ reply: "Chat endpoint working!" });
}
