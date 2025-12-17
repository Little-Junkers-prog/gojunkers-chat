export default async function handler(req, res) {
  // -----------------------------
  // 1) CORS: set headers FIRST
  // -----------------------------
  const origin = req.headers.origin;

  // Allow: littlejunkersllc.com, www.littlejunkersllc.com, and any subdomain (*.littlejunkersllc.com)
  const isAllowedOrigin = (o) => {
    if (!o) return true; // server-to-server
    if (o === "null") return false;
    try {
      const u = new URL(o);
      const h = u.hostname.toLowerCase();
      return h === "littlejunkersllc.com" || h.endsWith(".littlejunkersllc.com");
    } catch {
      return false;
    }
  };

  // DEBUG SWITCH: temporarily allow any origin to prove CORS is the issue.
  // Set in Vercel env: ALLOW_ALL_ORIGINS=true then redeploy.
  const allowAll = process.env.ALLOW_ALL_ORIGINS === "true";

  // Always set something for browsers so even 500 responses are readable
  if (origin && (allowAll || isAllowedOrigin(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (origin && !allowAll) {
    // If origin is not allowed, DO NOT set ACAO. Browser should block it.
    // But we still want to handle OPTIONS cleanly.
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(200).end();

  // If browser origin is present and not allowed, block now (clean 403)
  if (origin && !allowAll && !isAllowedOrigin(origin)) {
    return res.status(403).json({ reply: "Origin not allowed." });
  }

  if (req.method !== "POST") return res.status(405).json({ reply: "Method not allowed" });

  // -----------------------------
  // 2) Env checks (prevents mystery 500s)
  // -----------------------------
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

  // -----------------------------
  // 3) Parse body safely
  // -----------------------------
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  try {
    let messages = Array.isArray(body.messages) ? body.messages : [];
    const event = body.event || null;

    // Trim history to keep OpenAI + email payloads sane
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

    // Filters
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

    const askedForContactCount = countMatches(messages, isContactAsk);
    const askedForAddressCount = countMatches(messages, isAddressAsk);

    const endOfChatSignals =
      /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set|done)$/i;
    const isEndingChat = endOfChatSignals.test(lastUserMessage) && hasMinimumInfo;

    const hasBereavementCue =
      /(my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse|wife|husband)) (just )?(passed|died)|lost my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse)|bereavement|estate cleanout|death in (the )?family)/i.test(
        lastUserMessage
      );

    const leadAlreadySignaled = messages.some(
      (m) =>
        m.role === "assistant" &&
        /i'?ve got everything i need|we('ll| will) reach out shortly|thanks for choosing little junkers/i.test(
          m.content || ""
        )
    );

    // -----------------------------
    // chatClosed event (don’t double-send)
    // -----------------------------
    if (event === "chatClosed" && hasMinimumInfo) {
      if (leadAlreadySignaled) {
        return res.status(200).json({ reply: "Chat closed (lead already captured)." });
      }

      const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

      await sendLeadEmailSafe({
        name: extractedInfo.name || "Unknown",
        phone: extractedInfo.phone || "Not provided",
        email: extractedInfo.email || "Not provided",
        address: extractedInfo.address || "Not provided",
        messages,
        lastReply: "",
      });

      return res.status(200).json({ reply: "Chat closed, lead captured." });
    }

    // -----------------------------
    // Escalation
    // -----------------------------
    if (escalationIntent) {
      const phoneMatch = allUserText.match(phoneRegex);

      if (hasNumber) {
        const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

        await sendEscalationEmailSafe({
          name: extractedInfo.name || "Customer",
          phone: extractedInfo.phone || formatPhone(phoneMatch),
          issue: lastUserMessage,
          messages,
        });

        return res.status(200).json({
          reply: `I completely understand — let me have one of our team members give you a call at ${
            extractedInfo.phone || formatPhone(phoneMatch)
          }. Someone will reach out during business hours. 👍`,
        });
      }

      if (askedForContactCount >= 1) {
        return res.status(200).json({
          reply:
            "I'd be happy to connect you with someone from our team. What's the best phone number for a callback? Or call us at 470-548-4733.",
        });
      }

      return res.status(200).json({
        reply: "I understand — let me connect you with someone from our team. What's the best phone number for a callback?",
      });
    }

    // -----------------------------
    // OpenAI prompt + anti-loop hints
    // -----------------------------
    const systemPrompt = `You are "Randy Miller," the friendly assistant for Little Junkers.
Tone: warm, professional, conversational.

MISSION
- Help choose the right dumpster.
- Provide booking links wrapped in < > brackets.
- Collect first name and either phone OR email.
- After collecting contact, you may ask ONCE for delivery address.
- Ask for contact info at most twice total.

If they refuse contact twice, end with:
"No problem — you can book here: <https://www.littlejunkersllc.com/shop> or call 470-548-4733. 👍"

LINKS (wrap in < >):
- 11-yard: <https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60>
- 16-yard: <https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4>
- 21-yard: <https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46>
- All: <https://www.littlejunkersllc.com/shop>

FORMATTING:
- Keep replies under 100 words.
- Max 2 emojis.
- Wrap all URLs in < >.`;

    const antiLoopHints = [];

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      antiLoopHints.push({
        role: "system",
        content:
          "You already asked for contact twice and user refused. Do not ask again; direct them to <https://www.littlejunkersllc.com/shop> or 470-548-4733 and close.",
      });
    }

    if (hasMinimumInfo && askedForAddressCount >= 1) {
      antiLoopHints.push({
        role: "system",
        content: "You already asked for delivery address once. Do not ask again; close politely.",
      });
    }

    if (hasMinimumInfo && askedForAddressCount === 0) {
      antiLoopHints.push({
        role: "system",
        content: "You have name + phone/email. You may ask ONCE for delivery address if helpful.",
      });
    }

    if (hasBereavementCue) {
      antiLoopHints.push({
        role: "system",
        content: "User mentioned a loss. Start with one brief condolence sentence before helping.",
      });
    }

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
      console.error("OpenAI error:", aiData);
      return res.status(500).json({ reply: "OpenAI API error" });
    }

    let reply =
      aiData?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn't catch that. Could you rephrase?";

    // Normalize links
    reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");
    reply = reply.replace(/<>/g, "<https://www.littlejunkersllc.com/shop>");
    reply = ensureBookingLink(reply);

    // Lead capture on “ending chat”
    if (isEndingChat && hasMinimumInfo && !leadAlreadySignaled) {
      const extractedInfo = await extractLeadInfoWithAI(messages, allUserText);

      const emailSent = await sendLeadEmailSafe({
        name: extractedInfo.name || "Unknown",
        phone: extractedInfo.phone || "Not provided",
        email: extractedInfo.email || "Not provided",
        address: extractedInfo.address || "Not provided",
        messages,
        lastReply: reply,
      });

      reply = emailSent
        ? "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly. Thanks for choosing Little Junkers!"
        : "Thanks! We saved your info, but had a small technical hiccup. Someone will still reach out shortly! 👍";
    }

    if (askedForContactCount >= 2 && !hasMinimumInfo) {
      reply =
        "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍";
    }

    return res.status(200).json({ reply });
  } catch (err) {
    // Catch-all: still returns JSON WITH CORS headers already set at top
    console.error("❌ Server crash:", err);
    return res.status(500).json({ reply: "Server error", error: err.message });
  }
}

// ---------------- helpers ----------------

function countMatches(messages, predicateFn) {
  return messages.filter((m) => m.role === "assistant" && predicateFn(m.content || "")).length;
}

function isContactAsk(text) {
  return /(first name|your name|phone number|best number|callback number|email address|contact info|how can we reach you)/i.test(
    text
  );
}

function isAddressAsk(text) {
  return /(delivery address|drop.?off address|what.?s the address|jobsite address|where should we deliver|delivery location|address\?)/i.test(
    text
  );
}

function ensureBookingLink(reply) {
  if (/<https?:\/\/[^>]+>/.test(reply)) return reply;

  const t = reply.toLowerCase();
  let link = "https://www.littlejunkersllc.com/shop";

  if (t.includes("big junker") || /\b21\b/.test(t))
    link = "https://www.littlejunkersllc.com/shop/the-big-junker-21-yard-dumpster-46";
  else if (t.includes("mighty middler") || /\b16\b/.test(t))
    link = "https://www.littlejunkersllc.com/shop/the-mighty-middler-16-yard-dumpster-4";
  else if (t.includes("little junker") || /\b11\b/.test(t))
    link = "https://www.littlejunkersllc.com/shop/the-little-junker-11-yard-dumpster-60";

  return reply + `\n\nYou can book here: <${link}>`;
}

async function extractLeadInfoWithAI(messages, allUserText) {
  try {
    const prompt = `Return ONLY valid JSON:
{"name":"Customer full name","phone":"XXX-XXX-XXXX","email":"Email","address":"Full address","confidence":"high/medium/low"}
Use "Not provided" if missing.`;

    const userOnly = messages
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
          { role: "system", content: prompt },
          { role: "user", content: userOnly },
        ],
      }),
    });

    const data = await safeJson(r);
    if (!r.ok) return regexFallbackExtraction(allUserText);

    const raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    return validateAndEnhanceExtraction(JSON.parse(cleaned), allUserText);
  } catch {
    return regexFallbackExtraction(allUserText);
  }
}

function regexFallbackExtraction(allUserText) {
  const phone = allUserText.match(/(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/);
  const email = allUserText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);

  return {
    name: "Not provided",
    phone: phone ? `${phone[1]}-${phone[2]}-${phone[3]}` : "Not provided",
    email: email ? email[0] : "Not provided",
    address: "Not provided",
    confidence: "low",
  };
}

function validateAndEnhanceExtraction(extracted, allUserText) {
  const v = { ...extracted };

  if (v.phone && v.phone !== "Not provided" && !/^\d{3}-\d{3}-\d{4}$/.test(v.phone)) {
    const m = String(v.phone).match(/(\d{3})\D*(\d{3})\D*(\d{4})/);
    if (m) v.phone = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return v;
}

function isEmailLike(s) {
  return typeof s === "string" && /\S+@\S+\.\S+/.test(s);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHistory(messages) {
  const MAX = 80;
  return messages
    .slice(-MAX)
    .map((m) => `${m.role === "assistant" ? "Randy" : "Customer"}: ${m.content || ""}`)
    .join("\n\n");
}

function inferRecommendedDumpster(historyLower) {
  if (historyLower.includes("mighty middler") || /\b16\b/.test(historyLower)) return "16-yard Mighty Middler";
  if (historyLower.includes("big junker") || /\b21\b/.test(historyLower)) return "21-yard Big Junker";
  if (historyLower.includes("little junker") || /\b11\b/.test(historyLower)) return "11-yard Little Junker";
  return "Not yet determined";
}

async function sendLeadEmailSafe({ name, phone, email, address, messages, lastReply }) {
  try {
    const from = process.env.EMAIL_FROM || "Little Junkers <noreply@littlejunkersllc.com>";
    const to = process.env.ODOO_CRM_ALIAS || "crm-sales-channel@littlejunkersllc.odoo.com";

    if (!isEmailLike(from.match(/<([^>]+)>/)?.[1] || from)) {
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
      <hr />
      <h3>Conversation History:</h3>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
        historyRaw
      )}</pre>
      <hr />
      <p style="color:#666;font-size:12px;">Lead automatically captured by Randy.</p>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
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
    console.error("❌ Lead email send crash:", err);
    return false;
  }
}

async function sendEscalationEmailSafe({ name, phone, issue, messages }) {
  try {
    const from = process.env.EMAIL_FROM || "Little Junkers <noreply@littlejunkersllc.com>";
    const to = process.env.EMAIL_TO || "customer_service@littlejunkersllc.com";

    if (!isEmailLike(from.match(/<([^>]+)>/)?.[1] || from)) {
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
      <hr />
      <h3>Conversation History:</h3>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
        historyRaw
      )}</pre>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
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
    console.error("❌ Escalation email send crash:", err);
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
