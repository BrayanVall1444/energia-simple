import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    console.log("=== /api/chat CALLED ===");
    console.log("BODY:", JSON.stringify(req.body));

    if (req.method !== "POST") {
      console.log("INVALID METHOD");
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const messages = req.body.messages;
    if (!messages) {
      console.log("NO MESSAGES");
      res.status(400).json({ error: "No messages" });
      return;
    }

    console.log("MESSAGES:", messages);

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
      instructions: `
Extrae intención.
Si hay fecha/hora de 2024 responde SOLO JSON:
{"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"}
Si falta algo:
{"accion":"preguntar","mensaje":"..."}
`
    });

    console.log("RAW OPENAI RESPONSE:", JSON.stringify(completion));

    const text = completion.output_text;
    console.log("OUTPUT_TEXT:", text);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.log("JSON PARSE ERROR:", e);
      res.status(200).json({
        accion: "preguntar",
        mensaje: "No entendí la fecha/hora. Usa formato 2024-03-15 15:00."
      });
      return;
    }

    console.log("PARSED:", parsed);
    res.status(200).json(parsed);

  } catch (err) {
    console.error("FATAL /api/chat ERROR:", err);
    res.status(500).json({ error: "chat failure", detail: String(err) });
  }
}
