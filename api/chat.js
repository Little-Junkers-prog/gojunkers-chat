export default async function handler(req, res) {
  // --- Allowed domains (edit if needed)
  const allowedOrigins = [
    "https://www.littlejunkersllc.com",
    "https://littlejunkersllc.com",
    "http://localhost:8000" // keep this for local testing; remove later
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    return res.status(403).json({ reply: "Unauthorized origin" });
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // --- Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ reply: "Invalid 'messages' array." });
    }

    // --- Add a system instruction that defines your chatbot's personality
    const systemPrompt = {
      role: "system",
      content: `
You are "Randy," the friendly and knowledgeable sales assistant for Little Junkers — a pink dumpster rental company based in Peachtree City, GA.

Your goal is to help visitors rent a dumpster by:
1. Asking if they’re cleaning out, remodeling, moving, or doing a construction project.
2. Recommending the right dumpster size.
3. Explaining that we offer short-term and weekend rentals starting at $199, including 1 ton of weight.
4. Encouraging them to book now or call/text 470-548-4733.
5. Never discuss or search the web — all info should be from Little Junkers’ perspective only.

Keep your tone friendly, conversational, and a little Southern. Example: “Hey there, I can help you pick the right size dumpster — what kinda project you workin’ on?”
`
    };

    // --- Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemPrompt, ...messages],
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", errText);
      return res.status(500).json({ reply: "Error from OpenAI service." });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I’m not sure I understood. Can you rephrase?";
    res.status(200).json({ reply });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ reply: "There was a connection problem. Please try again later." });
  }
}
