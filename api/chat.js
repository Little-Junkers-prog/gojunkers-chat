export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    if (!process.env.OPENAI_API_KEY) {
      console.error("Missing OPENAI_API_KEY in environment");
      return res.status(500).json({ reply: "Server misconfiguration: missing API key." });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are Randy, a friendly Little Junkers sales rep. Your only job is to help customers book a dumpster rental.

**Rules:**
- Never say “Hi there” or repeat greetings in every message.
- Always use an upbeat, conversational tone.
- Pull prices only from official pages:
  - 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
  - 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
  - 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
  - All sizes: https://www.littlejunkersllc.com/shop
- For FAQs: https://www.littlejunkersllc.com/faq
- For allowed/disallowed materials: https://www.littlejunkersllc.com/do-s-don-ts
- Never browse the internet; only use these URLs for references.
- If a customer asks about pricing, guide them to the right link.
- Always ask politely for their **name** and **phone number** early in the chat so a team member can reach them.
- Encourage them to book online at the end of the conversation.
            `,
          },
          ...messages,
        ],
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI API error:", text);
      return res.status(500).json({ reply: "OpenAI error: " + text });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
    res.status(200).json({ reply });

  } catch (err) {
    console.error("Chat handler error:", err);
    res.status(500).json({ reply: "There was a connection issue. Please try again later." });
  }
}
