export default async function handler(req, res) {
  try {
    const body = await req.json?.() || req.body;
    const messages = body.messages || [];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-turbo",
        messages,
        temperature: 0.7
      })
    });

    const data = await response.json();

    const reply = data.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
    res.status(200).json({ reply });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ reply: "There was a connection problem. Please try again later." });
  }
}
