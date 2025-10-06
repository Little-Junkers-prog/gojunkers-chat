export default async function handler(req, res) {
  // --- Restrict to POST requests only
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  // --- CORS security: allow only your main website domains
  const allowedOrigins = [
    "https://www.littlejunkersllc.com",
    "https://littlejunkersllc.com"
  ];
  const origin = req.headers.origin;
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ reply: "Unauthorized origin" });
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // --- Little Junkers URLs (for reference in AI responses)
    const URL_11 = "https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60";
    const URL_16 = "https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4";
    const URL_21 = "https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46";
    const SHOP_URL = "https://www.littlejunkersllc.com/shop";
    const FAQ_URL = "https://www.littlejunkersllc.com/faq";
    const RULES_URL = "https://www.littlejunkersllc.com/do-s-don-ts";

    // --- Base system prompt for Randy (the AI Sales Rep)
    const systemPrompt = `
You are Randy Miller, a friendly and knowledgeable Little Junkers sales rep.
You help visitors rent the right dumpster for their project. 
Keep responses concise, confident, and helpful — avoid starting every message with "Hi there" or "Hello again."

Always use the following verified company information when replying:
• 11-yard dumpster ("Little Junker"): ${URL_11}
• 16-yard dumpster ("Mighty Middler"): ${URL_16}
• 21-yard dumpster ("Big Junker"): ${URL_21}
• All dumpsters overview: ${SHOP_URL}
• FAQs: ${FAQ_URL}
• Do’s & Don’ts (restricted items, weight limits): ${RULES_URL}

When asked about **pricing**, **sizes**, or **availability**, reference the booking links above instead of quoting prices from memory.

Your goals:
1. Help the customer choose the right dumpster size based on their project.
2. Capture the customer’s **name** and **phone number** naturally during conversation.
3. Encourage them to **book online** via the provided booking links.
4. If they ask for pickup, service areas, or restrictions — direct them to the FAQ or Do’s & Don’ts pages.
5. Always end with an inviting call to action (e.g., “Would you like me to help you pick a size to reserve today?”).

Stay in character as a helpful Little Junkers rep. Never browse or reference external sites.
    `;

    // --- Send request to OpenAI
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
        temperature: 0.8
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({ reply: "There was a problem generating a reply." });
    }

    const reply = data.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
    res.status(200).json({ reply });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ reply: "Server error. Please try again later." });
  }
}
