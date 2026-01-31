const API_PREDICT = "/api/predict";
const CHAT_API = "/api/chat";

const SEDE = "UPTC_CHI";
const TARGET = "energia_total_kwh";
const SEDES = ["UPTC_CHI", "UPTC_TUN", "UPTC_DUI", "UPTC_SOG"];
const SHORT_W = 48;
const LONG_W = 168;

let df_s = null;
let cols_full = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function tsToKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00:00`;
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const k = headers[j];
      const v = cols[j];
      const num = Number(v);
      obj[k] = Number.isFinite(num) ? num : v;
    }
    rows.push(obj);
  }
  return { headers, rows };
}

function buildDfS(parsed) {
  const rows = parsed.rows
    .filter(r => r[SEDE] === 1)
    .map(r => {
      const o = { ...r };
      SEDES.forEach(s => { if (s in o) delete o[s]; });
      return o;
    })
    .filter(r => r.timestamp)
    .map(r => ({
      ...r,
      _ts: new Date(String(r.timestamp).replace(" ", "T") + "Z")
    }))
    .sort((a, b) => a._ts - b._ts);

  const t = rows.map(r => new Date(r._ts.getTime() - r._ts.getTimezoneOffset() * 60000));
  rows.forEach((r, i) => r._ts_local = t[i]);
  return rows;
}

function makeIndex(dfRows) {
  const idx = new Map();
  for (let i = 0; i < dfRows.length; i++) {
    idx.set(tsToKey(dfRows[i]._ts_local), i);
  }
  return idx;
}

function toRecord(r, cols) {
  const o = {};
  for (const c of cols) o[c] = r[c];
  return o;
}

function checkConsecutive(dfRows, startIdx, endIdx) {
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const prev = dfRows[i - 1]._ts_local;
    const cur = dfRows[i]._ts_local;
    if ((cur - prev) / 3600000 !== 1) return false;
  }
  return true;
}

async function loadDataset() {
  const r = await fetch("dataset_listoParaRedNeuronal3.csv");
  const text = await r.text();
  const parsed = parseCSV(text);
  df_s = buildDfS(parsed);

  const allCols = parsed.headers.filter(c => c !== "timestamp" && !SEDES.includes(c));
  const X_cols = allCols.filter(c => c !== TARGET);
  cols_full = [TARGET, ...X_cols];
}

async function callPredict(ts) {
  if (!df_s || !cols_full) throw new Error("Dataset no cargado");
  if (ts.getFullYear() !== 2024) throw new Error("Solo se permiten fechas de 2024");

  const idxMap = makeIndex(df_s);
  const key = tsToKey(ts);

  if (!idxMap.has(key)) throw new Error(`No existe timestamp exacto: ${key}`);

  const pos_t = idxMap.get(key);

  if (pos_t < LONG_W) throw new Error("Histórico insuficiente para long_window");
  if (pos_t - 24 < 0 || pos_t - 168 < 0) throw new Error("Histórico insuficiente para lags");
  if (!checkConsecutive(df_s, pos_t - LONG_W, pos_t)) throw new Error("Histórico no consecutivo");

  const sample_short = df_s.slice(pos_t - SHORT_W, pos_t).map(r => toRecord(r, cols_full));
  const sample_long = df_s.slice(pos_t - LONG_W, pos_t).map(r => toRecord(r, cols_full));

  const lag_24 = Number(df_s[pos_t - 24][TARGET]);
  const lag_168 = Number(df_s[pos_t - 168][TARGET]);

  const payload = {
    short_window: sample_short,
    long_window: sample_long,
    lags: [lag_24, lag_168],
    sede: SEDE,
    target_timestamp: key
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 180000);

  let res;
  try {
    res = await fetch(API_PREDICT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  if (!res.ok) throw new Error(raw);
  return JSON.parse(raw);
}

function getHistory() {
  return JSON.parse(sessionStorage.getItem("chatHistory") || "[]");
}

function setHistory(h) {
  sessionStorage.setItem("chatHistory", JSON.stringify(h));
}

function append(role, text) {
  const log = document.getElementById("chatLog");
  const div = document.createElement("div");
  div.textContent = (role === "user" ? "Tú: " : "IA: ") + text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function getLastPred() {
  return JSON.parse(sessionStorage.getItem("lastPred") || "null");
}

function setLastPred(obj) {
  sessionStorage.setItem("lastPred", JSON.stringify(obj));
}

function explainFromLastPred(lp) {
  const v = Number(lp.prediccion_kwh);
  const sede = lp.sede;
  const ts = lp.timestamp;

  let nivel = "moderado";
  if (v < 0.8) nivel = "bajo";
  if (v > 1.6) nivel = "alto";

  return `Significa que, para ${sede} en ${ts}, el consumo esperado durante esa hora es ~${v.toFixed(3)} kWh. Es un nivel ${nivel}. Esto sirve para anticipar picos, comparar con el consumo real y detectar desviaciones (por ejemplo, equipos encendidos fuera de horario). ¿Quieres que prediga otra hora para comparar?`;
}

async function sendChat(text) {
  const history = getHistory();
  history.push({ role: "user", content: text });

  const res = await fetch(CHAT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history })
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(raw);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Respuesta no-JSON: " + raw);
  }

  if (data.accion === "preguntar") {
    const reply = data.mensaje || "Dime una fecha y hora de 2024 (ej: 2024-03-15 15:00).";
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "fuera_rango") {
    const reply = data.mensaje || "Este demo solo permite predicciones para fechas de 2024 (01/01/2024–31/12/2024). Ej: 2024-03-15 15:00.";
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "no_soportado") {
    const reply = data.mensaje || "En este demo solo predecimos energia_total_kwh (consumo de energía por hora).";
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "explicar") {
    const lp = getLastPred();
    const reply = lp
      ? explainFromLastPred(lp)
      : "Primero pídeme una predicción de 2024 (ej: 2024-02-15 15:00) y luego te explico qué significa.";
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "predecir") {
    const ts = new Date(`${data.fecha}T${pad2(data.hora)}:00:00`);
    const pred = await callPredict(ts);

    const timestamp = `${data.fecha} ${pad2(data.hora)}:00:00`;
    setLastPred({ sede: data.sede || SEDE, timestamp, prediccion_kwh: pred.prediccion_kwh });

    const reply = `Para ${data.fecha} a las ${pad2(data.hora)}:00 en ${data.sede || SEDE}, la predicción es ${pred.prediccion_kwh} kWh.`;
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  const fallback = "No entendí. Prueba: 'Predice 2024-02-15 15:00' o '¿Qué significa esa predicción?'.";
  history.push({ role: "assistant", content: fallback });
  setHistory(history);
  return fallback;
}

document.getElementById("chatSend").addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  append("user", text);

  try {
    const reply = await sendChat(text);
    append("assistant", reply);
  } catch (e) {
    append("assistant", "Error al procesar la consulta");
  }
});

document.getElementById("chatInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  append("user", text);

  try {
    const reply = await sendChat(text);
    append("assistant", reply);
  } catch (err) {
    append("assistant", "Error al procesar la consulta");
  }
});

fetch("predicciones.csv")
  .then(r => r.text())
  .then(text => {
    const lines = text.trim().split("\n");
    const h = lines[0].split(",");
    const t = h.indexOf("timestamp");
    const r = h.indexOf("real_kwh");
    const p = h.indexOf("pred_kwh");

    const labels = [];
    const real = [];
    const pred = [];

    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      labels.push(c[t]);
      real.push(+c[r]);
      pred.push(+c[p]);
    }

    new Chart(document.getElementById("chart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Real", data: real, borderWidth: 2 },
          { label: "Predicho", data: pred, borderDash: [5, 5], borderWidth: 2 }
        ]
      },
      options: { responsive: true }
    });
  });

(async function main() {
  await loadDataset();
})();
