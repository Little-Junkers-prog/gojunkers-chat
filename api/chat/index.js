export default async function handler(req, res) {
  try {
    // ---------------- CORS Handling ----------------
    const origin = req.headers.origin;
    const allowedOrigins = [
      "https://www.littlejunkersllc.com",
      "https://littlejunkersllc.com",
      "http://www.littlejunkersllc.com",
      "http://littlejunkersllc.com"
    ];

    if (allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

    // ---------------- Input Parsing ----------------
    const body = req.body || {};
    let messages = Array.isArray(body.messages) ? body.messages : [];
    const event = body.event || null; // e.g. “chatClosed” from frontend

    // Limit message history size
    const MAX_MESSAGES = 50;
    if (messages.length > MAX_MESSAGES) {
      const sys = messages.filter(m => m.role === "system");
      const recent = messages.filter(m => m.role !== "system").slice(-30);
      messages = [...sys, ...recent];
    }

    // ---------------- Helper functions ----------------
    const getAllUserText = msgs =>
      msgs.filter(m => m.role === "user").map(m => m.content || "").join(" ");

    const lastUserMessage =
      (messages[messages.length - 1]?.role === "user"
        ? messages[messages.length - 1].content
        : "")?.trim() || "";

    const allUserText = getAllUserText(messages);

    const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone|need|want|help|rental|rent|delivery|hi|hey|hello|thanks|thank|yes|no|ok|okay)([A-Z][a-z]{1,})\b/i;
    const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const addressRegex = /\d{1,5}\s[A-Za-z0-9\s,.#-]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Trail|Way|Blvd|Boulevard|Place|Pl|Parkway|Pkwy)\b/i;

    const nameMatch = allUserText.match(nameRegex);
    const phoneMatch = allUserText.match(phoneRegex);
    const emailMatch = allUserText.match(emailRegex);
    const addressMatch = allUserText.match(addressRegex);

    const hasName = !!nameMatch;
    const hasNumber = !!phoneMatch;
    const hasEmail = !!emailMatch;
    const hasAddress = !!addressMatch;
    const hasMinimumInfo = hasName && (hasNumber || hasEmail);
    const formatPhone = m => (m ? `${m[1]}-${m[2]}-${m[3]}` : "Not provided");

    // ---------------- Profanity / safety filters ----------------
    const mildProfanity = /\b(stupid|dumb|idiot|fucked?|fucking|shit|bitch|damn|hell)\b/i;
    const extremeProfanity = /\b(kill|murder|suicide|terrorist|bomb|weapon|rape|molest)\b/i;

    if (extremeProfanity.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm ending this chat now. Please call us at 470-548-4733 if you need assistance. Take care.",
      });
    }

    const profanityCount = messages.filter(
      m => m.role === "user" && mildProfanity.test(m.content || "")
    ).length;

    if (profanityCount >= 2) {
      return res.status(200).json({
        reply:
          "I'm going to end this chat now. Please call us at 470-548-4733 if you'd like to rent a dumpster. Take care.",
      });
    }

    if (mildProfanity.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    // ---------------- Escalation + empathy handling ----------------
    const escalationCue =
      /(speak.*human|talk.*person|talk.*someone|manager|supervisor|can't help|not helping|frustrated|angry|ridiculous|unacceptable|terrible service)/i.test(
        lastUserMessage
      );

    const bereavementCue =
      /(my (dad|mom|father|mother|grand(ma|pa)|parent|spouse|wife|husband)) (just )?(passed|died)|lost my (dad|mom|father|mother|grand(ma|pa)|parent|spouse)|bereavement|estate cleanout|death in (the )?family)/i.test(
        lastUserMessage
      );

    const askedForContactCount = messages.filter(
      m =>
        m.role === "assistant" &&
        /what.?s your (name|phone|number|email|contact)/i.test(m.content || "")
    ).length;

    const askedForAddressEmailCount = messages.filter(
      m =>
        m.role === "assistant" &&
        /(delivery address|address|drop.?off address|email)/i.test(m.content || "")
    ).length;

    const endOfChatSignals =
      /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set|done)$/i;
    const isEndingChat = endOfChatSignals.test(lastUserMessage) && hasMinimumInfo;

    // Handle chatClosed event (triggered from frontend)
    if (event === "chatClosed" && hasMinimumInfo) {
      await sendLeadEmail(
        nameMatch?.[0] || "Unknown",
        hasNumber ? formatPhone(phoneMatch) : "Not provided",
        hasEmail ? emailMatch?.[0] : "Not provided",
        hasAddress ? addressMatch?.[0] : "Not provided",
        messages,
        ""
      );
      return res.status(200).json({ reply: "Chat closed, lead captured." });
    }

    // Handle escalation
    if (escalationCue) {
      if (hasNumber) {
        await sendEscalationEmail(
          nameMatch?.[0] || "Customer",
          formatPhone(phoneMatch),
          lastUserMessage,
          messages
        );
        return res.status(200).json({
          reply: `I completely understand — let me have one of our team members give you a call at ${formatPhone(
            phoneMatch
          )}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
        });
      } else {
        return res.status(200).json({
          reply:
            "I understand — let me connect you with someone from our team. What's the best phone number for a callback?",
        });
      }
    }

    // ---------------- System Prompt ----------------
    const systemPrompt = `
You are "Randy Miller," the friendly assistant for Little Junkers — a local dumpster rental service.
Tone: warm, professional, conversational. If the user mentions a loss or bereavement, start with a short condolence before continuing.

🎯 Mission
- Help the customer choose the right dumpster based on their project.
- Provide booking links wrapped in < >.
- Collect first name and either phone OR email (not both unless offered).
- After collecting name + (phone/email), ask ONCE for delivery address.
- Never loop: ask for contact info max twice.

🚫 If user refuses contact info twice, respond:
"No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍"
Then stop asking.

🔗 Links
- 11-yard: <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard: <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard: <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- FAQ: <https://www.littlejunkersllc.com/faq>
- Do's & Don'ts: <https://www.littlejunkersllc.com/do-s-don-ts>
`;

    const antiLoopHints = [];

    if (bereavementCue) {
      antiLoopHints.push({
        role: "system",
        content:
          "Begin with a brief, sincere condolence before helping them with cleanup or dumpster info.",
      });
    }

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      antiLoopHints.push({
        role: "system",
        content:
          "You already asked for contact twice. Stop asking and close politely with booking link.",
      });
    }

    if (hasMinimumInfo && (!hasAddress || !hasEmail) && askedForAddressEmailCount === 0) {
      antiLoopHints.push({
        role: "system",
        content:
          "You have name and contact. You may ask once for address if not given, then close politely.",
      });
    }

    if (isEndingChat) {
      antiLoopHints.push({
        role: "system",
        content:
          "User signaled chat ending. Thank them and confirm someone will reach out to finalize delivery.",
      });
    }

    // ---------------- OpenAI API Call ----------------
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [{ role: "system", content: systemPrompt }, ...antiLoopHints, ...messages],
      }),
    });

    const data = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({ reply: "OpenAI API error" });
    }

    let reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't catch that.";
    reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");

    // ---------------- Lead capture trigger ----------------
    const leadAlreadySent = messages.some(
      m =>
        m.role === "assistant" &&
        /i'?ve got everything i need|we'll reach out shortly|thanks for choosing little junkers/i.test(
          m.content || ""
        )
    );

    if (isEndingChat && hasMinimumInfo && !leadAlreadySent) {
      await sendLeadEmail(
        nameMatch?.[0] || "Unknown",
        hasNumber ? formatPhone(phoneMatch) : "Not provided",
        hasEmail ? emailMatch?.[0] : "Not provided",
        hasAddress ? addressMatch?.[0] : "Not provided",
        messages,
        reply
      );
      reply =
        "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly to confirm your dumpster delivery. Thanks for choosing Little Junkers!";
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("💥 Server crash:", err);
    res.setHeader("Access-Control-Allow-Origin", "https://www.littlejunkersllc.com");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}

// ---------------- Email helpers ----------------
async function sendLeadEmail(name, phone, email, address, messages, lastReply) {
  try {
    const history = messages
      .map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
      .join("\n\n");

    let recommended = "Not yet determined";
    const t = history.toLowerCase();
    if (t.includes("mighty middler") || /\b16\b/.test(t)) recommended = "16-yard Mighty Middler";
    else if (t.includes("big junker") || /\b21\b/.test(t)) recommended = "21-yard Big Junker";
    else if (t.includes("little junker") || /\b11\b/.test(t)) recommended = "11-yard Little Junker";

    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
      subject: `🎯 New Lead: ${name} - ${phone}`,
      html: `
        <h2>New Lead Captured from Randy Chat 🎉</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>Recommended Dumpster:</strong> ${recommended}</p>
        <hr>
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
      console.error("❌ Resend error:", await r.json());
      return false;
    } else {
      console.log("✅ Lead email sent successfully");
      return true;
    }
  } catch (err) {
    console.error("❌ Lead email error:", err);
    return false;
  }
}

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
        <p style="background:#fff3cd;padding:10px;border-left:4px solid #ffc107;">Please call the customer back within business hours.</p>
        <hr>
        <pre style="background:#f5f5f5;padding:15px;border-radius:5px;white-space:pre-wrap;">${history}</pre>
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
      console.error("❌ Resend escalation error:", await r.json());
      return false;
    } else {
      console.log("🚨 Escalation email sent successfully");
      return true;
    }
  } catch (err) {
    console.error("❌ Escalation email error:", err);
    return false;
  }
}
