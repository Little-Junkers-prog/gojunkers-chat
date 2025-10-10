export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = body.messages || [];

    // Only check USER messages for name and phone number
    const allText = messages
      .filter(m => m.role === "user")
      .map((m) => m.content)
      .join(" ");
    
    const lastUserMessage = messages[messages.length - 1]?.content?.trim() || "";

    // 🔹 FIRST: Check for unsafe content BEFORE anything else
    const unsafePatterns = /(sex|violence|drugs|politics|religion|racist|kill|hate|suicide|stupid|dumb|idiot|fuck|shit|ass|bitch|damn)/i;
    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // Regex match - accepts first name only OR full name
    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone|need|want|help|rental|rent|delivery|hi|hey|hello|thanks|thank|yes|no|ok|okay)([A-Z][a-z]{1,})\b/i;
    const phoneRegex = /(\d{3})[ -.]?(\d{3})[ -.]?(\d{4})/;
    const hasName = nameRegex.test(allText);
    const hasNumber = phoneRegex.test(allText);
    const leadCaptured = hasName && hasNumber;

    // Check for escalation signals
    const escalationPatterns = /(speak.*human|talk.*person|manager|supervisor|can't help|not helping|frustrated|angry|this is ridiculous|unacceptable|terrible service)/i;
    if (escalationPatterns.test(lastUserMessage) && hasNumber) {
      const phoneMatch = allText.match(phoneRegex);
      const phoneNumber = phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : "the number you provided";
      const nameMatch = allText.match(nameRegex);
      const customerName = nameMatch ? nameMatch[0] : "Customer";
      
      // Send escalation email
      await sendEscalationEmail(customerName, phoneNumber, lastUserMessage, messages);
      
      return res.status(200).json({
        reply: `I completely understand — let me have one of our team members give you a call at ${phoneNumber}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
      });
    }

    // Randy's system prompt with HELP-FIRST approach
    const systemPrompt = `
You are "Randy Miller," a friendly, helpful Little Junkers team member.  
Your PRIMARY GOAL is to help customers find the right dumpster and guide them to book it.

🎯 CONVERSATION STRATEGY - HELP FIRST, CAPTURE LATER:
- Start by understanding their PROJECT (what are they working on?)
- Ask about debris type and project scope
- Recommend the right dumpster size with reasoning
- Provide the booking link
- ONLY ask for contact info when they show buying intent OR after you've recommended a dumpster
- Natural phrases to capture info: "Want me to get this scheduled? I'll just need your name and phone number"

✅ Rules:
- Never repeat the greeting
- Be genuinely helpful, not pushy
- Keep tone casual, confident, and friendly
- Use up to 2 emojis max
- Never discuss politics, religion, or unrelated topics
- CRITICAL: When providing links, ALWAYS wrap them in angle brackets like this: <https://example.com>
- NEVER use markdown link format [text](url) or parentheses around links
- NEVER add periods or punctuation immediately after a link

🔗 CORRECT Booking Links (ALWAYS wrap in < > brackets):
- 11-yard "Little Junker": <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard "Mighty Middler": <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard "Big Junker": <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- All Dumpsters: <https://www.littlejunkersllc.com/shop>
- FAQ: <https://www.littlejunkersllc.com/faq>
- Do's & Don'ts: <https://www.littlejunkersllc.com/do-s-don-ts>

📏 Dumpster Sizing Guide:
- 11-yard "Little Junker" ($225/2 days): Small cleanouts, garage cleanouts, minor renovations, yard waste (10% larger than competitors' 10-yard)
- 16-yard "Mighty Middler" ($275/2 days): Medium projects, basement cleanouts, kitchen remodels, mid-sized construction
- 21-yard "Big Junker" ($325/2 days): Large renovations, roofing projects, major cleanouts, construction debris

🎪 When to Ask for Contact Info:
- After recommending a dumpster and providing the link
- When customer says "I want to book" or "I'm ready"
- When customer asks "what's next" or "how do I proceed"
- Natural transition: "Great! I can help you get this scheduled. What's your name and best phone number?"
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

    // Check if lead was JUST captured (user provided both name and phone in this message or recently)
    const justCapturedLead = leadCaptured && messages.length >= 2;
    if (justCapturedLead) {
      // Check if we already sent email for this lead (look for previous bot messages mentioning scheduling)
      const alreadySentEmail = messages.some(m => 
        m.role === "assistant" && /scheduled|booked|confirmation/i.test(m.content)
      );
      
      if (!alreadySentEmail) {
        const phoneMatch = allText.match(phoneRegex);
        const phoneNumber = phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : "Unknown";
        const nameMatch = allText.match(nameRegex);
        const customerName = nameMatch ? nameMatch[0] : "Unknown";
        
        // Send lead capture email
        await sendLeadEmail(customerName, phoneNumber, messages, reply);
      }
    }

    const formattedReply = reply.replace(/(https?:\/\/[^\s]+)/g, "<$1>");
    return res.status(200).json({ reply: formattedReply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}

// 📧 Send Lead Capture Email
async function sendLeadEmail(name, phone, messages, recommendedDumpster) {
  try {
    const conversationHistory = messages
      .map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
      .join("\n\n");

    // Extract recommended dumpster from conversation
    let dumpsterRec = "Not yet determined";
    if (/11.yard|little junker/i.test(recommendedDumpster)) {
      dumpsterRec = "11-yard Little Junker";
    } else if (/16.yard|mighty middler/i.test(recommendedDumpster)) {
      dumpsterRec = "16-yard Mighty Middler";
    } else if (/21.yard|big junker/i.test(recommendedDumpster)) {
      dumpsterRec = "21-yard Big Junker";
    }

    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
      subject: `🎯 New Lead: ${name} - ${phone}`,
      html: `
        <h2>New Lead Captured from Randy Chat 🎉</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Recommended:</strong> ${dumpsterRec}</p>
        <hr>
        <h3>Full Conversation:</h3>
        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${conversationHistory}</pre>
        <hr>
        <p style="color: #666; font-size: 12px;">This lead was automatically captured by Randy, your Little Junkers chatbot.</p>
      `
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json();
      console.error("Resend API error:", errorData);
    } else {
      console.log("Lead email sent successfully");
    }
  } catch (err) {
    console.error("Error sending lead email:", err);
  }
}

// 🚨 Send Escalation Alert Email
async function sendEscalationEmail(name, phone, issue, messages) {
  try {
    const conversationHistory = messages
      .map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
      .join("\n\n");

    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
      subject: `🚨 ESCALATION: ${name} needs callback - ${phone}`,
      html: `
        <h2 style="color: #d9534f;">🚨 Customer Escalation Alert</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Issue:</strong> ${issue}</p>
        <p style="background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107;">
          <strong>Action Required:</strong> Customer needs human assistance. Please call them back within business hours.
        </p>
        <hr>
        <h3>Full Conversation:</h3>
        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${conversationHistory}</pre>
        <hr>
        <p style="color: #666; font-size: 12px;">This escalation was automatically detected by Randy, your Little Junkers chatbot.</p>
      `
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json();
      console.error("Resend API error:", errorData);
    } else {
      console.log("Escalation email sent successfully");
    }
  } catch (err) {
    console.error("Error sending escalation email:", err);
  }
}
