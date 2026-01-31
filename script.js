const CHAT_API = "/api/chat";

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

async function sendChat(text) {
  const history = getHistory();
  history.push({ role: "user", content: text });

  const res = await fetch(CHAT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history })
  });

  const data = await res.json();
  history.push({ role: "assistant", content: data.reply });
  setHistory(history);

  return data.reply;
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
          { label: "Predicho", data: pred, borderDash: [5,5], borderWidth: 2 }
        ]
      },
      options: { responsive: true }
    });
  });
