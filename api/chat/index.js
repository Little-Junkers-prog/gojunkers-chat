export default async function handler(req, res) {
  // ✅ Allow cross-origin requests from Little Junkers website
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const messages = body.messages || [];
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // --- Basic state tracking for conversation context
    let hasName = /([A-Z][a-z]+)(\s[A-Z][a-z]+)?/.test(lastUserMessage);
    let hasNumber = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/.test(lastUserMessage);
    let hasCity = /(atlanta|peachtree|fayetteville|fairburn|newnan|tyrone)/i.test(lastUserMessage);

    // --- Safety filter for inappropriate content
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // --- Intent recognition (determine what kind of message this is)
    const deliveryStatus = /(status|where|late|delivery|supposed to arrive|driver)/i;
    const orderIntent = /(deliver|bring|drop off|address|come|get it today|get it now|i'll pay)/i;
    const escalationIntent = /(manager|call|speak to someone|real person|phone|talk to a person)/i;
    const junkIntent = /(junk removal|pick up junk|remove furniture|haul stuff|come inside)/i;

    // 🚨 1. Delivery status inquiry
    if (deliveryStatus.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I’m really sorry for the delay! 🚚 I’ll make sure someone checks on that delivery right away. Could you please confirm your name and phone number so we can update you?",
      });
    }

    // 🚚 2. Order intent (ready-to-book signal)
    if (orderIntent.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "Got it! 🚚 I’ll have the delivery team prep your request. Can I confirm your name and phone number so we can schedule your drop-off?",
      });
    }

    // ☎️ 3. Escalation request (user wants to talk to a person)
    if (escalationIntent.test(lastUserMessage)) {
      // In the next phase, we’ll connect this to Make for SMS alerts
      return res.status(200).json({
        reply: "No problem 👍 I’ll make sure a team member reaches out shortly. What’s the best number to reach you at?",
      });
    }

    // ♻️ 4. Junk removal / off-service redirect
    if (junkIntent.test(lastUserMessage)) {
      const junkReplies = [
        "We focus on dumpster rentals — you fill it, we haul it! Want help picking a size?",
        "We don’t do indoor junk removal, but our dumpsters make cleanup easy. Would you like me to help you choose one?",
        "We specialize in roll-off dumpsters — perfect for clearing clutter fast. Want to see what size fits your project?"
      ];
      const randomReply = junkReplies[Math.floor(Math.random() * junkReplies.length)];
      return res.status(200).json({ reply: randomReply });
    }

    // 🧠 5. Memory awareness (avoid repeating name/number requests)
    if (hasName && !hasNumber) {
      return res.status(200).json({
        reply: "Thanks! Got your name 👍 What’s the best number for our driver to reach you to confirm delivery?",
      });
    }
    if (hasNumber && !hasName) {
      return res.status(200).json({
        reply: "Perfect, I’ve got your number. Could you please tell me your name so we can finish your booking?",
      });
    }
    if (hasName && hasNumber && hasCity) {
      return res.status(200).json({
        reply: "Excellent — I’ve got all your info. Let’s lock in your delivery date 🚚. Would you like drop-off tomorrow or later this week?",
      });
    }

    // 🌟 System prompt (default assistant personality)
    const systemPrompt = `
You are "Randy Miller," a friendly, trustworthy Little Junkers team member.
You help customers rent dumpsters, explain sizes, and guide them to book online.
Keep your tone casual, confident, and approachable — like a helpful neighbor.
Avoid repeating the same greeting every time.
Do NOT make up prices; only reference official links if asked.

If customers ask about pricing, use these links:
- 11-yard: https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
- 16-yard: https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
- 21-yard: https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
- All sizes: https://www.littlejunkersllc.com/shop

If customers ask what can/can’t go in the dumpster, use:
- FAQs: https://www.littlejunkersllc.com/faq
- Do’s and Don’ts: https://www.littlejunkersllc.com/do-s-don-ts

Encourage customers to share their name and phone number for follow-up.
If they provide it, confirm that someone from Little Junkers will call or text to schedule delivery.

Keep responses under 100 words unless explaining sizes or policies.
Use emojis lightly (1–2 max). 
End with warm calls to action like:
- "Can I get your name and number so we can lock in delivery?"
- "What’s the best number for our driver to reach you?"
`;

    // 🤖 Send conversation to OpenAI for general chat handling
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
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

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({ reply: "OpenAI API error", error: data });
    }

    let reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn’t catch that.";

    // 🔗 Auto-link URLs in message text
    const formattedReply = reply.replace(/(https?:\/\/[^\s]+)/g, "<$1>");

    return res.status(200).json({ reply: formattedReply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}
