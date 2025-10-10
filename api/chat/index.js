export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // 🛡️ Input size control - prevent token overflow and cost explosion
    const MAX_MESSAGES = 50; // ~25 exchanges, more than enough for a booking conversation
    if (messages.length > MAX_MESSAGES) {
      // Keep system messages and recent conversation
      const systemMessages = messages.filter(m => m.role === "system");
      const recentMessages = messages.filter(m => m.role !== "system").slice(-30);
      messages.length = 0;
      messages.push(...systemMessages, ...recentMessages);
      console.log(`⚠️ Message history trimmed to prevent overflow`);
    }

    // Combine all user text
    const allText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // 🛑 Profanity & off-topic filter FIRST
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide|stupid|dumb|idiot|fuck|shit|ass|bitch|damn)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // 🧠 Regex detection
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone|need|want|help|rental|rent|delivery|hi|hey|hello|thanks|thank|yes|no|ok|okay)([A-Z][a-z]{1,})\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const addressRegex = /\d{1,5}\s[A-Za-z0-9\s,.#-]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Trail|Way|Blvd|Boulevard|Place|Pl|Parkway|Pkwy)\b/i;

    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);
    const hasEmail = emailRegex.test(allText);
    const hasAddress = addressRegex.test(allText);
    const hasMinimumInfo = hasName && (hasNumber || hasEmail);

    // Extract actual values
    const nameMatch = allText.match(nameRegex);
    const phoneMatch = allText.match(phoneRegex);
    const emailMatch = allText.match(emailRegex);
    const addressMatch = allText.match(addressRegex);

    // Track if lead email was already sent (to prevent duplicates)
    const leadEmailSent = messages.some(m => 
      m.role === "assistant" && /got everything I need|we'll confirm|thanks for choosing little junkers/i.test(m.content)
    );
    
    // Detect end of conversation signals
    const endOfChatSignals = /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set)$/i;
    const isEndingChat = endOfChatSignals.test(lastUserMessage.trim()) && hasMinimumInfo;

    // Track how many times Randy asked for contact info (prevent loops)
    const askedForContactCount = messages.filter(m =>
      m.role === "assistant" && /what.s your (name|phone|number|email|contact)/i.test(m.content)
    ).length;

    // 🚨 Escalation check
    const escalationPatterns = /(speak.*human|talk.*person|manager|supervisor|can't help|not helping|frustrated|angry|ridiculous|unacceptable|terrible service)/i;
    if (escalationPatterns.test(lastUserMessage) && hasNumber) {
      await sendEscalationEmail(
        nameMatch?.[0] || "Customer",
        formatPhone(phoneMatch),
        lastUserMessage,
        messages
      );
      return res.status(200).json({
        reply: `I completely understand — let me have one of our team members give you a call at ${formatPhone(phoneMatch)}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
      });
    }

    // 🧭 System prompt for Randy
    const systemPrompt = `
You are "Randy Miller," the friendly, helpful assistant for Little Junkers — a local dumpster rental service.
Tone: warm, professional, conversational, like a small business team member.

🎯 Your mission:
- Help the customer choose the right dumpster based on their project
- Provide booking links wrapped in < > brackets
- Naturally ask for their first name and either phone OR email (not both unless they volunteer it)
- If they decline contact info after being asked twice, politely redirect to the booking page and stop asking

✅ Conversation Flow:
1. Greet warmly and ask about their project
2. Understand debris type and project scope
3. Recommend the right dumpster size with the booking link
4. Naturally transition to: "Want me to help you get this scheduled? I'll just need your first name and phone number (or email)"
5. Once you have name + (phone OR email), answer any remaining questions they have
6. When they signal they're done (say "thanks", "bye", "okay", "perfect", etc.), thank them and let them know someone will follow up

If a customer refuses contact info twice, respond:
  "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> 👍"
Then DO NOT ask again.

🏗️ Dumpster Info:
- 11-yard "Little Junker" ($225/2 days): small cleanouts, garages, yard cleanup <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard "Mighty Middler" ($275/2 days): kitchen/basement remodels, medium projects <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard "Big Junker" ($325/2 days): large renovations, roofing, construction <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- FAQ: <https://www.littlejunkersllc.com/faq>
- Do's & Don'ts: <https://www.littlejunkersllc.com/do-s-don-ts>

CRITICAL FORMATTING RULES:
- ALWAYS wrap all URLs in < > brackets like this: <https://example.com>
- NEVER use markdown format [text](url)
- NEVER add punctuation immediately after a URL
- Keep messages under 100 words
- Use max 2 emojis per message`;

    // Anti-loop safeguard
    const antiLoopPrompt =
      askedForContactCount >= 2
        ? {
            role: "system",
            content:
              "You have already asked for contact information twice. DO NOT ask again. Politely redirect to the booking page: <https://www.littlejunkersllc.com/shop>",
          }
        : null;

    // 💬 OpenAI call
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
          ...(antiLoopPrompt ? [antiLoopPrompt] : []),
          ...messages,
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({ reply: "OpenAI API error" });
    }

    let reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't catch that.";

    // 🔹 CRITICAL: Ensure URLs are wrapped in < > for frontend parsing
    reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");

    // ✅ Send lead email ONLY when conversation is ending and minimum info captured
    if (hasMinimumInfo && !leadEmailSent && isEndingChat) {
      console.log("📧 Lead capture triggered:", {
        name: nameMatch?.[0] || "Unknown",
        phone: formatPhone(phoneMatch),
        email: emailMatch?.[0] || "Not provided"
      });
      
      const emailSent = await sendLeadEmail(
        nameMatch?.[0] || "Unknown",
        formatPhone(phoneMatch),
        emailMatch?.[0] || "Not provided",
        addressMatch?.[0] || "Not provided",
        messages,
        reply
      );
      
      // Add confirmation message that signals email was sent
      if (emailSent) {
        reply = "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly to confirm your dumpster delivery. Thanks for choosing Little Junkers!";
      } else {
        reply = "Thanks! I've saved your info, though we're having a small technical hiccup on our end. No worries — someone from our team will still reach out to you shortly! 👍";
      }
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}

// 📧 Lead email
async function sendLeadEmail(name, phone, email, address, messages, lastReply) {
  try {
    const history = messages
      .map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
      .join("\n\n");
    
    const displayName = name.split(" ")[0] || "Customer";
    
    // Determine recommended dumpster from conversation
    let recommendedDumpster = "Not yet determined";
    const conversationText = history.toLowerCase();
    if (conversationText.includes("11") || conversationText.includes("little junker")) {
      recommendedDumpster = "11-yard Little Junker";
    } else if (conversationText.includes("16") || conversationText.includes("mighty middler")) {
      recommendedDumpster = "16-yard Mighty Middler";
    } else if (conversationText.includes("21") || conversationText.includes("big junker")) {
      recommendedDumpster = "21-yard Big Junker";
    }

    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
      subject: `🎯 New Lead: ${displayName} - ${phone}`,
      html: `
        <h2>New Lead Captured from Randy Chat 🎉</h2>
        <p><strong>Name:</strong> ${displayName}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>Recommended Dumpster:</strong> ${recommendedDumpster}</p>
        <hr>
        <h3>Full Conversation:</h3>
        <pre style="background:#f5f5f5;padding:15px;border-radius:5px;white-space:pre-wrap;">${history}</pre>
        <hr>
        <p style="color:#666;font-size:12px;">Lead automatically captured by Randy, your Little Junkers chatbot.</p>
      `,
    };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });
    
    if (!r.ok) {
      const errorData = await r.json();
      console.error("❌ Resend error:", errorData);
      return false; // Signal failure
    } else {
      console.log("✅ Lead email sent successfully");
      return true; // Signal success
    }
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    return false; // Signal failure
  }
}

// 🚨 Escalation email
async function sendEscalationEmail(name, phone, issue, messages) {
  try {
    const history = messages
      .map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
      .join("\n\n");
    
    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
      subject: `🚨 ESCALATION: ${name} needs callback - ${phone}`,
      html: `
        <h2 style="color:#d9534f;">🚨 Customer Escalation Alert</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Issue:</strong> ${issue}</p>
        <p style="background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107;">
          <strong>Action Required:</strong> Customer needs human assistance. Please call them back within business hours.
        </p>
        <hr>
        <h3>Full Conversation:</h3>
        <pre style="background:#f5f5f5;padding:15px;border-radius:5px;white-space:pre-wrap;">${history}</pre>
        <hr>
        <p style="color:#666;font-size:12px;">Escalation automatically detected by Randy, your Little Junkers chatbot.</p>
      `,
    };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });
    
    if (!r.ok) {
      const errorData = await r.json();
      console.error("Resend escalation error:", errorData);
    } else {
      console.log("🚨 Escalation email sent successfully");
    }
  } catch (err) {
    console.error("Error sending escalation email:", err);
  }
}

// Helper function to format phone numbers
function formatPhone(match) {
  if (!match) return "Not provided";
  return `${match[1]}-${match[2]}-${match[3]}`;
}
