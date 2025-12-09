export default async function handler(req, res) {
    // --- CORS and Method Handlers (RETAINED) ---
    // The original code handled multiple origins, using a broader check than the single line below. 
    // We are reverting to the safer, robust check from your original architecture.
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
        // Only allow if no origin header is present (e.g., direct API test)
        res.setHeader("Access-Control-Allow-Origin", "null"); 
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

        // 🛡️ Input size control - prevent token overflow
        const MAX_MESSAGES = 50;
        if (messages.length > MAX_MESSAGES) {
            const systemMessages = messages.filter(m => m.role === "system");
            const recentMessages = messages.filter(m => m.role !== "system").slice(-30);
            messages = [...systemMessages, ...recentMessages];
            console.log(`⚠️ Message history trimmed to prevent overflow`);
        }

        // ---------- LEAD CAPTURE HELPERS ----------
        const getAllUserText = (msgs) =>
            msgs.filter((m) => m.role === "user").map((m) => m.content || "").join(" ");

        const lastUserMessage = (messages[messages.length - 1]?.role === "user"
            ? messages[messages.length - 1]?.content
            : "")?.trim() || "";

        const allUserText = getAllUserText(messages);

        // Regex helpers for data extraction
        const unsafePatterns = /\b(stupid|dumb|idiot|fucked?|fucking|shit|bitch|damn|hell)\b/i;
        const extremeUnsafePatterns = /\b(kill|murder|suicide|terrorist|bomb|weapon|rape|molest)\b/i;
        const nameRegex = /\b(?!yard|dumpster|atlanta|peachtree|fairburn|fayetteville|newnan|tyrone|need|want|help|rental|rent|delivery|hi|hey|hello|thanks|thank|yes|no|ok|okay)([A-Z][a-z]{1,})\b/i;
        const phoneRegex = /(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})/;
        const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
        const addressRegex = /\d{1,5}\s[A-Za-z0-9\s,.#-]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Trail|Way|Blvd|Boulevard|Place|Pl|Parkway|Pkwy)\b/i;

        const hasName = nameRegex.test(allUserText);
        const hasNumber = phoneRegex.test(allUserText);
        const hasEmail = emailRegex.test(allUserText);
        const hasAddress = addressRegex.test(allUserText);
        const hasMinimumInfo = hasName && (hasNumber || hasEmail);

        const nameMatch = allUserText.match(nameRegex);
        const phoneMatch = allUserText.match(phoneRegex);
        const emailMatch = allUserText.match(emailRegex);
        const addressMatch = allUserText.match(addressRegex);

        const formatPhone = (m) => (m ? `${m[1]}-${m[2]}-${m[3]}` : "Not provided");
        // End of chat helpers
        const endOfChatSignals =
            /^(thanks|thank you|bye|goodbye|ok|okay|perfect|sounds good|great|got it|that's all|all set|done)$/i;
        const isEndingChat = endOfChatSignals.test(lastUserMessage) && hasMinimumInfo;
        
        // Assistant asked-for-contact counters
        const askedForContactCount = messages.filter( (m) => m.role === "assistant" && /what.?s your (name|phone|number|email|contact)/i.test(m.content || "") ).length;
        const askedForAddressEmailCount = messages.filter( (m) => m.role === "assistant" && /(delivery address|address|drop.?off address|email)/i.test(m.content || "") ).length;
        const escalationIntent =
            /(speak.*human|talk.*person|talk.*someone|manager|supervisor|can't help|not helping|frustrated|angry|ridiculous|unacceptable|terrible service)/i.test(
                lastUserMessage
            );
        const hasBereavementCue =
            /(my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse|wife|husband)) (just )?(passed|died)|lost my (dad|mom|father|mother|grandma|grandpa|grandmother|grandfather|parent|spouse)|bereavement|estate cleanout|death in (the )?family/i.test(
                lastUserMessage
            );

        // Immediate blocks (Security & Profanity)
        if (extremeUnsafePatterns.test(lastUserMessage)) {
            return res.status(200).json({ reply: "I'm ending this chat now. Please call us at 470-548-4733 if you need assistance. Take care." });
        }
        const profanityCount = messages.filter( (m) => m.role === "user" && unsafePatterns.test(m.content || "") ).length;
        if (profanityCount >= 2) {
            return res.status(200).json({ reply: "I'm going to end this chat now. Please call us at 470-548-4733 if you'd like to rent a dumpster. Take care." });
        }
        if (unsafePatterns.test(lastUserMessage)) {
            return res.status(200).json({ reply: "I'm here to help with dumpster rentals and cleanup services. Let's stay on topic 👍" });
        }
        // ---------- END LEAD CAPTURE HELPERS ----------

        // --- Lead Capture on Close Event (Odoo API) ---
        if (event === "chatClosed" && hasMinimumInfo) {
            console.log("📧 Chat closed - sending lead to Odoo CRM via API");
            await sendLeadToOdooCRM(
                nameMatch?.[0] || "Unknown",
                hasNumber ? formatPhone(phoneMatch) : "Not provided",
                hasEmail ? emailMatch?.[0] : "Not provided",
                hasAddress ? addressMatch?.[0] : "Not provided",
                messages,
                "Chat closed event"
            );
            return res.status(200).json({ reply: "Chat closed, lead captured." });
        }

        // --- Escalation logic ---
        if (escalationIntent) {
            if (hasNumber) {
                await sendEscalationEmail(nameMatch?.[0] || "Customer", formatPhone(phoneMatch), lastUserMessage, messages);
                return res.status(200).json({
                    reply: `I completely understand — let me have one of our team members give you a call at ${formatPhone(
                        phoneMatch
                    )}. They'll be able to help you better. Someone will reach out within the next few hours during business hours. Thanks for your patience! 👍`,
                });
            } else {
                 if (askedForContactCount >= 1) { 
                    return res.status(200).json({ reply: "I'd be happy to connect you with someone from our team. To do that, I'll need a phone number for them to call you back. Or you can call us directly at 470-548-4733." });
                 }
                 return res.status(200).json({ reply: "I understand — let me connect you with someone from our team. What's the best phone number for a callback?" });
            }
        }

        // -------- SYSTEM PROMPT (The Sales Pitch) --------
        const systemPrompt = `
You are "Randy Miller," the friendly, helpful assistant for Little Junkers — a local dumpster rental service.
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
- 21-yard: large renovations, roofing, construction - $325/2 days
`;

        // Anti-loop system nudges
        const antiLoopHints = [];
        if (askedForContactCount >= 2 && !hasMinimumInfo) {
            antiLoopHints.push({ role: "system", content: "You have already asked for contact information twice and the user has refused. DO NOT ask again. Politely direct them to <https://www.littlejunkersllc.com/shop> or 470-548-4733 and close. Do NOT say 'someone will follow up' since you have no contact info." });
        }
        if (hasMinimumInfo && askedForAddressEmailCount >= 1) {
            antiLoopHints.push({ role: "system", content: "You have name + phone/email. You have already asked for address/email once after capturing contact. Do not ask again; proceed to close politely." });
        }
        if (hasMinimumInfo && (!hasAddress || !hasEmail) && askedForAddressEmailCount === 0) {
            antiLoopHints.push({ role: "system", content: "You have name + phone/email. You may ask ONCE (politely) for delivery address if helpful, then proceed to answer questions or close." });
        }
        if (isEndingChat) {
            antiLoopHints.push({ role: "system", content: "User signaled the chat is done. Thank them, confirm someone will reach out shortly, and close politely." });
        }
        if (hasBereavementCue) {
            antiLoopHints.push({ role: "system", content: "Begin with a brief, sincere condolence (one sentence) before continuing with helpful guidance about their estate/cleanout needs." });
        }

        // -------- OpenAI Call --------
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

        let reply =
            data.choices?.[0]?.message?.content?.trim() ||
            "Sorry, I didn't catch that. Could you rephrase?";

        // Wrap URLs in < >
        reply = reply.replace(/(https?:\/\/[^\s<>]+)/g, "<$1>");

        // ---- Lead capture triggers (Odoo API) ----
        const leadAlreadySignaled = messages.some(
            (m) =>
                m.role === "assistant" &&
                /i'?ve got everything i need|we'll reach out shortly|thanks for choosing little junkers/i.test(
                    m.content || ""
                )
        );

        if (isEndingChat && hasMinimumInfo && !leadAlreadySignaled) {
            console.log("📧 Lead capture triggered: Sending to Odoo CRM via API");
            
            const leadSent = await sendLeadToOdooCRM(
                nameMatch?.[0] || "Unknown",
                hasNumber ? formatPhone(phoneMatch) : "Not provided",
                hasEmail ? emailMatch?.[0] : "Not provided",
                hasAddress ? addressMatch?.[0] : "Not provided",
                messages,
                reply
            );
            
            if (leadSent) {
                reply = "Perfect! 👍 I've got everything I need. Someone from our team will reach out shortly to confirm your dumpster delivery. Thanks for choosing Little Junkers!";
            } else {
                reply = "Thanks! I've saved your info, though we're having a small technical hiccup on our end. No worries — someone from our team will still reach out to you shortly! 👍";
            }
        }

        // If user refuses contact info twice and we don't have minimum info → correct close
        if (askedForContactCount >= 2 && !hasMinimumInfo) {
            reply = "No problem — I completely understand! You can book directly here anytime: <https://www.littlejunkersllc.com/shop> or call us at 470-548-4733. 👍";
        }

        return res.status(200).json({ reply });
    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ reply: "Server error", error: err.message });
    }
}

// ---------------- LEAD HELPER FUNCTIONS (ODOO API IMPLEMENTATION) ----------------

/**
 * Helper to get the Odoo base URL (e.g., https://yourdomain.odoo.com)
 */
function getOdooApiUrl() {
    const baseUrl = process.env.ODOO_BASE_URL;
    if (!baseUrl) {
        console.error("❌ ODOO_BASE_URL environment variable is not set.");
        return null;
    }
    return `${baseUrl.replace(/\/$/, '')}/xmlrpc/2/object`;
}


/**
 * Sends lead data to Odoo CRM using the XML-RPC API.
 */
async function sendLeadToOdooCRM(name, phone, email, address, messages, lastReply) {
    const ODOO_API_URL = getOdooApiUrl();
    if (!ODOO_API_URL) return false;

    // Credentials required for Odoo API Key authentication
    const ODOO_DB = process.env.ODOO_DB_NAME;
    const ODOO_UID = process.env.ODOO_USER_ID;
    const ODOO_API_KEY = process.env.ODOO_API_KEY;

    if (!ODOO_DB || !ODOO_UID || !ODOO_API_KEY) {
        console.error("❌ Odoo credentials (DB, UID, API_KEY) are missing in environment variables. Falling back to email.");
        await sendLeadEmailFallback(name, phone, email, address, messages); // Use fallback
        return false;
    }

    // Simple inference from conversation text
    let recommendedDumpster = "Not yet determined";
    const text = messages.map(m => m.content).join(" ").toLowerCase();
    if (text.includes("mighty middler") || /\b16\b/.test(text)) {
        recommendedDumpster = "16-yard Mighty Middler";
    } else if (text.includes("big junker") || /\b21\b/.test(text)) {
        recommendedDumpster = "21-yard Big Junker";
    } else if (text.includes("little junker") || /\b11\b/.test(text)) {
        recommendedDumpster = "11-yard Little Junker";
    }
    
    const leadDescription = `
Source: Randy Chatbot (Proactive Lead)
Recommended Size: ${recommendedDumpster}
Delivery Address: ${address}

--- CHAT TRANSCRIPT ---
${messages.map(m => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`).join("\n")}
`;

    // Data payload for Odoo crm.lead model
    const payload = {
        params: {
            model: 'crm.lead',
            method: 'create',
            args: [[{
                name: `Chat Lead: ${name} - ${recommendedDumpster}`,
                contact_name: name,
                phone: phone,
                email_from: email,
                description: leadDescription,
                type: 'lead', // Create as a Lead in Odoo
                source_id: 1, // Placeholder: map to a custom Odoo "Source" record if you have one setup for 'Chatbot'
            }]],
            kwargs: {},
            // Authentication details for Odoo
            db: ODOO_DB,
            uid: parseInt(ODOO_UID), // User ID must be an integer
            password: ODOO_API_KEY // API Key is used as the password
        }
    };

    try {
        const response = await fetch(ODOO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json();
        
        if (result.error) {
            console.error("❌ Odoo API Error creating lead:", result.error);
            await sendLeadEmailFallback(name, phone, email, address, messages); // Use fallback on Odoo error
            return false;
        }

        console.log("✅ Lead successfully created in Odoo CRM (ID:", result.result, ")");
        return true;

    } catch (error) {
        console.error("❌ Network error sending lead to Odoo:", error);
        await sendLeadEmailFallback(name, phone, email, address, messages); // Use fallback on network error
        return false;
    }
}

// ---------------- FALLBACK EMAIL FUNCTIONS ----------------

/**
 * Temporary fallback using Resend logic to ensure the lead is still captured via email when Odoo fails.
 */
async function sendLeadEmailFallback(name, phone, email, address, messages) {
    try {
        const history = messages
            .map((m) => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
            .join("\n\n");

        const displayName = (name || "Customer").split(" ")[0];

        let recommendedDumpster = "Not yet determined";
        const text = history.toLowerCase();
        if (text.includes("mighty middler") || /\b16\b/.test(text)) {
            recommendedDumpster = "16-yard Mighty Middler";
        } else if (text.includes("big junker") || /\b21\b/.test(text)) {
            recommendedDumpster = "21-yard Big Junker";
        } else if (text.includes("little junker") || /\b11\b/.test(text)) {
            recommendedDumpster = "11-yard Little Junker";
        }

        const emailBody = {
            from: process.env.EMAIL_FROM || "noreply@littlejunkersllc.com",
            to: process.env.EMAIL_TO || "customer_service@littlejunkersllc.com",
            subject: `🎯 New Lead (FALLBACK): ${displayName} - ${phone}`,
            html: `
                <h2>New Lead Captured from Randy Chat (Fallback Email) 🎉</h2>
                <p><strong>Name:</strong> ${displayName}</p>
                <p><strong>Phone:</strong> ${phone}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Address:</strong> ${address}</p>
                <p><strong>Recommended Dumpster:</strong> ${recommendedDumpster}</p>
                <hr>
                <h3>Full Conversation:</h3>
                <pre style="background:#f5f5f5;padding:15px;border-radius:5px;white-space:pre-wrap;">${history}</pre>
                <hr>
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

        return r.ok;

    } catch (err) {
        console.error("❌ Error sending fallback lead email:", err);
        return false;
    }
}
async function sendEscalationEmail(name, phone, issue, messages) {
    // Immediate email alert for escalations is critical.
    try {
        const history = messages
            .map((m) => `${m.role === "user" ? "Customer" : "Randy"}: ${m.content}`)
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
                <p style="background:#fff3cd;padding:10px;border-left:4px solid #ffc107;">
                    <strong>Action Required:</strong> Please call the customer back within business hours.
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

        return r.ok;
    } catch (err) {
        console.error("❌ Error sending escalation email:", err);
        return false;
    }
}
