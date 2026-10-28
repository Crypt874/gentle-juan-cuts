// Reminders for the team: about 1 hour before a reservation starts, a banner (and a phone/computer
// notification, if allowed) appears. It works while a staff page is open in a browser or the installed app.
// Owner/admin/staff are told about every reservation today; an employee about their own and unclaimed ones.
import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const LEAD_MIN = 60;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label12h = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const store = {
  get() { try { return JSON.parse(localStorage.getItem("alerted") || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem("alerted", JSON.stringify(v)); } catch { /* private mode: alerts may repeat */ } }
};

let box = null;
function toast(title, text) {
  if (!box) {
    box = document.createElement("div");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = "position:fixed;top:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 24px))";
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.style.cssText = "background:#1b1b1b;color:#fff;border-left:4px solid #c9a24a;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.35);font:14px/1.4 system-ui,sans-serif";
  const h = document.createElement("strong");
  h.textContent = title;
  const p = document.createElement("div");
  p.textContent = text;
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "Dismiss";
  x.style.cssText = "margin-top:6px;background:none;border:1px solid #888;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer";
  x.addEventListener("click", () => t.remove());
  t.append(h, p, x);
  box.append(t);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 250);
  } catch { /* sound is optional */ }
}

function announce(a) {
  const mins = Math.max(1, Math.round((new Date(`${a.date}T${a.time}:00`) - new Date()) / 60000));
  const who = a.barberId ? `with ${a.barberName}` : "- nobody has claimed it yet";
  const title = `Reservation in ${mins} min (${label12h(a.time)})`;
  const text = `${a.customerName}, ${a.serviceName} ${who}`;
  toast(title, text);
  beep();
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: text, tag: a.id });
  } catch { /* some phones only allow notifications from a service worker */ }
}

function addEnableButton() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  const nav = document.getElementById("staff-nav");
  if (!nav) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-sm btn-outline";
  b.textContent = "Turn on alerts";
  b.addEventListener("click", async () => {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
    b.remove();
  });
  nav.append(b);
}

export function startAlerts(ctx) {
  const col = collection(db, "appointments");
  const day = todayStr();
  const lists = { a: [], b: [] };
  const check = () => {
    const seen = store.get();
    const now = Date.now();
    let changed = false;
    // forget alerts from other days
    Object.keys(seen).forEach((k) => { if (seen[k] !== day) { delete seen[k]; changed = true; } });
    [...lists.a, ...lists.b].forEach((a) => {
      if (a.date !== day || a.queueId || !["pending", "confirmed"].includes(a.status) || seen[a.id]) return;
      const diff = (new Date(`${a.date}T${a.time}:00`).getTime() - now) / 60000;
      if (diff <= LEAD_MIN && diff > -15) {
        seen[a.id] = day;
        changed = true;
        announce(a);
      }
    });
    if (changed) store.set(seen);
  };
  const onErr = (e) => console.error(e);
  if (ctx.isBarber) {
    const mine = ctx.profile.barberId;
    if (!mine) return;
    onSnapshot(query(col, where("date", "==", day), where("barberId", "==", mine)),
      (s) => { lists.a = s.docs.map((d) => ({ id: d.id, ...d.data() })); check(); }, onErr);
    onSnapshot(query(col, where("date", "==", day), where("barberId", "==", "")),
      (s) => { lists.b = s.docs.map((d) => ({ id: d.id, ...d.data() })); check(); }, onErr);
  } else {
    onSnapshot(query(col, where("date", "==", day)),
      (s) => { lists.a = s.docs.map((d) => ({ id: d.id, ...d.data() })); check(); }, onErr);
  }
  setInterval(check, 30000);
  addEnableButton();
}
