const API_URL = "/api/predict";
const SEDE = "UPTC_CHI";
const TARGET = "energia_total_kwh";
const SEDES = ["UPTC_CHI", "UPTC_TUN", "UPTC_DUI", "UPTC_SOG"];
const SHORT_W = 48;
const LONG_W = 168;

let df_s = null;
let cols_full = null;

function setStatus(msg) {
  document.getElementById("status").textContent = msg || "";
}

function setResult(msg) {
  document.getElementById("result").textContent = msg || "";
}

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

  const t = rows.map(r => new Date(r._ts.getTime() - (r._ts.getTimezoneOffset() * 60000)));
  rows.forEach((r, i) => { r._ts_local = t[i]; });

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
  const obj = {};
  for (const c of cols) obj[c] = r[c];
  return obj;
}

function checkConsecutive(dfRows, startIdx, endIdx) {
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const prev = dfRows[i - 1]._ts_local;
    const cur = dfRows[i]._ts_local;
    const diffH = (cur - prev) / 3600000;
    if (diffH !== 1) return false;
  }
  return true;
}

async function loadDataset() {
  setStatus("Cargando dataset_listoParaRedNeuronal3.csv ...");
  const r = await fetch("dataset_listoParaRedNeuronal3.csv");
  const text = await r.text();
  const parsed = parseCSV(text);
  df_s = buildDfS(parsed);

  const allCols = parsed.headers.filter(c => c !== "timestamp" && !SEDES.includes(c));
  const X_cols = allCols.filter(c => c !== TARGET);
  cols_full = [TARGET, ...X_cols];

  setStatus(`Dataset cargado: ${df_s.length} filas (${SEDE})`);
}

function initHourSelect() {
  const sel = document.getElementById("hourInput");
  sel.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = `${pad2(h)}:00`;
    sel.appendChild(opt);
  }
  sel.value = "17";
}

async function callPredict(ts) {
  if (!df_s || !cols_full) throw new Error("Dataset no cargado");
  if (ts.getFullYear() !== 2024) throw new Error("Solo se permiten fechas de 2024");

  const idxMap = makeIndex(df_s);
  const key = tsToKey(ts);
  if (!idxMap.has(key)) throw new Error(`No existe timestamp exacto en dataset: ${key}`);

  const pos_t = idxMap.get(key);

  if (pos_t < LONG_W) throw new Error("Histórico insuficiente para long_window");
  if (pos_t - 24 < 0 || pos_t - 168 < 0) throw new Error("Histórico insuficiente para lags");

  const startLong = pos_t - LONG_W;
  const endLong = pos_t - 1;

  const startShort = pos_t - SHORT_W;
  const endShort = pos_t - 1;

  if (!checkConsecutive(df_s, startLong, pos_t)) throw new Error("Histórico no consecutivo hora a hora");

  const sample_short = df_s.slice(startShort, endShort + 1).map(r => toRecord(r, cols_full));
  const sample_long = df_s.slice(startLong, endLong + 1).map(r => toRecord(r, cols_full));

  const lag_24 = Number(df_s[pos_t - 24][TARGET]);
  const lag_168 = Number(df_s[pos_t - 168][TARGET]);

  const payload = {
    short_window: sample_short,
    long_window: sample_long,
    lags: [lag_24, lag_168],
    sede: SEDE,
    target_timestamp: key
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || JSON.stringify(data));
  return data;
}

function setupPredictButton() {
  document.getElementById("btnPredict").addEventListener("click", async () => {
    setResult("");
    try {
      setStatus("Preparando payload y llamando a Render...");
      const dateStr = document.getElementById("dateInput").value;
      const hour = Number(document.getElementById("hourInput").value);

      const ts = new Date(`${dateStr}T${pad2(hour)}:00:00`);
      const out = await callPredict(ts);

      setStatus("OK");
      setResult(`Predicción: ${out.prediccion_kwh} kWh (sede: ${out.sede})`);
    } catch (e) {
      setStatus("Error");
      setResult(String(e.message || e));
    }
  });
}

function loadChart() {
  fetch("predicciones.csv")
    .then(r => r.text())
    .then(text => {
      const lines = text.trim().split("\n");
      const headers = lines[0].split(",");

      const tIdx = headers.indexOf("timestamp");
      const rIdx = headers.indexOf("real_kwh");
      const pIdx = headers.indexOf("pred_kwh");

      const labels = [];
      const real = [];
      const pred = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        labels.push(cols[tIdx]);
        real.push(parseFloat(cols[rIdx]));
        pred.push(parseFloat(cols[pIdx]));
      }

      const ctx = document.getElementById("chart").getContext("2d");

      new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            { label: "Real", data: real, borderWidth: 2 },
            { label: "Predicho", data: pred, borderDash: [5, 5], borderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: "index", intersect: false },
          scales: { x: { display: false } }
        }
      });
    });
}

(async function main() {
  initHourSelect();
  loadChart();
  await loadDataset();
  setupPredictButton();
})();
