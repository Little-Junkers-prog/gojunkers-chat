export default async function handler(req, res) {
  // ✅ Allow cross-origin requests from your website
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // 🌟 Randy's friendly system prompt
    const systemPrompt = `
You are "Randy Miller," a friendly, trustworthy Little Junkers team member.
You help customers rent dumpsters, explain sizes, and guide them to book online.
Keep your tone casual, confident, and approachable — like a helpful neighbor.
Avoid repeating greetings.
If pricing is requested, use the official shop links.

Links:
- 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
- 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
- 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
- FAQ: https://www.littlejunkersllc.com/faq
- Do’s & Don’ts: https://www.littlejunkersllc.com/do-s-don-ts

Encourage customers to share their name and number for follow-up.
Keep answers under 100 words unless explaining policies.
Use emojis lightly (1–2 max).
End warmly with:
- “Can I get your name and number so we can lock in delivery?”
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn’t catch that.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
