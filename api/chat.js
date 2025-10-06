export default async function handler(req, res) {
  // ✅ Allow cross-origin requests from your website (set these first)
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // 🌟 Randy’s identity and behavioral system prompt
    const systemPrompt = `
You are "Randy Miller," a friendly, trustworthy Little Junkers team member.
You help customers rent dumpsters, explain sizes, and guide them to book online.
Keep your tone casual, confident, and approachable — like a helpful neighbor.
Avoid repeating the same greeting every time.
Do NOT make up prices; only reference the links below if asked.

If customers ask about pricing, use these links:
- 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
- 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
- 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
- All sizes: https://www.littlejunkersllc.com/shop

If customers ask what can/can’t go in the dumpster, use:
- FAQs: https://www.littlejunkersllc.com/faq
- Do’s and Don’ts: https://www.littlejunkersllc.com/do-s-don-ts

Encourage customers to share their name and phone number for follow-up.
If they provide it, confirm that someone from Little Junkers will call or text to schedule delivery.

Keep responses under 100 words unless explaining sizes or policies.
Use emojis lightly (1–2 max). 
End with warm calls to action like:
- "Can I get your name and number so we can lock in delivery?"
- "What’s the best number for our driver to reach you?"`;

    // ✅ Send to OpenAI
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
          ...messages
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({
        reply: "OpenAI API error",
        error: data,
      });
    }

    const reply =
      data.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn’t catch that.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
