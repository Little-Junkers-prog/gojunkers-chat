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

    // Regex match - accepts first name only OR full name
    // Excludes common service/location words, accepts names with 2+ letters
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone|need|want|help|rental|rent|delivery|hi|hey|hello|thanks|thank|yes|no|ok|okay)([A-Z][a-z]{1,})\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);
    const leadCaptured = hasName && hasNumber;

    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    const escalationPatterns = /(speak.*human|talk.*person|manager|supervisor|can't help|not helping|frustrated|angry|this is ridiculous|unacceptable|terrible service)/i;
    
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // Check for escalation signals
    if (escalationPatterns.test(lastUserMessage) && hasNumber) {
      const phoneMatch = allText.match(phoneRegex);
      const phoneNumber = phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : "the number you provided";
      return res.status(200).json({
        reply: `I completely understand — let me have one of our team members give you a call at ${phoneNumber}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
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
          reply: "Perfect! And what's the best phone number to reach you at?",
        });
      }
      if (!hasName && hasNumber) {
        return res.status(200).json({
          reply: "Great! And what should I call you?",
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
Your PRIMARY GOAL is to help customers book a dumpster rental. Guide them toward selecting a size and completing a booking.

✅ Rules:
- Never repeat the greeting more than once.
- Never ask again for info already given.
- Keep tone casual, confident, and friendly.
- Use up to 2 emojis max.
- Never discuss politics, religion, or unrelated topics.
- ALWAYS recommend a dumpster size based on their project and provide the booking link.
- Proactively ask about project details (type of debris, project scope) to recommend the right size.

🔗 CORRECT Booking Links (ALWAYS use these exact URLs):
- 11-yard "Little Junker": https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60
- 16-yard "Mighty Middler": https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4
- 21-yard "Big Junker": https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46
- All Dumpsters: https://www.littlejunkersllc.com/shop
- FAQ: https://www.littlejunkersllc.com/faq  
- Do's & Don'ts: https://www.littlejunkersllc.com/do-s-don-ts

📏 Dumpster Sizing Guide:
- 11-yard "Little Junker" ($225/2 days): Small cleanouts, garage cleanouts, minor renovations, yard waste
- 16-yard "Mighty Middler" ($275/2 days): Medium projects, basement cleanouts, kitchen remodels, mid-sized construction
- 21-yard "Big Junker" ($325/2 days): Large renovations, roofing projects, major cleanouts, construction debris

🚨 ESCALATION - If customer shows ANY of these signals, immediately end chat and assure them someone will call:
- Requests to speak with a human/manager/supervisor
- Expresses frustration, anger, or dissatisfaction
- Has complex questions you cannot answer
- Mentions custom requirements, special circumstances, or unique situations
- Asks about pricing details not on the website
- Questions about permits, weight limits, or technical restrictions

ESCALATION RESPONSE: "I completely understand — let me have one of our team members give you a call at [their phone number]. They'll be able to help you with [specific issue]. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍"
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
