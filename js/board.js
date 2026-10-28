// Queue board for a TV or tablet in the shop. Shows only queue numbers (no customer names or phones).
// Log in on that device with a staff or admin account and open this page; it updates by itself.
import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, todayStr, queueLabel, notify, clearNotice, friendlyError } from "./staff-common.js";

const $ = (id) => document.getElementById(id);
const MAX_WAITING = 10;

let unsub = null;
let subscribedDate = "";
let lastServing = new Set(); // numbers already on screen, to highlight newly called ones
let first = true;

function tickClock() {
  const now = new Date();
  $("b-time").textContent = now.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  $("b-date").textContent = now.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
}

function render(entries) {
  const byNumber = (a, b) => (a.queueNumber || 0) - (b.queueNumber || 0);
  const serving = entries.filter((q) => q.status === "serving").sort(byNumber);
  const waiting = entries.filter((q) => q.status === "waiting").sort(byNumber);

  const sBox = $("b-serving");
  sBox.replaceChildren();
  if (!serving.length) sBox.append(el("p", "board-empty", "No one is being served right now."));
  serving.forEach((q) => {
    const card = el("div", "board-serve");
    if (!first && !lastServing.has(q.id)) card.classList.add("called");
    card.append(el("div", "board-num", queueLabel(q.queueNumber)), el("div", "board-barber", q.barberName ? `with ${q.barberName}` : ""));
    sBox.append(card);
  });
  lastServing = new Set(serving.map((q) => q.id));
  first = false;

  const wBox = $("b-waiting");
  wBox.replaceChildren();
  if (!waiting.length) wBox.append(el("p", "board-empty", "No one is waiting."));
  waiting.slice(0, MAX_WAITING).forEach((q) => {
    const chip = el("div", "board-wait");
    chip.append(el("span", "board-wnum", queueLabel(q.queueNumber)));
    if (q.barberName) chip.append(el("span", "board-wbarber", q.barberName));
    wBox.append(chip);
  });
  $("b-count").textContent = waiting.length > MAX_WAITING
    ? `+ ${waiting.length - MAX_WAITING} more waiting`
    : waiting.length ? `${waiting.length} waiting` : "";
}

// Listens to today's queue. At midnight it switches to the new day by itself.
function subscribe() {
  const today = todayStr();
  if (today === subscribedDate) return;
  subscribedDate = today;
  if (unsub) unsub();
  first = true;
  unsub = onSnapshot(query(collection(db, "queue"), where("date", "==", today)), (snap) => {
    clearNotice();
    render(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((q) => q.date === today));
  }, (err) => {
    notify(friendlyError(err), "error");
  });
}

requireStaff((ctx) => {
  if (ctx.isEmployee) {
    notify("The queue board is available to the owner, admins and staff.", "error");
    document.querySelector(".board-main").style.display = "none";
    return;
  }
  tickClock();
  subscribe();
  setInterval(() => { tickClock(); subscribe(); }, 15000);

  const full = $("b-full");
  if (!document.documentElement.requestFullscreen) full.hidden = true;
  full.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("board-full", !!document.fullscreenElement);
    full.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  });
});
