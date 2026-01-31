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
Eres un asistente para una demo de hackatón UPTC.
Puedes:
- Interpretar y explicar predicciones de energia_total_kwh (kWh por hora).
- Explicar para qué sirve la predicción y cómo usarla para eficiencia energética.
- Explicar reportes de ineficiencia (ocupación vs energía, kpi real vs esperado, acciones).

Restricción:
- La predicción SOLO se permite en 2024. Si el usuario pide predicción fuera de 2024 o con "hoy/mañana/ayer", devuelve fuera_rango.

Responde SOLO JSON con una de estas formas:

1) Predicción solicitada (solo 2024):
{"accion":"predecir","fecha":"YYYY-MM-DD","hora":HH,"sede":"UPTC_CHI"}

2) Pregunta de explicación/interpretación/uso/recomendaciones/ineficiencias:
{"accion":"explicar","mensaje":"<respuesta breve, útil y accionable>"}

3) Falta fecha u hora para predicción:
{"accion":"preguntar","mensaje":"Dime una fecha y hora de 2024 (ej: 2024-03-15 15:00)."}

4) Fuera de rango:
{"accion":"fuera_rango","mensaje":"Este demo solo permite predicciones para fechas de 2024 (01/01/2024–31/12/2024). Ej: 2024-03-15 15:00."}
`
    });

    const text = (completion.output_text || "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(200).json({
        accion: "explicar",
        mensaje: "Puedo predecir energia_total_kwh por hora (solo 2024) y explicar cómo usarlo para eficiencia. Ej: “Predice 2024-02-15 15:00”."
      });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "chat failure", detail: String(e) });
  }
};
