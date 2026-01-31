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
Extrae una fecha y hora de 2024.
Si el usuario pide predicción, responde SOLO en JSON así:
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
    res.status(200).json({ reply: "Indica una fecha y hora de 2024 para predecir." });
    return;
  }

  if (parsed.accion !== "predecir") {
    res.status(200).json({ reply: parsed.mensaje });
    return;
  }

  const ts = `${parsed.fecha} ${String(parsed.hora).padStart(2,"0")}:00:00`;

  const predictRes = await fetch(`https://${req.headers.host}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sede: parsed.sede, target_timestamp: ts })
  });

  const pred = await predictRes.json();

  res.status(200).json({
    reply: `Para ${parsed.fecha} a las ${parsed.hora}:00 en ${parsed.sede}, la predicción es ${pred.prediccion_kwh} kWh.`
  });
}
