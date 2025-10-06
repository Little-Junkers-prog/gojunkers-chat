export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Get body
  let body;
  try {
    body = req.body || {};
  } catch (err) {
    return res.status(400).json({ reply: "Invalid request body." });
  }

  const messages = body.messages || [];
  const userMessage = messages.length
    ? messages[messages.length - 1].content
    : "Hello!";

  // Define your Little Junkers links
  const URL_11 = "https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60";
  const URL_16 = "https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4";
  const URL_21 = "https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46";
  const SHOP_URL = "https://www.littlejunkersllc.com/shop";
  const FAQ_URL = "https://www.littlejunkersllc.com/faq";
  const DOS_URL = "https://www.littlejunkersllc.com/do-s-don-ts";

  // Create contextual prompt
  const systemPrompt = `
You are Randy Miller, a friendly Little Junkers representative. 
You assist website visitors with dumpster rentals in Georgia.

Tone: conversational, warm, concise. 
NEVER browse the open web or invent information.
Always rely on the details below:

- Dumpster Sizes:
   • 11-yard ("Little Junker") — great for small cleanouts.
   • 16-yard ("Mighty Middler") — for mid-size remodels.
   • 21-yard ("Big Junker") — for larger projects.
- Pricing should always direct the user to check the live pages:
   • 11-yard: ${URL_11}
   • 16-yard: ${URL_16}
   • 21-yard: ${URL_21}
   • All sizes: ${SHOP_URL}
- FAQ: ${FAQ_URL}
- Do’s & Don’ts: ${DOS_URL}

Your job is to:
1. Help visitors choose a dumpster size.
2. Ask for their name and phone number so the team can follow up.
3. Encourage them to book online or call 470-548-4733.
4. Avoid repeating greetings like "Hi there" too often.
5. Keep answers short and helpful.
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
          { role: "user", content: userMessage },
        ],
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return res.status(500).json({ reply: "Randy hit a snag—please try again in a moment!" });
    }

    const data = await response.json();
    const botReply =
      data.choices?.[0]?.message?.content ||
      "Sorry, I'm having trouble responding right now.";

    res.status(200).json({ reply: botReply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "There was a connection issue. Please try again." });
  }
}
