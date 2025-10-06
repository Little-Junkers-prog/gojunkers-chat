// api/chat.js
import OpenAI from "openai";

// Initialize the client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Vercel handler
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { messages } = req.body;

    // ✅ Handle empty or invalid body
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        reply: "Error: Missing or invalid 'messages' array in request body.",
      });
    }

    // ✅ Generate a response from GPT
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = completion.choices[0].message.content;
    res.status(200).json({ reply });
  } catch (error) {
    console.error("Chat API error:", error);
    res
      .status(500)
      .json({ reply: "There was a connection issue. Please try again later." });
  }
}
