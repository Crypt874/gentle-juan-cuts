import { db } from "./firebase-config.js";
import {
  collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, peso, pad, todayStr, fmtDate, notify, clearNotice, friendlyError
} from "./staff-common.js";

const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const reportBox = document.getElementById("report");

let rows = []; // sales documents for the selected period

// ---------- date helpers ----------
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

function presetRange(name) {
  const now = parseYmd(todayStr());
  if (name === "today") return [ymd(now), ymd(now)];
  if (name === "week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday as first day
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [ymd(monday), ymd(sunday)];
  }
  if (name === "month") {
    return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  }
  // last month
  return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
}

// Colors the preset button (Today / This week / ...) that matches the dates being viewed.
function markPreset(from, to) {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    const [f, t] = presetRange(btn.dataset.preset);
    const on = f === from && t === to;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

// ---------- loading ----------
async function load() {
  clearNotice();
  const from = fromInput.value;
  const to = toInput.value;
  if (!from || !to) return notify("Pick a start and end date.", "error");
  if (from > to) return notify("The start date must be before the end date.", "error");

  try {
    const snap = await getDocs(query(collection(db, "sales"), where("date", ">=", from), where("date", "<=", to)));
    rows = snap.docs.map((d) => d.data());
    render(from, to);
    markPreset(from, to);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- aggregation ----------
function groupBy(list, keyFn) {
  const map = new Map();
  list.forEach((r) => {
    const k = keyFn(r) || "(unknown)";
    const cur = map.get(k) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.amount) || 0;
    map.set(k, cur);
  });
  return map;
}

// ---------- rendering ----------
function tile(label, value) {
  const t = el("div", "tile");
  t.append(el("div", "tile-label", label), el("div", "tile-value", value));
  return t;
}

function table(headers, bodyRows) {
  const t = el("table", "table");
  const thead = el("thead");
  const hr = el("tr");
  headers.forEach((h, i) => {
    const th = el("th", i > 0 ? "num" : "", h);
    hr.append(th);
  });
  thead.append(hr);
  const tbody = el("tbody");
  bodyRows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((c, i) => {
      if (c instanceof Node) { tr.append(c); return; }
      tr.append(el("td", i > 0 ? "num" : "", c));
    });
    tbody.append(tr);
  });
  t.append(thead, tbody);
  return t;
}

function barCell(value, max) {
  const td = el("td", "barcell");
  const bar = el("div", "bar");
  bar.style.width = max > 0 ? `${Math.max(2, Math.round((value / max) * 100))}%` : "0";
  td.append(bar);
  return td;
}

function fillTable(box, headers, bodyRows, totalRow) {
  box.replaceChildren();
  if (!bodyRows.length) {
    box.append(el("p", "empty", "No sales in this period."));
    return;
  }
  const t = table(headers, bodyRows);
  if (totalRow) {
    const tfoot = el("tfoot");
    const tr = el("tr");
    totalRow.forEach((c, i) => tr.append(el("td", i > 0 ? "num strong" : "strong", c)));
    tfoot.append(tr);
    t.append(tfoot);
  }
  box.append(t);
}

function render(from, to) {
  reportBox.style.display = "";
  document.getElementById("period-label").textContent =
    from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const count = rows.length;
  const tiles = document.getElementById("tiles");
  tiles.replaceChildren(
    tile("Total sales", peso.format(total)),
    tile("Services completed", String(count)),
    tile("Average per service", peso.format(count ? total / count : 0))
  );

  // by day (with a simple bar)
  const byDay = [...groupBy(rows, (r) => r.date).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(0, ...byDay.map(([, v]) => v.total));
  const dayBox = document.getElementById("by-day");
  dayBox.replaceChildren();
  if (!byDay.length) {
    dayBox.append(el("p", "empty", "No sales in this period."));
  } else {
    const t = el("table", "table");
    const thead = el("thead");
    const hr = el("tr");
    ["Date", "Services", "Sales", ""].forEach((h, i) => hr.append(el("th", i === 1 || i === 2 ? "num" : "", h)));
    thead.append(hr);
    const tbody = el("tbody");
    byDay.forEach(([date, v]) => {
      const tr = el("tr");
      tr.append(el("td", "", fmtDate(date)), el("td", "num", String(v.count)), el("td", "num", peso.format(v.total)), barCell(v.total, maxDay));
      tbody.append(tr);
    });
    const tfoot = el("tfoot");
    const ft = el("tr");
    ft.append(el("td", "strong", "Total"), el("td", "num strong", String(count)), el("td", "num strong", peso.format(total)), el("td"));
    tfoot.append(ft);
    t.append(thead, tbody, tfoot);
    dayBox.append(t);
  }

  const toRows = (map) => [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([k, v]) => [k, String(v.count), peso.format(v.total)]);

  fillTable(document.getElementById("by-service"), ["Service", "Count", "Sales"],
    toRows(groupBy(rows, (r) => r.serviceName)));
  fillTable(document.getElementById("by-barber"), ["Barber", "Count", "Sales"],
    toRows(groupBy(rows, (r) => r.barberName)));
  fillTable(document.getElementById("by-payment"), ["Payment", "Count", "Sales"],
    toRows(groupBy(rows, (r) => r.paymentMethod || "Not recorded")));
}

// ---------- PDF export ----------
// The built-in PDF font cannot draw the peso sign, so amounts are written as "PHP 1,500".
const pdfMoney = (n) => "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const WALNUT = [122, 82, 54];
const OAT = [236, 225, 210];
const INK = [59, 45, 34];

async function downloadPdf() {
  clearNotice();
  if (!rows.length) return notify("There are no sales to download for this period.", "error");
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) return notify("The PDF tool could not load. Check your internet connection and try again.", "error");
  let logo = null;
  try { logo = await (await import("./logo.js")).loadLogo(); } catch (err) { logo = null; }

  const from = fromInput.value;
  const to = toInput.value;
  const period = from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const count = rows.length;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;

  // Title block: logo on the left, report details on the right
  let headerBottom = 116;
  if (logo) {
    const lw = 150;
    const lh = lw * logo.h / logo.w;
    doc.addImage(logo.dataUrl, "PNG", M, 30, lw, lh);
    headerBottom = 30 + lh + 12;
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Sales Report", pageW - M, 54, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Period: ${period}`, pageW - M, 72, { align: "right" });
    doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, pageW - M, 86, { align: "right" });
  } else {
    doc.setTextColor(...WALNUT);
    doc.setFont("times", "bold");
    doc.setFontSize(20);
    doc.text("The Gentle Juan Cuts", M, 52);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Sales Report", M, 74);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Period: ${period}`, M, 91);
    doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, M, 105);
  }
  doc.setDrawColor(...WALNUT);
  doc.setLineWidth(1.2);
  doc.line(M, headerBottom, pageW - M, headerBottom);

  // Summary
  autoTable(doc, {
    startY: headerBottom + 12,
    head: [["Total sales", "Services completed", "Average per service"]],
    body: [[pdfMoney(total), String(count), pdfMoney(count ? total / count : 0)]],
    theme: "grid",
    headStyles: { fillColor: OAT, textColor: INK, fontStyle: "bold", halign: "center" },
    bodyStyles: { halign: "center", fontSize: 13, fontStyle: "bold", textColor: WALNUT, cellPadding: 8 },
    styles: { lineColor: [217, 204, 185] },
    margin: { left: M, right: M }
  });

  const groupRows = (map) => [...map.entries()]
    .sort((x, y) => y[1].total - x[1].total)
    .map(([k, v]) => [k, String(v.count), pdfMoney(v.total)]);

  const section = (title, head, body, foot) => {
    let y = doc.lastAutoTable.finalY + 22;
    if (y > pageH - 120) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(title, M, y);
    autoTable(doc, {
      startY: y + 6,
      head: [head],
      body,
      foot: foot ? [foot] : undefined,
      showFoot: "lastPage",
      theme: "striped",
      headStyles: { fillColor: WALNUT, textColor: [251, 246, 238], fontStyle: "bold" },
      footStyles: { fillColor: OAT, textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 246, 240] },
      styles: { fontSize: 9.5, cellPadding: 5, textColor: INK },
      columnStyles: head.length === 3
        ? { 1: { halign: "right" }, 2: { halign: "right" } }
        : { [head.length - 1]: { halign: "right" } },
      margin: { left: M, right: M }
    });
  };

  const byDay = [...groupBy(rows, (r) => r.date).entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([d, v]) => [fmtDate(d), String(v.count), pdfMoney(v.total)]);

  section("Sales by day", ["Date", "Services", "Sales"], byDay, ["Total", String(count), pdfMoney(total)]);
  section("By service", ["Service", "Count", "Sales"], groupRows(groupBy(rows, (r) => r.serviceName)));
  section("By barber", ["Barber", "Count", "Sales"], groupRows(groupBy(rows, (r) => r.barberName)));
  section("By payment method", ["Payment", "Count", "Sales"], groupRows(groupBy(rows, (r) => r.paymentMethod || "Not recorded")));

  const detail = [...rows]
    .sort((x, y) => (x.date || "").localeCompare(y.date || ""))
    .map((r) => [fmtDate(r.date), r.customerName || "", r.serviceName || "", r.barberName || "", r.paymentMethod || "-", pdfMoney(r.amount)]);
  section("All completed services", ["Date", "Customer", "Service", "Barber", "Payment", "Amount"], detail,
    ["", "", "", "", "Total", pdfMoney(total)]);

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(122, 105, 88);
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 22, { align: "right" });
    doc.text("The Gentle Juan Cuts - Sales Report", M, pageH - 22);
  }

  doc.save(`sales_${from}_to_${to}.pdf`);
}

// jspdf-autotable adds doc.autoTable(); this wrapper keeps the calls above short.
function autoTable(doc, options) { doc.autoTable(options); }

// ---------- init ----------
requireStaff((ctx) => {
  if (!ctx.isAdmin) {
    notify("Only the admin can view sales reports.", "error");
    document.querySelector(".toolbar").style.display = "none";
    document.querySelector(".page-head .actions").style.display = "none";
    return;
  }

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [f, t] = presetRange(btn.dataset.preset);
      fromInput.value = f;
      toInput.value = t;
      load();
    });
  });
  fromInput.addEventListener("change", load);
  toInput.addEventListener("change", load);
  document.getElementById("pdf-btn").addEventListener("click", downloadPdf);
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  const [f, t] = presetRange("month");
  fromInput.value = f;
  toInput.value = t;
  load();
});