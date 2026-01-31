import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const messages = req.body.messages;

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: messages,
    instructions: `
Extrae intención del usuario.
Si quiere predicción y tiene fecha/hora de 2024, responde SOLO este JSON:
{"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"}

Si falta información, responde:
{"accion":"preguntar","mensaje":"..."}
`
  });

  const text = completion.output_text.trim();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    res.status(200).json({
      accion: "preguntar",
      mensaje: "Indica una fecha y hora de 2024 (ej: 2024-02-15 15:00)."
    });
    return;
  }

  res.status(200).json(parsed);
}
