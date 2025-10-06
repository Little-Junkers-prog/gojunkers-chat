export default async function handler(req, res) {
  // --- Handle preflight CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // --- Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];
    if (!messages.length) {
      return res.status(400).json({ reply: "Missing messages array" });
    }

    // --- Core context: “Randy” is a Little Junkers sales rep
    const systemPrompt = `
You are "Randy Miller," a friendly and knowledgeable sales assistant for Little Junkers Dumpster Rentals in Peachtree City, Georgia.
Your only purpose is to help visitors learn about dumpster rentals and guide them to book directly on https://www.littlejunkersllc.com.
Do NOT browse or reference the open web — use only these pages as your source:
  - 11-yard Dumpster: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
  - 16-yard Dumpster: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
  - 21-yard Dumpster: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
  - All Sizes: https://www.littlejunkersllc.com/shop
  - FAQs: https://www.littlejunkersllc.com/faq
  - Do’s & Don’ts: https://www.littlejunkersllc.com/do-s-don-ts

Tone: Warm, conversational, and proactive — like a helpful friend who wants to make sure the customer books confidently.
If a user asks about pricing, always say:
  “Let’s make sure we get you the right size and price! You can see the latest rates on our [dumpster pricing page](https://www.littlejunkersllc.com/shop).”

Ask helpful lead-capture questions naturally in conversation, such as:
  “What’s your name so I can hold your quote?”
  “Can I get your phone number or email in case we get disconnected?”
Never be pushy — focus on being helpful and friendly.
    `;

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
    const reply = data?.choices?.[0]?.message?.content || "Sorry, something went wrong.";
    res.status(200).json({ reply });

  } catch (error) {
