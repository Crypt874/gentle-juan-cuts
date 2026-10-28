// Dashboard: customer counts as pie charts, plus summary reports for the admin.
//   barber -> own customers, sliced by service
//   staff  -> all customers, sliced by barber (counts only, no money)
//   admin  -> everything: summary report, sales summary, customers per barber
// Data comes from completed entries in the queue.
import { db } from "./firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, peso, pad, todayStr, fmtDate, notify, clearNotice, friendlyError } from "./staff-common.js";
import { pieChart, barChart, colorMap, OTHER_COLOR } from "./charts.js";

const $ = (id) => document.getElementById(id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

let ctx = null;
let period = "day";
let anchor = todayStr(); // YYYY-MM-DD, the day / a day inside the month / a day inside the year
let barberColors = new Map();
let serviceColors = new Map();
let barberNames = new Map();
let allQueue = null;     // barber logins: everything of their own, filtered by date in the browser
let current = null;      // the numbers shown right now (used by the PDF)

// ---------- period maths ----------
const parts = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return { y, m, d }; };
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function range() {
  const { y, m, d } = parts(anchor);
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "month") return { from: ymd(y, m, 1), to: ymd(y, m, new Date(y, m, 0).getDate()) };
  return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
}

function labelFor() {
  const { y, m, d } = parts(anchor);
  if (period === "day") {
    return new Date(y, m - 1, d).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  return period === "month" ? `${MONTHS[m - 1]} ${y}` : String(y);
}

function shift(dir) {
  const { y, m, d } = parts(anchor);
  const dt = new Date(y, m - 1, d);
  if (period === "day") dt.setDate(dt.getDate() + dir);
  else if (period === "month") { dt.setDate(1); dt.setMonth(dt.getMonth() + dir); }
  else { dt.setDate(1); dt.setMonth(0); dt.setFullYear(dt.getFullYear() + dir); }
  anchor = ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// ---------- data ----------
async function fetchEntries() {
  const { from, to } = range();
  const mine = (e) => !ctx.isBarber || e.barberId === ctx.profile.barberId;
  const inRange = (e) => mine(e) && typeof e.date === "string" && e.date >= from && e.date <= to;
  if (ctx.isBarber && allQueue) return allQueue.filter(inRange);
  const q = ctx.isBarber
    // A barber may only ask for their own customers. (One filter = no extra index needed.)
    ? query(collection(db, "queue"), where("barberId", "==", ctx.profile.barberId || "none"))
    : query(collection(db, "queue"), where("date", ">=", from), where("date", "<=", to));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (ctx.isBarber) allQueue = list;
  return list.filter(inRange);
}

async function loadLists() {
  try {
    const [b, s] = await Promise.all([getDocs(collection(db, "barbers")), getDocs(collection(db, "services"))]);
    const bIds = [], sIds = [];
    b.forEach((d) => { bIds.push(d.id); barberNames.set(d.id, d.data().name || "Barber"); });
    s.forEach((d) => sIds.push(d.id));
    barberColors = colorMap(bIds);
    serviceColors = colorMap(sIds);
  } catch (err) {
    console.error(err);
  }
}

function tally(list, keyOf, labelOf, colors) {
  const map = new Map();
  list.forEach((e) => {
    const k = keyOf(e);
    const cur = map.get(k) || { id: k, label: labelOf(e), value: 0, sales: 0, color: colors.get(k) || OTHER_COLOR };
    cur.value += 1;
    cur.sales += Number(e.servicePrice) || 0;
    map.set(k, cur);
  });
  return [...map.values()].sort((a, b) => b.value - a.value);
}

// Sales over time: hours for a day, days for a month, months for a year
function buckets(done) {
  const { y, m } = parts(anchor);
  let items;
  if (period === "day") {
    items = Array.from({ length: 16 }, (_, i) => ({ label: `${(i + 6) % 12 || 12}${i + 6 < 12 ? "a" : "p"}`, value: 0, count: 0, hour: i + 6 }));
    done.forEach((e) => {
      const t = e.completedAt && typeof e.completedAt.toDate === "function" ? e.completedAt.toDate().getHours() : null;
      if (t === null) return;
      const b = items[Math.min(15, Math.max(0, t - 6))];
      b.value += Number(e.servicePrice) || 0; b.count++;
    });
  } else if (period === "month") {
    items = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => ({ label: String(i + 1), value: 0, count: 0 }));
    done.forEach((e) => { const b = items[parts(e.date).d - 1]; if (b) { b.value += Number(e.servicePrice) || 0; b.count++; } });
  } else {
    items = MON3.map((label) => ({ label, value: 0, count: 0 }));
    done.forEach((e) => { const b = items[parts(e.date).m - 1]; if (b) { b.value += Number(e.servicePrice) || 0; b.count++; } });
  }
  return items;
}

// ---------- rendering ----------
function tile(label, value) {
  const t = el("div", "tile");
  t.append(el("div", "tile-label", label), el("div", "tile-value", value));
  return t;
}

function card(title, sub, wide) {
  const c = el("section", `card dash-card${wide ? " dash-wide" : ""}`);
  c.append(el("h2", "", title));
  if (sub) c.append(el("p", "sub", sub));
  const body = el("div");
  c.append(body);
  $("cards").append(c);
  return body;
}

function breakdownTable(box, rows, firstHead, withMoney) {
  if (!rows.length) { box.append(el("p", "empty", "Nothing in this period.")); return; }
  const t = el("table", "table");
  const head = el("thead"); const hr = el("tr");
  [firstHead, "Customers", ...(withMoney ? ["Sales"] : [])].forEach((h, i) => hr.append(el("th", i ? "num" : "", h)));
  head.append(hr);
  const body = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr");
    tr.append(el("td", "", r.label), el("td", "num", String(r.value)));
    if (withMoney) tr.append(el("td", "num", peso.format(r.sales)));
    body.append(tr);
  });
  t.append(head, body);
  box.append(t);
}

async function render() {
  clearNotice();
  $("period-label").textContent = labelFor();
  $("next").disabled = false;
  let entries;
  try {
    entries = await fetchEntries();
  } catch (err) {
    notify(friendlyError(err), "error");
    return;
  }
  const done = entries.filter((e) => e.status === "completed");
  const cancelled = entries.filter((e) => e.status === "cancelled").length;
  const sales = done.reduce((s, e) => s + (Number(e.servicePrice) || 0), 0);
  const byBarber = tally(done, (e) => e.barberId || "?", (e) => e.barberName || barberNames.get(e.barberId) || "Barber", barberColors);
  const byService = tally(done, (e) => e.serviceId || e.serviceName || "?", (e) => e.serviceName || "Service", serviceColors);
  const { from, to } = range();
  current = { done, cancelled, sales, byBarber, byService, label: labelFor(), from, to };

  $("dash").style.display = "";
  $("tiles").replaceChildren();
  $("cards").replaceChildren();

  if (ctx.isBarber) {
    $("tiles").append(tile("My customers", String(done.length)), tile("Cancelled", String(cancelled)),
      tile("Most popular service", byService[0] ? byService[0].label : "-"));
    pieChart(card("My customers by service", `${labelFor()} - how many customers you served for each service`), byService);
  } else if (ctx.isAdmin) {
    $("tiles").append(tile("Customers served", String(done.length)), tile("Total sales", peso.format(sales)),
      tile("Average per customer", peso.format(done.length ? sales / done.length : 0)), tile("Cancelled", String(cancelled)));
    pieChart(card("Customers per barber", `${labelFor()} - share of customers each barber served`), byBarber);
    pieChart(card("Customers by service", `${labelFor()} - which haircuts were most requested`), byService);

    const sc = card("Sales summary", `${labelFor()} - ${period === "day" ? "sales by hour" : period === "month" ? "sales by day" : "sales by month"}`, true);
    barChart(sc, buckets(done), { format: (v) => peso.format(v) });

    breakdownTable(card("Summary report - by barber", labelFor()), byBarber, "Barber", true);
    breakdownTable(card("Summary report - by service", labelFor()), byService, "Service", true);
    $("dash-actions").style.display = "";
  } else {
    $("tiles").append(tile("Customers served", String(done.length)), tile("Cancelled", String(cancelled)),
      tile("Busiest barber", byBarber[0] ? byBarber[0].label : "-"));
    pieChart(card("Customers per barber", `${labelFor()} - share of customers each barber served`), byBarber);
    breakdownTable(card("Customers by service", labelFor()), byService, "Service", false);
  }
}

// ---------- PDF (admin) ----------
const pdfMoney = (n) => "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const WALNUT = [122, 82, 54], OAT = [236, 225, 210], INK = [59, 45, 34];

async function downloadPdf() {
  clearNotice();
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) return notify("The PDF tool could not load. Check your internet connection and try again.", "error");
  if (!current) return;
  let logo = null;
  try { logo = await (await import("./logo.js")).loadLogo(); } catch (err) { logo = null; }

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const kind = { day: "Daily", month: "Monthly", year: "Yearly" }[period];
  let top = 110;
  if (logo) {
    const lw = 150, lh = lw * logo.h / logo.w;
    doc.addImage(logo.dataUrl, "PNG", M, 30, lw, lh);
    top = 30 + lh + 12;
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(`${kind} Summary Report`, W - M, 54, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Period: ${current.label}`, W - M, 72, { align: "right" });
    doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, W - M, 86, { align: "right" });
  } else {
    doc.setTextColor(...WALNUT); doc.setFont("times", "bold"); doc.setFontSize(20);
    doc.text("The Gentle Juan Cuts", M, 52);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`${kind} Summary Report`, M, 74);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Period: ${current.label}`, M, 91);
  }
  doc.setDrawColor(...WALNUT); doc.setLineWidth(1.2); doc.line(M, top, W - M, top);

  const n = current.done.length;
  doc.autoTable({
    startY: top + 12,
    head: [["Customers served", "Total sales", "Average per customer", "Cancelled"]],
    body: [[String(n), pdfMoney(current.sales), pdfMoney(n ? current.sales / n : 0), String(current.cancelled)]],
    theme: "grid",
    headStyles: { fillColor: OAT, textColor: INK, fontStyle: "bold", halign: "center" },
    bodyStyles: { halign: "center", fontSize: 12, fontStyle: "bold", textColor: WALNUT, cellPadding: 8 },
    styles: { lineColor: [217, 204, 185] }, margin: { left: M, right: M }
  });

  const section = (title, head, body) => {
    let y = doc.lastAutoTable.finalY + 22;
    if (y > H - 120) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK);
    doc.text(title, M, y);
    doc.autoTable({
      startY: y + 6, head: [head], body: body.length ? body : [["-", "0", pdfMoney(0)]],
      theme: "striped", headStyles: { fillColor: WALNUT, textColor: 255 },
      alternateRowStyles: { fillColor: [247, 242, 233] },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } }, margin: { left: M, right: M }
    });
  };
  const rows = (list) => list.map((r) => [r.label, String(r.value), pdfMoney(r.sales)]);
  section("Customers per barber", ["Barber", "Customers", "Sales"], rows(current.byBarber));
  section("Customers by service", ["Service", "Customers", "Sales"], rows(current.byService));
  const slots = buckets(current.done).filter((b) => b.value > 0);
  const head = period === "day" ? "Hour" : period === "month" ? "Day" : "Month";
  section(`Sales by ${head.toLowerCase()}`, [head, "Customers", "Sales"], slots.map((b) => [b.label, String(b.count), pdfMoney(b.value)]));

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(122, 105, 88);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 22, { align: "right" });
    doc.text("The Gentle Juan Cuts - Summary Report", M, H - 22);
  }
  doc.save(`summary_${period}_${current.from}${current.from === current.to ? "" : "_to_" + current.to}.pdf`);
}

// ---------- controls ----------
function setPeriod(p) {
  period = p;
  document.querySelectorAll("#seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === p)));
  $("now").textContent = { day: "Today", month: "This month", year: "This year" }[p];
  render();
}

requireStaff(async (c) => {
  ctx = c;
  const sub = { admin: "Summary of customers and sales for the whole shop.", staff: "How many customers each barber has served.", barber: "Your customers, by service." }[c.level];
  $("dash-sub").textContent = sub;
  if (c.isBarber && !c.profile.barberId) {
    notify("Your account isn't linked to a barber profile yet. Ask the admin to link it in Settings > Accounts.", "error");
    return;
  }
  await loadLists();
  document.querySelectorAll("#seg button").forEach((b) => b.addEventListener("click", () => setPeriod(b.dataset.p)));
  $("prev").addEventListener("click", () => { shift(-1); render(); });
  $("next").addEventListener("click", () => { shift(1); render(); });
  $("now").addEventListener("click", () => { anchor = todayStr(); render(); });
  $("print-btn").addEventListener("click", () => window.print());
  $("pdf-btn").addEventListener("click", downloadPdf);
  setPeriod("day");
});
