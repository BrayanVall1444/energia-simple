import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    console.log("CHAT_METHOD", req.method);
    console.log("HAS_KEY", Boolean(process.env.OPENAI_API_KEY));

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const messages = req.body?.messages;
    console.log("BODY_KEYS", Object.keys(req.body || {}));
    console.log("MESSAGES_LEN", Array.isArray(messages) ? messages.length : null);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
      instructions: `Responde SOLO JSON: {"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"} o {"accion":"preguntar","mensaje":"..."}.`
    });

    const text = (completion.output_text || "").trim();
    console.log("OUTPUT_TEXT", text);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(200).json({ accion: "preguntar", mensaje: "Indica fecha y hora de 2024 (ej: 2024-03-15 15:00)." });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    console.log("CHAT_ERROR", String(e));
    console.log("CHAT_STACK", e?.stack || "");
    res.status(500).json({ error: "chat failure", detail: String(e), hasKey: Boolean(process.env.OPENAI_API_KEY) });
  }
}
