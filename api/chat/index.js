export default async function handler(req, res) {
  const origin = req.headers.origin;
  
  const allowedOrigins = [
    "https://www.littlejunkersllc.com",
    "https://littlejunkersllc.com",
    "http://www.littlejunkersllc.com",
    "http://littlejunkersllc.com"
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    let messages = Array.isArray(body.messages) ? body.messages : [];
    const event = body.event || null;

    const MAX_MESSAGES = 50;
    if (messages.length > MAX_MESSAGES) {
      const systemMessages = messages.filter(m => m.role === "system");
      const recentMessages = messages.filter(m => m.role !== "system").slice(-30);
      messages = [...systemMessages, ...recentMessages];
      console.log(`⚠️ Message history trimmed to prevent overflow`);
    }

    const getAllUserText = (msgs) =>
      msgs.filter((m) => m.role === "user").map((m) => m.content || "").join(" ");

    const lastUserMessage = (messages[messages.length - 1]?.role === "user"
      ? messages[messages.length - 1]?.content
      : "")?.trim() || "";

    const allUserText = getAllUserText(messages);

    const unsafePatterns = /\b(stupid|dumb|idiot|fucked?|fucking|shit|bitch|damn|hell)\b/i;
    const extremeUnsafePatterns = /\b(kill|murder|suicide|terrorist|bomb|weapon|rape|molest)\b/i;

    const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

    const hasNumber = phoneRegex.test(allUserText);
    const hasEmail = emailRegex.test(allUserText);
    const hasMinimumInfo = hasNumber || hasEmail;

    const formatPhone = (m) => (m ? `${m[1]}-${m[2]}-${m[3]}` : "Not provided");

    if (extremeUnsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm ending this chat now. Please call us at 470-548-4733 if you need assistance. Take care.",
      });
    }

    const profanityCount = messages.filter(
      (m) => m.role === "user" && unsafePatterns.test(m.content || "")
    ).length;

    if (profanityCount >= 2) {
      return res.status(200).json({
        reply: "I'm going to end this chat now. Please call us at 470-548-4733 if you'd like to rent a dumpster. Take care.",
      });
    }

    if (unsafePatterns.test(lastUserMessage)) {
      return res.status(200).json({
        reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍",
      });
    }

    const escalationIntent =
      /(speak.*human|talk.*person|talk.*someone|manager|supervisor|can't help|not helping|frustrated|angry|ridiculous|unacceptable|terrible service)/i.test(
        lastUserMessage
      );

    const askedForContactCount = messages.filter(
      (m) =>
        m.role === "assistant" &&
        /what.?s your (name|phone|number|email|contact)/i.test(m.content || "")
    ).length;

    const askedForAddressEmailCount = messages.filter(
      (m) =>
        m.role === "assistant" &&
        /(delivery address|address|drop.?off address|email)/i.test(m.content || "")
    ).length;

    const endOfChatSignals =
      /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set|done)$/i;
    const isEndingChat = endOfChatSignals.test(lastUserMessage) && hasMinimumInfo;

    let cachedLeadInfo = null;

    if (event === "chatClosed" && hasMinimumInfo) {
      console.log("📧 Chat closed - extracting lead info with AI");
      cachedLeadInfo = await extractLeadInfoWithAI(messages, allUserText);
      
      await sendLeadEmail(
        cachedLeadInfo.name || "Unknown",
        cachedLeadInfo.phone || "Not provided",
        cachedLeadInfo.email || "Not provided",
        cachedLeadInfo.address || "Not provided",
        messages,
        ""
      );
      return res.status(200).json({ reply: "Chat closed, lead captured." });
    }

    if (escalationIntent) {
      const phoneMatch = allUserText.match(phoneRegex);
      if (hasNumber) {
        const extractedInfo = cachedLeadInfo || await extractLeadInfoWithAI(messages, allUserText);
        cachedLeadInfo = extractedInfo;
        
        console.log("🚨 Escalation triggered:", {
          name: extractedInfo.name || "Customer",
          phone: extractedInfo.phone || formatPhone(phoneMatch)
        });
        
        await sendEscalationEmail(
          extractedInfo.name || "Customer",
          extractedInfo.phone || formatPhone(phoneMatch),
          lastUserMessage,
          messages
        );
        return res.status(200).json({
          reply: `I completely understand — let me have one of our team members give you a call at ${extractedInfo.phone || formatPhone(phoneMatch)}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
        });
      } else {
        if (askedForContactCount >= 1) {
          return res.status(200).json({
            reply: "I'd be happy to connect you with someone from our team. To do that, I'll need a phone number for them to call you back. Or you can call us directly at 470-548-4733.",
          });
        }
        return res.status(200).json({
          reply: "I understand — let me connect you with someone from our team. What's the best phone number for a callback?",
        });
      }
    }

    const hasBereavementCue =
      /(my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse|wife|husband)) (just )?(passed|died)|lost my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse)|bereavement|estate cleanout|death in (the )?family/i.test(
        lastUserMessage
      );

    const systemPrompt = `You are "Randy Miller," the friendly, helpful assistant for Little Junkers — a local dumpster rental service.
Tone: warm, professional, conversational. If the user mentions a loss or bereavement, begin with a brief, sincere condolence (one sentence) before helping.

MISSION
- Help the customer choose the right dumpster based on their project.
- Provide booking links wrapped in < > brackets.
- Collect first name and either phone OR email (not both unless they volunteer it).
- After collecting name + (phone OR email), you may ask ONCE for delivery address if not provided.
- Never get stuck in loops: ask for contact info at most twice total.

REFUSAL POLICY
- If they refuse to provide contact info twice, stop asking and end with:
  "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍"
- NEVER say "someone will follow up" if you don't have their contact information.

PRICING/GUARDRAILS
- Do not quote prices not shown on the official pages. If asked, send the correct link.
- When unsure, direct to product pages or phone: 470-548-4733.

LINKS (wrap in < >):
- 11-yard "Little Junker": <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard "Mighty Middler": <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard "Big Junker": <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- All Dumpsters: <https://www.littlejunkersllc.com/shop>
- FAQ: <https://www.littlejunkersllc.com/faq>
- Do's & Don'ts: <https://www.littlejunkersllc.com/do-s-don-ts>

FORMATTING RULES
- Wrap all URLs in < > brackets.
- Never use [text](url) markdown or add punctuation immediately after a URL.
- Keep replies under 100 words.
- Use up to 2 emojis max.
- Vary greetings naturally - don't always say the same thing.

DUMPSTER SIZING (high level; do not hard-quote prices):
- 11-yard: small cleanouts (garages, yard waste) - $225/2 days
- 16-yard: kitchen/basement remodels, medium projects - $275/2 days
- 21-yard: large renovations, roofing, construction - $325/2 days`;

    const antiLoopHints = [];
    
    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      antiLoopHints.push({
        role: "system",
        content: "You have already asked for contact information twice and the user has refused. DO NOT ask again. Politely direct them to <https://www.littlejunkersllc.com/shop> or 470-548-4733 and close. Do NOT say 'someone will follow up' since you have no contact info.",
      });
    }
    
    if (hasMinimumInfo && askedForAddressEmailCount >= 1) {
      antiLoopHints.push({
        role: "system",
        content: "You have already asked for address/email once after capturing contact. Do not ask again; proceed to close politely.",
      });
    }

    if (hasMinimumInfo && askedForAddressEmailCount === 0) {
      antiLoopHints.push({
        role: "system",
        content: "You have name + phone/email. You may ask ONCE (politely) for delivery address if helpful, then proceed to answer questions or close.",
      });
    }

    if (isEndingChat) {
      antiLoopHints.push({
        role: "system",
        content: "User signaled the chat is done. Thank them, confirm someone will reach out shortly, and close politely.",
      });
    }

    if (hasBereavementCue) {
      antiLoopHints.push({
        role: "system",
        content: "Begin with a brief, sincere condolence (one sentence) before continuing with helpful guidance about their estate/cleanout needs.",
      });
    }

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
          ...antiLoopHints,
          ...messages,
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(500).json({ reply: "OpenAI API error" });
    }

    let reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't catch that. Could you rephrase?";

    reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");

    const leadAlreadySignaled = messages.some(
      (m) =>
        m.role === "assistant" &&
        /i'?ve got everything i need|we'll reach out shortly|thanks for choosing little junkers/i.test(m.content || "")
    );

    if (isEndingChat && hasMinimumInfo && !leadAlreadySignaled) {
      console.log("📧 Lead capture triggered - extracting info with AI");
      
      const extractedInfo = cachedLeadInfo || await extractLeadInfoWithAI(messages, allUserText);
      
      console.log("📧 Extracted lead info:", extractedInfo);
      
      const emailSent = await sendLeadEmail(
        extractedInfo.name || "Unknown",
        extractedInfo.phone || "Not provided",
        extractedInfo.email || "Not provided",
        extractedInfo.address || "Not provided",
        messages,
        reply
      );
      
      if (emailSent) {
        reply = "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly to confirm your dumpster delivery. Thanks for choosing Little Junkers!";
      } else {
        reply = "Thanks! I've saved your info, though we're having a small technical hiccup on our end. No worries — someone from our team will still reach out to you shortly! 👍";
      }
    }

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      reply = "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍";
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}

async function extractLeadInfoWithAI(messages, allUserText) {
  try {
    const extractionPrompt = `You are a data extraction assistant. Review this conversation and extract the customer's contact information.

Return ONLY a JSON object with these fields (use "Not provided" if information is missing):
{
  "name": "Customer's full name",
  "phone": "Phone number in format XXX-XXX-XXXX",
  "email": "Email address",
  "address": "Full delivery address",
  "confidence": "high/medium/low"
}

Rules:
- Extract the customer's actual name (ignore phrases like "the help", "I need", etc.)
- Format phone as XXX-XXX-XXXX
- Return complete street address if provided
- Use "Not provided" for missing fields
- Set confidence based on clarity of extraction
- Return ONLY valid JSON, no other text`;

    const conversationText = messages
      .filter(m => m.role === "user")
      .map((m, i) => `Message ${i + 1}: ${m.content}`)
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: extractionPrompt },
          { role: "user", content: conversationText }
        ],
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ Extraction API error:", data);
      return regexFallbackExtraction(allUserText);
    }

    const extractedText = data.choices?.[0]?.message?.content?.trim() || "{}";
    const cleanedText = extractedText.replace(/```json\n?|\n?```/g, "").trim();
    const extracted = JSON.parse(cleanedText);
    const validated = validateAndEnhanceExtraction(extracted, allUserText);
    
    console.log("✅ AI extracted lead info:", {
      name: validated.name,
      phone: validated.phone,
      email: validated.email,
      address: validated.address,
      confidence: validated.confidence || "not specified",
      fallbackUsed: validated.fallbackUsed || false
    });
    
    if (validated.confidence === "low" || validated.fallbackUsed) {
      console.warn("⚠️ Low confidence extraction - manual review recommended");
    }
    
    return validated;
  } catch (err) {
    console.error("❌ Error extracting lead info with AI:", err);
    return regexFallbackExtraction(allUserText);
  }
}

function regexFallbackExtraction(allUserText) {
  console.log("⚠️ Using regex fallback extraction");
  
  const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const addressRegex = /\d{1,5}\s+[A-Za-z0-9\s,.#-]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Trail|Way|Blvd|Boulevard|Place|Pl|Parkway|Pkwy|Circle|Cir)(?:\s+[A-Za-z\s]+)?/i;
  
  const phoneMatch = allUserText.match(phoneRegex);
  const emailMatch = allUserText.match(emailRegex);
  const addressMatch = allUserText.match(addressRegex);
  
  const formatPhone = (m) => (m ? `${m[1]}-${m[2]}-${m[3]}` : "Not provided");
  
  return {
    name: "Not provided",
    phone: phoneMatch ? formatPhone(phoneMatch) : "Not provided",
    email: emailMatch ? emailMatch[0] : "Not provided",
    address: addressMatch ? addressMatch[0].replace(/^\d{4}\s+/, '').trim() : "Not provided",
    confidence: "low",
    fallbackUsed: true
  };
}

function validateAndEnhanceExtraction(extracted, allUserText) {
  const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  
  let validated = { ...extracted };
  let fallbackUsed = false;
  
  if (extracted.phone && extracted.phone !== "Not provided") {
    if (!/^\d{3}-\d{3}-\d{4}$/.test(extracted.phone)) {
      const phoneMatch = extracted.phone.match(/(\d{3})\D*(\d{3})\D*(\d{4})/);
      if (phoneMatch) {
        validated.phone = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;
      } else {
        const fallbackPhone = allUserText.match(phoneRegex);
        if (fallbackPhone) {
          validated.phone = `${fallbackPhone[1]}-${fallbackPhone[2]}-${fallbackPhone[3]}`;
          fallbackUsed = true;
        }
      }
    }
  }
  
  if (extracted.email && extracted.email !== "Not provided") {
    if (!emailRegex.test(extracted.email)) {
      const fallbackEmail = allUserText.match(emailRegex);
      if (fallbackEmail) {
        validated.email = fallbackEmail[0];
        fallbackUsed = true;
      }
    }
  }
  
  validated.fallbackUsed = fallbackUsed;
  return validated;
}

async function sendLeadEmail(name, phone, email, address, messages, lastReply) {
  try {
    const history = messages
      .map((m) => {
        const speaker = m.role === "assistant" ? "Randy" : "Customer";
        return `${speaker}: ${m.content}`;
      })
      .join("\n\n");

    const displayName = (name && name !== "Not provided") ? name.split(" ")[0] : "Customer";

    let recommendedDumpster = "Not yet determined";
    const text = history.toLowerCase();
    if (text.includes("mighty middler") || /\b16\b/.test(text)) {
      recommendedDumpster = "16-yard Mighty Middler";
    } else if (text.includes("big junker") || /\b21\b/.test(text)) {
      recommendedDumpster = "21-yard Big Junker";
    } else if (text.includes("little junker") || /\b11\b/.test(text)) {
      recommendedDumpster = "11-yard Little Junker";
    }

    const ODOO_CRM_ALIAS = "crm-sales-channel@littlejunkersllc.odoo.com";

    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: ODOO_CRM_ALIAS,
      subject: `NEW LEAD from Chatbot: ${displayName} - ${phone} (${email})`,
      html: `
        <h2>New Lead Captured from Randy Chat 🎉</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>Recommended Dumpster:</strong> ${recommendedDumpster}</p>
        <hr>
        <h3>Full Conversation History:</h3>
        <pre style="background:#f5f5f5;padding:15px;border-radius:5px;white-space:pre-wrap;">${history}</pre>
        <hr>
        <p style="color:#666;font-size:12px;">Lead automatically captured by Randy, your Little Junkers chatbot. Sent to Odoo CRM Alias.</p>
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
      console.error("❌ Resend error (Lead):", errorData);
      return false;
    } else {
      console.log("✅ Lead email sent successfully to Odoo CRM Alias");
      return true;
    }
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    return false;
  }
}

async function sendEscalationEmail(name, phone, issue, messages) {
  try {
    const history = messages
      .map((m) => {
        const speaker = m.role === "assistant" ? "Randy" : "Customer";
        return `${speaker}: ${m.content}`;
      })
      .join("\n\n");

    const ESCALATION_EMAIL = process.env.EMAIL_TO || "customer_service@littlejunkersllc.com";
    
    const emailBody = {
      from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
      to: ESCALATION_EMAIL,
      subject: `🚨 URGENT ESCALATION: ${name} needs callback - ${phone}`,
      html: `
        <h2 style="color:#d9534f;">🚨 Customer Escalation Alert (For Immediate Human Review)</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Issue:</strong> ${issue}</p>
        <p style="background:#fff3cd;padding:10px;border-left:4px solid #ffc107;">
          <strong>Action Required:</strong> Please call the customer back immediately.
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
      console.error("❌ Resend escalation error:", errorData);
      return false;
    } else {
      console.log("🚨 Escalation email sent successfully to human email");
      return true;
    }
  } catch (err) {
    console.error("❌ Error sending escalation email:", err);
    return false;
  }
}
