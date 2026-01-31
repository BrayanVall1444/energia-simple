const OpenAI = require("openai").default;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const messages = req.body && req.body.messages;
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: "Missing messages" });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: "Missing OPENAI_API_KEY" });
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
      instructions: `Responde SOLO JSON: {"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"} o {"accion":"preguntar","mensaje":"..."}.`
    });

    const text = (completion.output_text || "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(200).json({ accion: "preguntar", mensaje: "Indica fecha y hora de 2024 (ej: 2024-03-15 15:00)." });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "chat failure", detail: String(e) });
  }
};
