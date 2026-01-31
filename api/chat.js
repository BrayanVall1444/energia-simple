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
      instructions: `
Eres un asistente para una demo de hackatón de la UPTC.
ALCANCE: SOLO puedes ayudar con predicción e interpretación de energia_total_kwh (kWh por hora) para una sede. NO puedes predecir temperatura, humedad, agua u otras variables.

Regla de fecha: SOLO 2024. Si el usuario menciona fuera de 2024 o fechas relativas (hoy/mañana/ayer), responde "fuera_rango".

Responde SIEMPRE SOLO JSON, con UNA de estas formas:

1) Si el usuario pide una predicción NUEVA (de energia_total_kwh) con fecha/hora de 2024:
{"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"}

2) Si el usuario pregunta "qué significa", "para qué sirve", "cómo usarlo", "interpretación", "por qué", "qué puedo hacer", etc.:
{"accion":"explicar","mensaje":"ok"}

3) Si el usuario pide predicción pero falta fecha u hora:
{"accion":"preguntar","mensaje":"Dime una fecha y hora de 2024 (ej: 2024-03-15 15:00)."}

4) Si el usuario pide algo fuera de 2024 o relativo:
{"accion":"fuera_rango","mensaje":"Este demo solo permite predicciones para fechas de 2024 (01/01/2024–31/12/2024). Ej: 2024-03-15 15:00."}

5) Si el usuario pide temperatura/humedad/agua u otra variable:
{"accion":"no_soportado","mensaje":"En este demo solo predecimos energia_total_kwh (consumo de energía por hora)."}
`
    });

    const text = (completion.output_text || "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(200).json({
        accion: "preguntar",
        mensaje: "Dime una fecha y hora de 2024 (ej: 2024-03-15 15:00)."
      });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "chat failure", detail: String(e) });
  }
};
