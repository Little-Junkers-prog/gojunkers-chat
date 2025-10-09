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
    const messages = body.messages || [];

    // 🧠 Gather all user text for persistent context
    const allText = messages.map((m) => m.content).join(" ");
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // 🧩 Detect customer info (case-insensitive)
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone)([A-Z][a-z]+)\s([A-Z][a-z]+)\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    let hasName = nameRegex.test(allText);
    let hasNumber = phoneRegex.test(allText);
    const hasCity = /(atlanta|peachtree|fayetteville|fairburn|newnan|tyrone)/i.test(allText);

    // 🛡️ Safety guardrail
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply:
          "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // 💬 Early lead-capture logic (combined handling)
    if (!hasName || !hasNumber) {
      // If neither provided yet
      if (!hasName && !hasNumber) {
        return res.status(200).json({
          reply:
            "Hi there! 👋 I’m Randy with Little Junkers. Before we get started, could I get your *name* and *phone number* so we can keep you updated on delivery details?",
        });
      }

      // If only one provided in the entire conversation, prompt for the missing one
      if (hasName && !hasNumber) {
        return res.status(200).json({
          reply:
            "Thanks, got your name 👍 What’s the best number for our driver to reach you?",
        });
      }

      if (!hasName && hasNumber) {
        return res.status(200).json({
          reply:
            "Thanks! Got your number 👍 What’s your name so we can confirm delivery?",
        });
      }
    }

    // ✅ Once both provided, acknowledge ONCE then move forward
    if (hasName && hasNumber && /name|number/i.test(lastUserMessage)) {
      return res.status(200).json({
        reply:
          "Perfect 👍 I’ve got your info saved — what kind of project are you working on today?",
      });
    }

    // ✅ Build context summary for OpenAI (persistent memory)
    let contextSummary = "";
    if (hasName && hasNumber) {
      const nameMatch = allText.match(nameRegex);
      const phoneMatch = allText.match(phoneRegex);
      const nameValue = nameMatch ? nameMatch[0] : "Customer";
      c
