export default async function handler(req, res) {
  // Allow your website to call this API
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    if (!messages.length) {
      return res.status(400).json({ reply: "Missing messages array" });
    }

    // --- Construct localized context for your business ---
    const systemPrompt = `
You are Randy, a friendly Little Junkers chatbot. You help customers rent dumpsters in the south Atlanta area.
Always speak conversationally, like a helpful salesperson, not a search engine. 
Encourage booking and guide users to the correct size dumpster for their needs.

If asked about prices:
- Reference the Little Junkers website pricing pages before quoting anything.
- Direct customers to view current rates here:
  • 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
  • 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
  • 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
  • All sizes: https://www.littlejunkersllc.com/shop

If users ask about what can/can’t go inside, reference:
  • Do’s and Don’ts: https://www.littlejunkersllc.com/do-s-don-ts
  • FAQ: https://www.littlejunkersllc.com/faq

Always aim to capture leads by asking:
  1. “Can I get your name so I can check availability for your area?”
  2. “What’s the best phone number to reach you at?”
Never search the open web. Only use information from the Little Junkers website and context above.
    `;

    // --- Call OpenAI Chat API ---
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({ reply: "Error connecting to AI service." });
    }

    const reply = data.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
    res.status(200).json({ reply });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ reply: "Internal server error." });
  }
}
