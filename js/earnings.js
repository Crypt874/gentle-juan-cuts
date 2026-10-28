// My Earnings (employee/barber accounts): your own customers, services, sales and commission.
import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, peso, pad, todayStr, fmtDate, notify, clearNotice, friendlyError } from "./staff-common.js";

const $ = (id) => document.getElementById(id);
let barberId = "";
let rate = 0;      // commission percent set by the owner
let mine = [];     // all of this barber's sales (filtered by date in the browser)

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

function presetRange(name) {
  const now = parseYmd(todayStr());
  if (name === "today") return [ymd(now), ymd(now)];
  if (name === "week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [ymd(monday), ymd(sunday)];
  }
  if (name === "month") return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
}

function markPreset(from, to) {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    const [f, t] = presetRange(btn.dataset.preset);
    const on = f === from && t === to;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

const commissionOf = (amount) => Math.round(amount * rate) / 100;

function tile(label, value, note) {
  const t = el("div", "tile");
  t.append(el("div", "tile-label", label), el("div", "tile-value", value));
  if (note) t.append(el("div", "hint", note));
  return t;
}

function table(headers, rows, foot, numFrom = 1) {
  const t = el("table", "table");
  const thead = el("thead"), hr = el("tr");
  headers.forEach((h, i) => hr.append(el("th", i >= numFrom ? "num" : "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  rows.forEach((cells) => { const tr = el("tr"); cells.forEach((c, i) => tr.append(el("td", i >= numFrom ? "num" : "", c))); tbody.append(tr); });
  t.append(thead, tbody);
  if (foot) { const tf = el("tfoot"), tr = el("tr"); foot.forEach((c, i) => tr.append(el("td", i >= numFrom ? "num strong" : "strong", c))); tf.append(tr); t.append(tf); }
  return t;
}

function render() {
  const from = $("from").value, to = $("to").value;
  const rows = mine.filter((s) => s.barberId === barberId && s.date >= from && s.date <= to);
  $("period-label").textContent = from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;

  const total = rows.reduce((t, s) => t + (Number(s.amount) || 0), 0);
  const customers = new Set(rows.map((s) => s.queueId || s.customerName + s.date)).size;
  const tiles = [
    tile("Customers served", String(customers)),
    tile("Services done", String(rows.length)),
    tile("Sales you made for the shop", peso.format(total), rows.length ? `${peso.format(total / rows.length)} per service` : "")
  ];
  if (rate > 0) tiles.push(tile(`Your share (${rate}%)`, peso.format(commissionOf(total)), `Shop's share ${peso.format(total - commissionOf(total))}`));
  $("tiles").replaceChildren(...tiles);

  // by day
  const days = new Map();
  rows.forEach((s) => {
    const d = days.get(s.date) || { visits: new Set(), count: 0, total: 0 };
    d.visits.add(s.queueId || s.customerName); d.count += 1; d.total += Number(s.amount) || 0;
    days.set(s.date, d);
  });
  const dayBox = $("by-day");
  dayBox.replaceChildren();
  if (!days.size) dayBox.append(el("p", "empty", "No services in this period."));
  else {
    const body = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, v]) => [fmtDate(d), String(v.visits.size), String(v.count), peso.format(v.total), ...(rate > 0 ? [peso.format(commissionOf(v.total))] : [])]);
    dayBox.append(table(["Date", "Customers", "Services", "Sales", ...(rate > 0 ? ["Your share"] : [])], body,
      ["Total", String(customers), String(rows.length), peso.format(total), ...(rate > 0 ? [peso.format(commissionOf(total))] : [])]));
  }

  // by service
  const svcs = new Map();
  rows.forEach((s) => {
    const k = s.serviceName || "(unknown)";
    const cur = svcs.get(k) || { count: 0, total: 0 };
    cur.count += 1; cur.total += Number(s.amount) || 0;
    svcs.set(k, cur);
  });
  const svcBox = $("by-service");
  svcBox.replaceChildren();
  if (!svcs.size) svcBox.append(el("p", "empty", "No services in this period."));
  else {
    const body = [...svcs.entries()].sort((a, b) => b[1].total - a[1].total)
      .map(([k, v]) => [k, String(v.count), peso.format(v.total), ...(rate > 0 ? [peso.format(commissionOf(v.total))] : [])]);
    svcBox.append(table(["Service", "Count", "Sales", ...(rate > 0 ? ["Your share"] : [])], body));
  }
  markPreset(from, to);
}

async function load() {
  clearNotice();
  const from = $("from").value, to = $("to").value;
  if (!from || !to) return notify("Pick a start and end date.", "error");
  if (from > to) return notify("The start date must be before the end date.", "error");
  try {
    const snap = await getDocs(query(collection(db, "sales"), where("barberId", "==", barberId)));
    mine = snap.docs.map((d) => d.data());
    render();
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
    rate = cr != null && cr !== "" ? Number(cr) || 0 : 50; // standard 50/50 split with the shop
  } catch (err) { console.error(err); }

  document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
    const [f, t] = presetRange(btn.dataset.preset);
    $("from").value = f; $("to").value = t; render();
  }));
  $("from").addEventListener("change", render);
  $("to").addEventListener("change", render);

  const [f, t] = presetRange("month");
  $("from").value = f; $("to").value = t;
  load();
});
