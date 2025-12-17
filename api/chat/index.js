export default async function handler(req, res) {
  // =========================
  // 1) CORS (set early)
  // =========================
  const origin = req.headers.origin || "";

  const allowedOrigins = new Set([
    "https://www.littlejunkersllc.com",
    "https://littlejunkersllc.com",
    "http://www.littlejunkersllc.com",
    "http://littlejunkersllc.com",
  ]);

  // If Origin is present (browser call), only allow your domains.
  // If Origin is missing (server-to-server), we allow it.
  if (origin) {
    if (allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      // IMPORTANT: return 403 for unknown origins
      // (Browser will still show CORS-ish errors, but that’s fine.)
      return res.status(403).json({ reply: `Origin not allowed: ${origin}` });
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  // =========================
  // 2) Env var validation
  // =========================
  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (missing.length) {
    console.error("❌ Missing env vars:", missing);
    return res.status(500).json({
      reply: "Server configuration error",
      error: `Missing env vars: ${missing.join(", ")}`,
    });
  }

  // Email settings (these can be defaults, but must be valid if used)
  const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@littlejunkersllc.com";
  const EMAIL_TO = process.env.EMAIL_TO || "customer_service@littlejunkersllc.com";
  const ODOO_CRM_ALIAS =
    process.env.ODOO_CRM_ALIAS || "crm-sales-channel@littlejunkersllc.odoo.com";

  try {
    // =========================
    // 3) Parse body safely
    // =========================
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    let messages = Array.isArray(body.messages) ? body.messages : [];
    const event = body.event || null;

    // =========================
    // 4) Trim history
    // =========================
    const MAX_MESSAGES = 60;
    if (messages.length > MAX_MESSAGES) {
      const systemMessages = messages.filter((m) => m.role === "system");
      const recentMessages = messages.filter((m) => m.role !== "system").slice(-40);
      messages = [...systemMessages, ...recentMessages];
      console.log("⚠️ Message history trimmed");
    }

    const getAllUserText = (msgs) =>
      msgs.filter((m) => m.role === "user").map((m) => m.content || "").join(" ");

    const lastUserMessage =
      (messages[messages.length - 1]?.role === "user"
        ? messages[messages.length - 1]?.content
        : "")?.trim() || "";

    const allUserText = getAllUserText(messages);

    // =========================
    // 5) Simple safety filters
    // =========================
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

    // =========================
    // 6) Intent detectors
    // =========================
    const escalationIntent =
      /(speak.*human|talk.*person|talk.*someone|manager|supervisor|can't help|not helping|frustrated|angry|ridiculous|unacceptable|terrible service)/i.test(
        lastUserMessage
      );

    // FIXED counters:
    const askedForContactCount = countMatches(messages, isContactAsk);
    const askedForAddressCount = countMatches(messages, isAddressAsk);

    const endOfChatSignals =
      /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set|done)$/i;
    const isEndingChat = endOfChatSignals.test(lastUserMessage) && hasMinimumInfo;

    const hasBereavementCue =
      /(my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse|wife|husband)) (just )?(passed|died)|lost my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse)|bereavement|estate cleanout|death in (the )?family)/i.test(
        lastUserMessage
      );

    // Prevent duplicate emails across end-of-chat + chatClosed
    const leadAlreadySignaled = messages.some(
      (m) =>
        m.role === "assistant" &&
        /i'?ve got everything i need|we('ll| will) reach out shortly|thanks for choosing little junkers/i.test(
          m.content || ""
        )
    );

    // =========================
    // 7) chatClosed event
    // =========================
    if (event === "chatClosed" && hasMinimumInfo) {
      if (leadAlreadySignaled) {
        return res.status(200).json({ reply: "Chat closed (lead already captured)." });
      }

      console.log("📧 chatClosed — extracting lead info + emailing");
      const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

      await sendLeadEmailSafe({
        resendApiKey: process.env.RESEND_API_KEY,
        from: EMAIL_FROM,
        to: ODOO_CRM_ALIAS,
        name: extractedInfo.name || "Unknown",
        phone: extractedInfo.phone || "Not provided",
        email: extractedInfo.email || "Not provided",
        address: extractedInfo.address || "Not provided",
        messages,
        lastReply: "",
      });

      return res.status(200).json({ reply: "Chat closed, lead captured." });
    }

    // =========================
    // 8) Escalation flow
    // =========================
    if (escalationIntent) {
      const phoneMatch = allUserText.match(phoneRegex);

      if (hasNumber) {
        const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

        await sendEscalationEmailSafe({
          resendApiKey: process.env.RESEND_API_KEY,
          from: EMAIL_FROM,
          to: EMAIL_TO,
          name: extractedInfo.name || "Customer",
          phone: extractedInfo.phone || formatPhone(phoneMatch),
          issue: lastUserMessage,
          messages,
        });

        return res.status(200).json({
          reply: `I completely understand — let me have one of our team members give you a call at ${
            extractedInfo.phone || formatPhone(phoneMatch)
          }. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
        });
      }

      if (askedForContactCount >= 1) {
        return res.status(200).json({
          reply:
            "I'd be happy to connect you with someone from our team. To do that, I'll need a phone number for them to call you back. Or you can call us directly at 470-548-4733.",
        });
      }

      return res.status(200).json({
        reply: "I understand — let me connect you with someone from our team. What's the best phone number for a callback?",
      });
    }

    // =========================
    // 9) System prompt
    // =========================
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
- 11-yard: <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard: <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard: <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- All Dumpsters: <https://www.littlejunkersllc.com/shop>

FORMATTING RULES
- Wrap all URLs in < > brackets.
- Never use markdown links.
- Keep replies under 100 words.
- Use up to 2 emojis max.`;

    const antiLoopHints = [];

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      antiLoopHints.push({
        role: "system",
        content:
          "You have already asked for contact information twice and the user has refused. DO NOT ask again. Direct them to <https://www.littlejunkersllc.com/shop> or 470-548-4733 and close. Do NOT say someone will follow up.",
      });
    }

    if (hasMinimumInfo && askedForAddressCount >= 1) {
      antiLoopHints.push({
        role: "system",
        content:
          "You have already asked for the delivery address once after capturing contact. Do not ask again; proceed to answer questions or close politely.",
      });
    }

    if (hasMinimumInfo && askedForAddressCount === 0) {
      antiLoopHints.push({
        role: "system",
        content:
          "You have name + phone/email. You may ask ONCE (politely) for delivery address if helpful, then proceed to answer questions or close.",
      });
    }

    if (hasBereavementCue) {
      antiLoopHints.push({
        role: "system",
        content:
          "Begin with a brief, sincere condolence (one sentence) before continuing with helpful guidance.",
      });
    }

    // =========================
    // 10) OpenAI call
    // =========================
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

    const aiData = await safeJson(aiRes);
    if (!aiRes.ok) {
      console.error("OpenAI API error:", aiData);
      return res.status(500).json({ reply: "OpenAI API error", error: aiData });
    }

    let reply =
      aiData?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn't catch that. Could you rephrase?";

    // Force correct link formatting + kill empty <>
    reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");
    reply = reply.replace(/<>/g, "<https://www.littlejunkersllc.com/shop>");
    reply = ensureBookingLink(reply);

    // =========================
    // 11) Lead capture at end-of-chat (only once)
    // =========================
    if (isEndingChat && hasMinimumInfo && !leadAlreadySignaled) {
      console.log("📧 End-of-chat — extracting lead info + emailing");
      const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

      const emailSent = await sendLeadEmailSafe({
        resendApiKey: process.env.RESEND_API_KEY,
        from: EMAIL_FROM,
        to: ODOO_CRM_ALIAS,
        name: extractedInfo.name || "Unknown",
        phone: extractedInfo.phone || "Not provided",
        email: extractedInfo.email || "Not provided",
        address: extractedInfo.address || "Not provided",
        messages,
        lastReply: reply,
      });

      reply = emailSent
        ? "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly to confirm your dumpster delivery. Thanks for choosing Little Junkers!"
        : "Thanks! I've saved your info, though we're having a small technical hiccup on our end. No worries — someone from our team will still reach out to you shortly! 👍";
    }

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      reply =
        "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍";
    }

    return res.status(200).json({ reply });
  } catch (err) {
    // If we crash, log the real reason (this is what you need in Vercel logs)
    console.error("❌ Server error:", err);
    return res.status(500).json({ reply: "Server error", error: err?.message || String(err) });
  }
}

/* =========================
   Helpers
========================= */

function countMatches(messages, predicateFn) {
  return messages.filter((m) => m.role === "assistant" && predicateFn(m.content || "")).length;
}

function isContactAsk(text) {
  return /(first name|your name|phone number|best number|callback number|email address|contact info|how can we reach you)/i.test(
    text
  );
}

function isAddressAsk(text) {
  // IMPORTANT: address only (not email)
  return /(delivery address|drop.?off address|what.?s the address|jobsite address|where should we deliver|delivery location|address\?)/i.test(
    text
  );
}

function ensureBookingLink(reply) {
  const hasAnyLink = /<https?:\/\/[^>]+>/.test(reply);
  if (hasAnyLink) return reply;

  const text = reply.toLowerCase();

  const LINKS = {
    "11": "https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60",
    "16": "https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4",
    "21": "https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46",
    all: "https://www.littlejunkersllc.com/shop",
  };

  let link = LINKS.all;
  if (text.includes("big junker") || /\b21\b/.test(text)) link = LINKS["21"];
  else if (text.includes("mighty middler") || /\b16\b/.test(text)) link = LINKS["16"];
  else if (text.includes("little junker") || /\b11\b/.test(text)) link = LINKS["11"];

  return reply + `\n\nYou can book here: <${link}>`;
}

async function extractLeadInfoWithAI(messages, allUserText) {
  try {
    const extractionPrompt = `Return ONLY valid JSON with:
{
  "name": "Customer's full name",
  "phone": "XXX-XXX-XXXX",
  "email": "Email address",
  "address": "Full delivery address",
  "confidence": "high/medium/low"
}
Use "Not provided" if missing.`;

    const conversationText = messages
      .filter((m) => m.role === "user")
      .map((m, i) => `Message ${i + 1}: ${m.content}`)
      .join("\n");

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
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
          { role: "user", content: conversationText },
        ],
      }),
    });

    const data = await safeJson(r);
    if (!r.ok) {
      console.error("❌ Extraction API error:", data);
      return regexFallbackExtraction(allUserText);
    }

    const extractedText = data?.choices?.[0]?.message?.content?.trim() || "{}";
    const cleanedText = extractedText.replace(/```json\n?|\n?```/g, "").trim();
    const extracted = JSON.parse(cleanedText);

    return validateAndEnhanceExtraction(extracted, allUserText);
  } catch (err) {
    console.error("❌ Error extracting lead info:", err);
    return regexFallbackExtraction(allUserText);
  }
}

function regexFallbackExtraction(allUserText) {
  const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const addressRegex =
    /\d{1,5}\s+[A-Za-z0-9\s,.#-]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Trail|Way|Blvd|Boulevard|Place|Pl|Parkway|Pkwy|Circle|Cir)(?:\s+[A-Za-z\s]+)?/i;

  const phoneMatch = allUserText.match(phoneRegex);
  const emailMatch = allUserText.match(emailRegex);
  const addressMatch = allUserText.match(addressRegex);

  const formatPhone = (m) => (m ? `${m[1]}-${m[2]}-${m[3]}` : "Not provided");

  return {
    name: "Not provided",
    phone: phoneMatch ? formatPhone(phoneMatch) : "Not provided",
    email: emailMatch ? emailMatch[0] : "Not provided",
    address: addressMatch ? addressMatch[0].trim() : "Not provided",
    confidence: "low",
  };
}

function validateAndEnhanceExtraction(extracted, allUserText) {
  const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

  const validated = { ...extracted };

  if (validated.phone && validated.phone !== "Not provided") {
    if (!/^\d{3}-\d{3}-\d{4}$/.test(validated.phone)) {
      const m = String(validated.phone).match(/(\d{3})\D*(\d{3})\D*(\d{4})/);
      if (m) validated.phone = `${m[1]}-${m[2]}-${m[3]}`;
      else {
        const fb = allUserText.match(phoneRegex);
        if (fb) validated.phone = `${fb[1]}-${fb[2]}-${fb[3]}`;
      }
    }
  }

  if (validated.email && validated.email !== "Not provided") {
    if (!emailRegex.test(validated.email)) {
      const fb = allUserText.match(emailRegex);
      if (fb) validated.email = fb[0];
    }
  }

  return validated;
}

/* =========================
   Resend + Email hardening
========================= */

function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHistory(messages) {
  const MAX = 80;
  const sliced = messages.slice(-MAX);
  return sliced
    .map((m) => `${m.role === "assistant" ? "Randy" : "Customer"}: ${m.content || ""}`)
    .join("\n\n");
}

function inferRecommendedDumpster(historyLower) {
  if (historyLower.includes("mighty middler") || /\b16\b/.test(historyLower)) return "16-yard Mighty Middler";
  if (historyLower.includes("big junker") || /\b21\b/.test(historyLower)) return "21-yard Big Junker";
  if (historyLower.includes("little junker") || /\b11\b/.test(historyLower)) return "11-yard Little Junker";
  return "Not yet determined";
}

async function sendLeadEmailSafe({ resendApiKey, from, to, name, phone, email, address, messages, lastReply }) {
  try {
    if (!isEmailLike(from)) {
      console.error("❌ EMAIL_FROM invalid:", from);
      return false;
    }
    if (!isEmailLike(to)) {
      console.error("❌ ODOO_CRM_ALIAS invalid:", to);
      return false;
    }

    const historyRaw = buildHistory(messages);
    const recommended = inferRecommendedDumpster(historyRaw.toLowerCase());
    const displayName = name && name !== "Not provided" ? name.split(" ")[0] : "Customer";

    const subject = `NEW LEAD from Chatbot: ${displayName} - ${phone} (${email})`;

    const html = `
      <h2>New Lead Captured from Randy Chat 🎉</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Recommended Dumpster:</strong> ${escapeHtml(recommended)}</p>
      ${lastReply ? `<p><strong>Last Bot Reply:</strong> ${escapeHtml(lastReply)}</p>` : ""}
      <hr>
      <h3>Conversation History:</h3>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
        historyRaw
      )}</pre>
      <hr>
      <p style="color:#666;font-size:12px;">Lead automatically captured by Randy.</p>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    const payload = await safeJson(r);
    if (!r.ok) {
      console.error("❌ Resend lead email error:", payload);
      return false;
    }

    console.log("✅ Lead email sent");
    return true;
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    return false;
  }
}

async function sendEscalationEmailSafe({ resendApiKey, from, to, name, phone, issue, messages }) {
  try {
    if (!isEmailLike(from)) {
      console.error("❌ EMAIL_FROM invalid:", from);
      return false;
    }
    if (!isEmailLike(to)) {
      console.error("❌ EMAIL_TO invalid:", to);
      return false;
    }

    const historyRaw = buildHistory(messages);

    const subject = `🚨 URGENT ESCALATION: ${name} needs callback - ${phone}`;

    const html = `
      <h2 style="color:#d9534f;">🚨 Customer Escalation Alert</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Issue:</strong> ${escapeHtml(issue)}</p>
      <hr>
      <h3>Conversation History:</h3>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
        historyRaw
      )}</pre>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    const payload = await safeJson(r);
    if (!r.ok) {
      console.error("❌ Resend escalation email error:", payload);
      return false;
    }

    console.log("🚨 Escalation email sent");
    return true;
  } catch (err) {
    console.error("❌ Error sending escalation email:", err);
    return false;
  }
}

async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return { status: r.status, statusText: r.statusText };
  }
}
