export default async function handler(req, res) {
  // ✅ Allow cross-origin requests from your website
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // ✅ Only allow POST
  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // 🧠 Gather conversation text
    const allText = messages.map((m) => m.content).join(" ");
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // 🧩 Non-stateful regex checks
    const nameRegex = new RegExp(
      "\\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone)([A-Z][a-z]+)\\s([A-Z][a-z]+)\\b",
      "i"
    );
    const phoneRegex = new RegExp("(\\d{3})[ -.]?(\\d{3})[ -.]?(\\d{4})");
    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);
    const hasCity = /(atlanta|peachtree|fayetteville|fairburn|newnan|tyrone)/i.test(allText);
    const leadCaptured = hasName && hasNumber;

    // 🛡️ Guardrail
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // 💬 Lead-capture handling
    if (!leadCaptured) {
      if (!hasName && !hasNumber) {
        return res.status(200).json({
          typing: true,
          reply:
            "Hi there! 👋 I’m Randy with Little Junkers. Before we get started, could I get your *name* and *phone number* so we can keep you updated on delivery details?",
        });
      }
      if (hasName && !hasNumber) {
        return res.status(200).json({
          typing: true,
          reply: "Thanks, got your name 👍 What’s the best number for our driver to reach you?",
        });
      }
      if (!hasName && hasNumber) {
        return res.status(200).json({
          typing: true,
          reply: "Thanks! Got your number 👍 What’s your name so we can confirm delivery?",
        });
      }
    }

    // ✅ Once both are captured, transition smoothly
    if (leadCaptured && /name|number/i.test(lastUserMessage)) {
      return res.status(200).json({
        typing: true,
        reply:
          "Perfect 👍 I’ve got your info saved — what kind of project are you working on today?",
      });
    }

    // 🌟 Randy’s instructions
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
- Do’s & Don’ts: https://www.littlejunkersllc.com/do-s-don-ts  

If customers ask about:
- 📦 Delivery: Apologize for delay, confirm name + number, and reassure follow-up.
- ☎️ Manager: Explain someone will follow up shortly if contact info is provided.
- 🗑️ Junk removal: Clarify that Little Junkers offers dumpsters, not in-home pickups.
`;

    // ⌛ Send typing indicator first (simulate delay)
    setTimeout(() => {
      res.write(JSON.stringify({ typing: true }));
    }, 200);

    // 🧠 Send to OpenAI
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
          { role: "system", content: `Customer context: ${allText}` },
          ...messages,
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

    let reply = data.choices?.[0]?.message?.content?.trim() || "";
    if (!reply || reply.length < 2) {
      reply = "Sorry, I didn’t catch that. Could you rephrase?";
    }

    // 🧩 Sanitize off-topic content
    const forbiddenOut = /(inappropriate|offensive|political|violence)/i;
    if (forbiddenOut.test(reply)) {
      reply = "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍";
    }

    // 🔗 Format URLs for link previews
    const formattedReply = reply.replace(/(https?:\/\/[^\s]+)/g, "<$1>");

    return res.status(200).json({ typing: false, reply: formattedReply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
