export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // FIXED: Only check USER messages for name and phone number
    const allText = messages
      .filter(m => m.role === "user")
      .map((m) => m.content)
      .join(" ");
    
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // Regex match - made more flexible for name matching
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone)([A-Z][a-z]+)\s([A-Z][a-z]+)\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);
    const leadCaptured = hasName && hasNumber;

    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // Lead capture logic
    if (!leadCaptured) {
      if (!hasName && !hasNumber) {
        return res.status(200).json({
          reply:
            "Hi there! 👋 I'm Randy with Little Junkers. Before we get started, could I get your *name* and *phone number* so we can keep you updated on delivery details?",
        });
      }
      if (hasName && !hasNumber) {
        return res.status(200).json({
          reply: "Thanks, got your name 👍 What's the best number for our driver to reach you?",
        });
      }
      if (!hasName && hasNumber) {
        return res.status(200).json({
          reply: "Thanks! Got your number 👍 What's your name so we can confirm delivery?",
        });
      }
    }

    if (leadCaptured && /name|number/i.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "Perfect 👍 I've got your info saved — what kind of project are you working on today?",
      });
    }

    // Randy's system prompt
    const systemPrompt = `
You are "Randy Miller," a friendly, trustworthy Little Junkers team member.  
You help customers rent dumpsters, explain sizes, guide them through booking, and answer service-related questions.  
Always thank customers for their info and personalize replies once name and number are known.  

✅ Rules:
- Never repeat the greeting more than once.
- Never ask again for info already given.
- Keep tone casual, confident, and friendly.
- Use up to 2 emojis max.
- Never discuss politics, religion, or unrelated topics.

🔗 Links:
- 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60  
- 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4  
- 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46  
- FAQ: https://www.littlejunkersllc.com/faq  
- Do's & Don'ts: https://www.littlejunkersllc.com/do-s-don-ts  
`;

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
          { role: "system", content: `Conversation so far: ${allText}` },
          ...messages,
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({ reply: "OpenAI API error" });
    }

    let reply = data.choices?.[0]?.message?.content?.trim() || "";
    if (!reply) reply = "Sorry, I didn't catch that. Could you rephrase?";

    const forbiddenOut = /(inappropriate|offensive|political|violence)/i;
    if (forbiddenOut.test(reply)) {
      reply = "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍";
    }

    const formattedReply = reply.replace(/(https?:\/\/[^\s]+)/g, "<$1>");
    return res.status(200).json({ reply: formattedReply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
