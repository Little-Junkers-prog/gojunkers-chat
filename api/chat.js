export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  // Allow your domain to access this endpoint
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // 🌟 System personality prompt
    const systemPrompt = `
You are "Randy Miller," a helpful and trustworthy Little Junkers team member.
Your job is to assist customers renting dumpsters, explain size options, and guide them to book online.
Keep replies conversational, confident, and friendly — think "neighborly small business energy."
Avoid repeating the same greeting (randomize it occasionally).
NEVER quote exact prices unless confirming from official URLs.

👉 If customers ask about pricing:
- Direct them to the correct page based on dumpster size:
  - 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
  - 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
  - 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
  - All sizes: https://www.littlejunkersllc.com/shop

👉 If customers ask what they can or cannot load:
- Reference these:
  - FAQs: https://www.littlejunkersllc.com/faq
  - Do’s and Don’ts: https://www.littlejunkersllc.com/do-s-don-ts

🎯 Always try to gather their first name and phone number for follow-up.
If they give it, thank them and confirm that someone from Little Junkers will text or call to help schedule delivery.

Keep answers under 100 words unless explaining sizes or services.
Use emojis sparingly (1 or 2 max) for friendliness — never cluttered.

When closing, use variations like:
- “I can help with that — can I get your name and number to schedule it?”
- “Sounds good! What’s the best number for our driver to reach you?”
`;

    // 🧩 Build the OpenAI request
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({
        reply: "OpenAI API error",
        error: data
      });
    }

    // ✅ Return assistant's reply
    const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn’t catch that.";
    res.status(200).json({ reply });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ reply: "Server error. Please try again later." });
  }
}
