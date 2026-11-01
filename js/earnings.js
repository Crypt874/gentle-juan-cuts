// My Earnings (employee/barber accounts): today's earnings first, then a simple history per day and per month.
// Barbers see their own share and counts only, not the shop's totals.
import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, peso, todayStr, fmtDate, notify, clearNotice, friendlyError } from "./staff-common.js";

const $ = (id) => document.getElementById(id);
let barberId = "";
let rate = 50;      // barber's percent of each service (standard 50/50 split with the shop)
let mine = [];      // this barber's sales
let hist = "day";

const shareOf = (amount) => Math.round(amount * rate) / 100;
const amt = (s) => Number(s.amount) || 0;
const visitKey = (s) => s.queueId || `${s.customerName}|${s.date}`;
const countVisits = (rows) => new Set(rows.map(visitKey)).size;
const sum = (rows) => rows.reduce((t, s) => t + amt(s), 0);

function tile(label, value, note, strong) {
  const t = el("div", strong ? "tile tile-strong" : "tile");
  t.append(el("div", "tile-label", label), el("div", "tile-value", value));
  if (note) t.append(el("div", "hint", note));
  return t;
}

function table(headers, rows, foot) {
  const t = el("table", "table");
  const thead = el("thead"), hr = el("tr");
  headers.forEach((h, i) => hr.append(el("th", i >= 1 ? "num" : "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  rows.forEach((cells) => { const tr = el("tr"); cells.forEach((c, i) => tr.append(el("td", i >= 1 ? "num" : "", c))); tbody.append(tr); });
  t.append(thead, tbody);
  if (foot) { const tf = el("tfoot"), tr = el("tr"); foot.forEach((c, i) => tr.append(el("td", i >= 1 ? "num strong" : "strong", c))); tf.append(tr); t.append(tf); }
  return t;
}

const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
};

function renderToday() {
  const today = todayStr();
  const rows = mine.filter((s) => s.date === today);
  const total = sum(rows);
  $("period-label").textContent = fmtDate(today);
  $("tiles").replaceChildren(
    tile("Your earnings today", peso.format(shareOf(total)), `${rate}% of today's services`, true),
    tile("Customers served", String(countVisits(rows))),
    tile("Services done", String(rows.length))
  );
  const box = $("today-list");
  box.replaceChildren();
  if (!rows.length) { box.append(el("p", "empty", "No finished customers yet today.")); return; }
  const sec = (s) => (s.createdAt && s.createdAt.seconds) || 0;
  const body = [...rows].sort((a, b) => sec(b) - sec(a))
    .map((s) => [`${s.customerName || "Customer"} - ${s.serviceName || "Service"}`, peso.format(amt(s)), peso.format(shareOf(amt(s)))]);
  box.append(table(["Customer and service", "Price", "Your share"], body, ["Total", peso.format(total), peso.format(shareOf(total))]));
}

function renderHistory() {
  const box = $("history");
  box.replaceChildren();
  const today = todayStr();
  const groups = new Map();
  const keyOf = (s) => (hist === "day" ? s.date : String(s.date).slice(0, 7));
  const now = new Date();
  const cutoff = hist === "day"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    : new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const cut = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  mine.filter((s) => s.date && s.date >= cut && s.date <= today).forEach((s) => {
    const k = keyOf(s);
    const g = groups.get(k) || [];
    g.push(s);
    groups.set(k, g);
  });
  if (!groups.size) { box.append(el("p", "empty", "No earnings in this period yet.")); return; }
  const body = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([k, rows]) => [hist === "day" ? fmtDate(k) : monthLabel(k), String(countVisits(rows)), String(rows.length), peso.format(shareOf(sum(rows)))]);
  const all = [...groups.values()].flat();
  box.append(table([hist === "day" ? "Date" : "Month", "Customers", "Services", "Your share"], body,
    ["Total", String(countVisits(all)), String(all.length), peso.format(shareOf(sum(all)))]));
  box.append(el("p", "hint", hist === "day" ? "The last 30 days." : "The last 12 months."));
}

async function load() {
  clearNotice();
  try {
    const snap = await getDocs(query(collection(db, "sales"), where("barberId", "==", barberId)));
    mine = snap.docs.map((d) => d.data());
    renderToday();
    renderHistory();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

requireStaff(async (ctx) => {
  if (!ctx.isEmployee || !ctx.profile.barberId) {
    notify(ctx.isEmployee ? "Your login isn't linked to a barber profile yet. Please ask the admin." : "This page is for barber (employee) accounts.", "error");
    $("earn-body").style.display = "none";
    return;
  }
  barberId = ctx.profile.barberId;
  try {
    const b = await getDoc(doc(db, "barbers", barberId));
    const cr = b.exists() ? b.data().commissionRate : null;
    rate = cr != null && cr !== "" ? Number(cr) || 0 : 50;
  } catch (err) { console.error(err); }

  document.querySelectorAll("[data-hist]").forEach((btn) => btn.addEventListener("click", () => {
    hist = btn.dataset.hist;
    document.querySelectorAll("[data-hist]").forEach((x) => {
      const on = x === btn;
      x.classList.toggle("active", on);
      x.setAttribute("aria-selected", String(on));
    });
    renderHistory();
  }));
  load();
});
