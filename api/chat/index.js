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
    const messages = Array.isArray(body.messages) ? body.messages : [];

    // 🧠 Gather all user text for persistent context
    const allText = messages.map((m) => m.content).join(" ");
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // 🧩 Detect customer info (case-insensitive)
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone)([A-Z][a-z]+)\s([A-Z][a-z]+)\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);

    // 🛡️ Safety guardrail
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // 💬 Early lead-capture logic
    if (!hasName || !hasNumber) {
      if (!hasName && !hasNumber) {
        return res.status(200).json({
          reply: "Hi there! 👋 I’m Randy with Little Junkers. Before we get started, could I get your *name* and *phone number* so we can keep you updated on delivery details?",
        });
      }
      if (hasName && !hasNumber) {
        return res.status(200).json({
          reply: "Thanks, got your name 👍 What’s the best number for our driver to reach you?",
        });
      }
      if (!hasName && hasNumber) {
        return res.status(200).json({
          reply: "Thanks! Got your number 👍 What’s your name so we can confirm delivery?",
        });
      }
    }

    // 🧠 Intent detection
    const deliveryStatus = /(status|where|late|delivery|supposed to arrive|driver)/i;
    const orderIntent = /(deliver|bring|drop off|address|come|get it today|get it now|i'll pay)/i;
    const escalationIntent = /(manager|call|speak to someone|real person|phone|talk to a person)/i;
    const junkIntent = /(junk removal|pick up junk|remove furniture|haul stuff|come inside)/i;

    // 🌟 Randy’s updated personality
    const systemPrompt = `
You are "Randy Miller," a friendly, trustworthy Little Junkers team member.
You help customers rent dumpsters, explain sizes, guide them through booking, and handle light service issues.
Keep your tone casual, confident, and approachable — like a helpful neighbor.
Always thank customers for providing their name or number and personalize replies once you have them.

✅ Rules:
- Never repeat the greeting more than once.
- Never ask again for info the customer already gave.
- Do NOT make up prices — only use the official links below.
- Keep replies under 100 words unless explaining sizes or policies.
- Use at most 1–2 emojis per message.
- Never discuss politics, religion, or personal topics.

🔗 Reference links:
- 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
- 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
- 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
- FAQs: https://www.littlejunkersllc.com/faq
- Do’s & Don’ts: https://www.littlejunkersllc.com/do-s-don-ts
`;

    // ✅ Send to OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const data = await response.json();
    let reply = data.choices?.[0]?.message?.content?.trim() || "";

    if (!reply || reply.length < 2) {
      reply = "Sorry, I didn’t catch that. Could you rephrase?";
    }

    const formattedReply = reply.replace(/(https?:\/\/[^\s]+)/g, "<$1>");
    return res.status(200).json({ reply: formattedReply });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
