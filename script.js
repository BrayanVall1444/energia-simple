const API_PREDICT = "/api/predict";
const CHAT_API = "/api/chat";

const SEDE = "UPTC_CHI";
const TARGET = "energia_total_kwh";
const SEDES = ["UPTC_CHI", "UPTC_TUN", "UPTC_DUI", "UPTC_SOG"];
const SHORT_W = 48;
const LONG_W = 168;

let df_s = null;
let cols_full = null;

let chartMain = null;
let inefRows = [];
let selectedInef = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function tsToKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00:00`;
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg || "";
}

function setResult(msg) {
  const el = document.getElementById("result");
  if (el) el.textContent = msg || "";
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
  setStatus("Cargando dataset...");
  const r = await fetch("dataset_listoParaRedNeuronal3.csv");
  const text = await r.text();
  const parsed = parseCSV(text);
  df_s = buildDfS(parsed);

  const allCols = parsed.headers.filter(c => c !== "timestamp" && !SEDES.includes(c));
  const X_cols = allCols.filter(c => c !== TARGET);
  cols_full = [TARGET, ...X_cols];

  setStatus("Dataset listo");
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

function initHourSelect() {
  const sel = document.getElementById("hourInput");
  if (!sel) return;
  sel.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = `${pad2(h)}:00`;
    sel.appendChild(opt);
  }
  sel.value = "15";
}

function getHistory() {
  return JSON.parse(sessionStorage.getItem("chatHistory") || "[]");
}

function setHistory(h) {
  sessionStorage.setItem("chatHistory", JSON.stringify(h));
}

function clearChat() {
  sessionStorage.removeItem("chatHistory");
  sessionStorage.removeItem("lastPred");
  sessionStorage.removeItem("selectedInef");
}

function getLastPred() {
  return JSON.parse(sessionStorage.getItem("lastPred") || "null");
}

function setLastPred(obj) {
  sessionStorage.setItem("lastPred", JSON.stringify(obj));
}

function setSelectedInef(obj) {
  sessionStorage.setItem("selectedInef", JSON.stringify(obj));
}

function getSelectedInef() {
  return JSON.parse(sessionStorage.getItem("selectedInef") || "null");
}

function renderMessage(container, role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

function renderChatFromStorage() {
  const hist = getHistory();
  const c1 = document.getElementById("chatLog");
  const c2 = document.getElementById("chatLog2");
  if (c1) c1.innerHTML = "";
  if (c2) c2.innerHTML = "";
  for (const m of hist) {
    const role = m.role === "user" ? "user" : "assistant";
    if (c1) renderMessage(c1, role, m.content);
    if (c2) renderMessage(c2, role, m.content);
  }
}

function baseContextString() {
  return `
Contexto demo hackatón UPTC:
- Predicción disponible: SOLO energia_total_kwh (kWh por hora) para sede UPTC_CHI.
- Restricción: SOLO fechas de 2024 para predicción. Si piden fuera de 2024, explicar la limitación y pedir una fecha dentro de 2024.
- Puedes explicar qué significa kWh, para qué sirve la predicción, cómo se usa para eficiencia energética, y recomendaciones operativas.
- También puedes explicar reportes de ineficiencia del archivo df_resultado.csv (ocupación vs consumo, kpi eficiencia real vs esperada, ineficiencia_detectada).
Responde claro, breve, orientado a usuario y a decisiones.
`;
}

function makeSystemContextMessage() {
  const lp = getLastPred();
  const si = getSelectedInef();

  let extra = "";
  if (lp) {
    extra += `\nÚltima predicción disponible:\n- sede: ${lp.sede}\n- timestamp: ${lp.timestamp}\n- prediccion_kwh: ${lp.prediccion_kwh}\n`;
  }
  if (si) {
    extra += `\nEvento de ineficiencia seleccionado:\n- timestamp: ${si.timestamp}\n- instalacion: ${si.instalacion}\n- rank_gravedad: ${si.rank_gravedad}\n- error_reconstruccion: ${si.error_reconstruccion}\n- ocupacion_pct: ${si.ocupacion_pct}\n- energia_real_kwh: ${si.energia_real_kwh}\n- kpi_eficiencia_real: ${si.kpi_eficiencia_real}\n- kpi_eficiencia_esperada: ${si.kpi_eficiencia_esperada}\n- ineficiencia_detectada: ${si.ineficiencia_detectada}\n`;
  }

  return { role: "system", content: baseContextString() + extra };
}

async function sendChat(text) {
  const history = getHistory();
  const reqMessages = [makeSystemContextMessage(), ...history, { role: "user", content: text }];

  const res = await fetch(CHAT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: reqMessages })
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(raw);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Respuesta no-JSON: " + raw);
  }

  if (data.accion === "preguntar" || data.accion === "fuera_rango" || data.accion === "no_soportado") {
    const reply = data.mensaje || "Indica una fecha y hora de 2024 (ej: 2024-03-15 15:00).";
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "explicar") {
    const reply = data.mensaje || "Listo. ¿Qué parte quieres interpretar: el valor predicho, su utilidad o el reporte de ineficiencia?";
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  if (data.accion === "predecir") {
    const ts = new Date(`${data.fecha}T${pad2(data.hora)}:00:00`);
    let pred;
    try {
      pred = await callPredict(ts);
    } catch (e) {
      const reply = String(e.message || e);
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: reply });
      setHistory(history);
      return reply;
    }

    const timestamp = `${data.fecha} ${pad2(data.hora)}:00:00`;
    setLastPred({ sede: data.sede || SEDE, timestamp, prediccion_kwh: pred.prediccion_kwh });

    const reply = `Para ${data.fecha} a las ${pad2(data.hora)}:00 en ${data.sede || SEDE}, la predicción es ${pred.prediccion_kwh} kWh.`;
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    setHistory(history);
    return reply;
  }

  const fallback = "No entendí. Prueba: “Predice 2024-02-15 15:00” o “¿Para qué sirve la predicción?”";
  history.push({ role: "user", content: text });
  history.push({ role: "assistant", content: fallback });
  setHistory(history);
  return fallback;
}

function wireChatSend(inputId, btnId, logId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const log = document.getElementById(logId);

  if (!input || !btn || !log) return;

  const doSend = async () => {
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";

    const history = getHistory();
    history.push({ role: "user", content: text });
    setHistory(history);

    renderChatFromStorage();

    try {
      const reply = await sendChat(text);
      renderChatFromStorage();
    } catch {
      const h = getHistory();
      h.push({ role: "assistant", content: "Error al procesar la consulta" });
      setHistory(h);
      renderChatFromStorage();
    }
  };

  btn.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSend();
  });
}

function wirePills() {
  const pills = document.querySelectorAll(".pill");
  pills.forEach(p => {
    p.addEventListener("click", () => {
      const prompt = p.getAttribute("data-prompt") || "";
      const input1 = document.getElementById("chatInput");
      const input2 = document.getElementById("chatInput2");
      const target = document.getElementById("tab-chat").classList.contains("active") ? input2 : input1;
      if (target) target.value = prompt;
      if (target) target.focus();
    });
  });
}

async function doPredictFromUI() {
  setResult("");
  try {
    const dateStr = document.getElementById("dateInput").value;
    const hour = Number(document.getElementById("hourInput").value);
    const ts = new Date(`${dateStr}T${pad2(hour)}:00:00`);

    setStatus("Consultando Render...");
    const out = await callPredict(ts);

    setStatus("OK");
    setResult(`Predicción: ${out.prediccion_kwh} kWh`);

    const timestamp = `${dateStr} ${pad2(hour)}:00:00`;
    setLastPred({ sede: SEDE, timestamp, prediccion_kwh: out.prediccion_kwh });
  } catch (e) {
    setStatus("Error");
    setResult(String(e.message || e));
  }
}

function wirePredictButtons() {
  const btn = document.getElementById("btnPredict");
  if (btn) btn.addEventListener("click", doPredictFromUI);

  const btnToChat = document.getElementById("btnToChat");
  if (btnToChat) {
    btnToChat.addEventListener("click", async () => {
      const dateStr = document.getElementById("dateInput").value;
      const hour = Number(document.getElementById("hourInput").value);
      const msg = `Predice para ${dateStr} a las ${hour} horas`;
      const input = document.getElementById("chatInput");
      if (input) input.value = msg;
      switchTab("tab-chat");
      const input2 = document.getElementById("chatInput2");
      if (input2) input2.value = msg;
    });
  }

  const clear1 = document.getElementById("btnClearChat");
  const clear2 = document.getElementById("btnClearChat2");
  const clearFn = () => {
    clearChat();
    renderChatFromStorage();
  };
  if (clear1) clear1.addEventListener("click", clearFn);
  if (clear2) clear2.addEventListener("click", clearFn);
}

function parsePrediccionesCSV(text) {
  const lines = text.trim().split("\n");
  const h = lines[0].split(",");
  const t = h.indexOf("timestamp");
  const r = h.indexOf("real_kwh");
  const p = h.indexOf("pred_kwh");

  const xs = [];
  const real = [];
  const pred = [];

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const ts = new Date(String(c[t]).replace(" ", "T") + "Z");
    xs.push(ts);
    real.push(Number(c[r]));
    pred.push(Number(c[p]));
  }

  return { xs, real, pred };
}

async function loadChart() {
  const status = document.getElementById("chartStatus");
  if (status) status.textContent = "Cargando predicciones.csv...";
  const r = await fetch("predicciones.csv");
  const text = await r.text();
  const d = parsePrediccionesCSV(text);

  const ctx = document.getElementById("chartMain").getContext("2d");

  chartMain = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Real",
          data: d.xs.map((x, i) => ({ x, y: d.real[i] })),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25
        },
        {
          label: "Predicho",
          data: d.xs.map((x, i) => ({ x, y: d.pred[i] })),
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [6, 6],
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#e8ecff" } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "month" },
          ticks: { color: "#aab3d6", maxTicksLimit: 10 },
          grid: { color: "rgba(255,255,255,.06)" }
        },
        y: {
          ticks: { color: "#aab3d6" },
          grid: { color: "rgba(255,255,255,.06)" }
        }
      }
    }
  });

  const wrap = document.getElementById("chartMain");
  if (wrap) wrap.style.height = "360px";

  if (status) status.textContent = `OK · ${d.xs.length} puntos`;
}

function switchTab(id) {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tabPanel").forEach(p => p.classList.remove("active"));

  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  const panel = document.getElementById(id);
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");

  renderChatFromStorage();
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-tab");
      switchTab(id);
    });
  });
}

function severityBadge(rank) {
  const v = Number(rank);
  if (!Number.isFinite(v)) return { cls: "ok", text: "N/A" };
  if (v >= 40) return { cls: "danger", text: `Gravedad ${v}` };
  if (v >= 20) return { cls: "warn", text: `Gravedad ${v}` };
  return { cls: "ok", text: `Gravedad ${v}` };
}

function fmtNum(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return Math.round(n * 1000) / 1000;
}

async function loadInef() {
  const st = document.getElementById("inefStatus");
  if (st) st.textContent = "Cargando df_resultado.csv...";
  const r = await fetch("df_resultado.csv");
  const text = await r.text();
  const parsed = parseCSV(text);
  inefRows = parsed.rows.map(x => ({
    timestamp: x.timestamp,
    instalacion: x.instalacion,
    fecha_anomalia: x.fecha_anomalia,
    rank_gravedad: x.rank_gravedad,
    error_reconstruccion: x.error_reconstruccion,
    ocupacion_pct: x.ocupacion_pct,
    energia_real_kwh: x.energia_real_kwh,
    kpi_eficiencia_real: x.kpi_eficiencia_real,
    kpi_eficiencia_esperada: x.kpi_eficiencia_esperada,
    ineficiencia_detectada: x.ineficiencia_detectada
  }));

  const inst = Array.from(new Set(inefRows.map(r => r.instalacion))).filter(Boolean).sort();
  const sel = document.getElementById("instFilter");
  if (sel) {
    sel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todas las instalaciones";
    sel.appendChild(optAll);
    for (const i of inst) {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = i;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => renderInefList());
  }

  if (st) st.textContent = `OK · ${inefRows.length} filas`;
  renderInefList();

  const saved = getSelectedInef();
  if (saved) {
    const found = inefRows.find(x => x.timestamp === saved.timestamp && x.instalacion === saved.instalacion);
    if (found) selectInef(found);
  }
}

function currentInefFilter() {
  const sel = document.getElementById("instFilter");
  return sel ? sel.value : "";
}

function renderInefList() {
  const list = document.getElementById("inefList");
  if (!list) return;

  const f = currentInefFilter();
  let rows = inefRows.slice();
  if (f) rows = rows.filter(r => r.instalacion === f);

  rows.sort((a, b) => Number(b.rank_gravedad) - Number(a.rank_gravedad));

  list.innerHTML = "";
  const top = rows.slice(0, 60);

  for (const r of top) {
    const div = document.createElement("div");
    div.className = "item";
    const badge = severityBadge(r.rank_gravedad);

    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${r.instalacion}</div>
        <div class="badge ${badge.cls}">${badge.text}</div>
      </div>
      <div class="itemSub">${r.timestamp} · Ocupación: ${fmtNum(r.ocupacion_pct)}% · Energía: ${fmtNum(r.energia_real_kwh)} kWh</div>
    `;

    div.addEventListener("click", () => selectInef(r));
    list.appendChild(div);
  }
}

function selectInef(r) {
  selectedInef = r;
  setSelectedInef(r);

  const sub = document.getElementById("detailSub");
  const body = document.getElementById("detailBody");
  const btn = document.getElementById("btnAskAboutInef");

  if (sub) sub.textContent = `${r.timestamp} · ${r.instalacion}`;
  if (btn) btn.disabled = false;

  if (body) {
    const badge = severityBadge(r.rank_gravedad);
    body.innerHTML = `
      <div class="badge ${badge.cls}">${badge.text}</div>
      <div class="kv">
        <div class="k"><div class="k1">Ocupación (%)</div><div class="k2">${fmtNum(r.ocupacion_pct)}</div></div>
        <div class="k"><div class="k1">Energía real (kWh)</div><div class="k2">${fmtNum(r.energia_real_kwh)}</div></div>
        <div class="k"><div class="k1">KPI eficiencia real</div><div class="k2">${fmtNum(r.kpi_eficiencia_real)}</div></div>
        <div class="k"><div class="k1">KPI eficiencia esperada</div><div class="k2">${fmtNum(r.kpi_eficiencia_esperada)}</div></div>
        <div class="k"><div class="k1">Ineficiencia detectada</div><div class="k2">${fmtNum(r.ineficiencia_detectada)}</div></div>
        <div class="k"><div class="k1">Error reconstrucción</div><div class="k2">${fmtNum(r.error_reconstruccion)}</div></div>
      </div>
      <div class="divider"></div>
      <div class="miniNote">Tip: si ocupación baja y energía se mantiene, suele indicar consumo base anormal (climatización/equipos funcionando sin necesidad).</div>
    `;
  }
}

function wireInefActions() {
  const btnTop = document.getElementById("btnTop");
  if (btnTop) btnTop.addEventListener("click", () => renderInefList());

  const btnAsk = document.getElementById("btnAskAboutInef");
  if (btnAsk) {
    btnAsk.addEventListener("click", () => {
      if (!selectedInef) return;
      const q = "Interpreta esta ineficiencia: ¿qué indica y qué acciones recomiendas?";
      const input = document.getElementById("chatInput");
      const input2 = document.getElementById("chatInput2");
      if (input) input.value = q;
      if (input2) input2.value = q;
      switchTab("tab-chat");
    });
  }
}

function wireReset() {
  const btn = document.getElementById("btnResetZoom");
  if (btn) btn.addEventListener("click", () => {});
}

async function initPredictDefaults() {
  initHourSelect();
  setStatus("");
  setResult("");
}

function wirePredictUI() {
  wirePredictButtons();
}

function renderWelcomeIfEmpty() {
  const hist = getHistory();
  if (hist.length) return;

  const welcome = "Puedo predecir energia_total_kwh por hora (solo 2024) y explicar cómo usarlo para eficiencia. Ej: “Predice 2024-02-15 15:00” o “¿Para qué sirve esta predicción?”";
  const h = [{ role: "assistant", content: welcome }];
  setHistory(h);
  renderChatFromStorage();
}

async function main() {
  wireTabs();
  wirePills();

  await initPredictDefaults();
  await loadChart();
  await loadDataset();

  wirePredictUI();

  wireChatSend("chatInput", "chatSend", "chatLog");
  wireChatSend("chatInput2", "chatSend2", "chatLog2");

  wireInefActions();
  await loadInef();

  const clear1 = document.getElementById("btnClearChat");
  const clear2 = document.getElementById("btnClearChat2");
  const clearFn = () => {
    clearChat();
    renderWelcomeIfEmpty();
  };
  if (clear1) clear1.addEventListener("click", clearFn);
  if (clear2) clear2.addEventListener("click", clearFn);

  renderWelcomeIfEmpty();
  renderChatFromStorage();

  const btnPredict = document.getElementById("btnPredict");
  if (btnPredict) {
    btnPredict.addEventListener("click", async () => {
      await doPredictFromUI();
    });
  }
}

main();
