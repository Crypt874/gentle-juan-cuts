// Finance (owner/admin): profit & expenses, and barber commission, for a chosen period.
import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, peso, pad, todayStr, fmtDate, notify, clearNotice, friendlyError, logActivity
} from "./staff-common.js";

const $ = (id) => document.getElementById(id);
const CATEGORIES = ["Supplies", "Rent", "Utilities", "Salaries", "Equipment", "Marketing", "Other"];

let isOwner = false;
let sales = [];     // sales in the period
let expenses = [];  // expenses in the period ({ id, ... })
let barbers = [];   // { id, name, commissionRate }
let tab = "profit";

// ---------- dates ----------
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

const periodText = () => {
  const from = $("from").value, to = $("to").value;
  return from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
};

// ---------- numbers ----------
const sum = (list, f) => list.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const rateOf = (barberId) => {
  const b = barbers.find((x) => x.id === barberId);
  // Shop standard: barbers and the shop split every service 50/50 unless a different rate is saved.
  return b && b.commissionRate != null && b.commissionRate !== "" ? Number(b.commissionRate) || 0 : 50;
};

// Daily payout: for each day and barber, their sales, their share and the shop's share
function dailyRows() {
  const map = new Map();
  sales.forEach((s) => {
    const key = `${s.date}|${s.barberId || s.barberName || ""}`;
    const cur = map.get(key) || { date: s.date, id: s.barberId || "", name: s.barberName || "(unknown)", total: 0 };
    cur.total += Number(s.amount) || 0;
    map.set(key, cur);
  });
  return [...map.values()]
    .map((r) => ({ ...r, share: Math.round(r.total * rateOf(r.id)) / 100 }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

// Per barber: services, sales and commission for the period
function payrollRows() {
  const map = new Map();
  sales.forEach((s) => {
    const key = s.barberId || s.barberName || "(unknown)";
    const cur = map.get(key) || { id: s.barberId || "", name: s.barberName || "(unknown)", count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(s.amount) || 0;
    map.set(key, cur);
  });
  barbers.filter((b) => b.active !== false && !map.has(b.id)).forEach((b) => map.set(b.id, { id: b.id, name: b.name, count: 0, total: 0 }));
  return [...map.values()]
    .map((r) => ({ ...r, rate: rateOf(r.id), commission: Math.round(r.total * rateOf(r.id)) / 100 }))
    .sort((a, b) => b.total - a.total);
}

// ---------- loading ----------
async function load() {
  clearNotice();
  const from = $("from").value, to = $("to").value;
  if (!from || !to) return notify("Pick a start and end date.", "error");
  if (from > to) return notify("The start date must be before the end date.", "error");
  try {
    const [sSnap, eSnap, bSnap] = await Promise.all([
      getDocs(query(collection(db, "sales"), where("date", ">=", from), where("date", "<=", to))),
      getDocs(query(collection(db, "expenses"), where("date", ">=", from), where("date", "<=", to))),
      getDocs(query(collection(db, "barbers"), orderBy("name")))
    ]);
    sales = sSnap.docs.map((d) => d.data());
    expenses = eSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    barbers = bSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("period-label").textContent = periodText();
    markPreset(from, to);
    render();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- rendering ----------
function tile(label, value, note) {
  const t = el("div", "tile");
  t.append(el("div", "tile-label", label), el("div", "tile-value", value));
  if (note) t.append(el("div", "hint", note));
  return t;
}

function simpleTable(headers, rows, foot, numCols = []) {
  const t = el("table", "table");
  const thead = el("thead"), hr = el("tr");
  headers.forEach((h, i) => hr.append(el("th", numCols.includes(i) ? "num" : "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((c, i) => { if (c instanceof Node) tr.append(c); else tr.append(el("td", numCols.includes(i) ? "num" : "", c)); });
    tbody.append(tr);
  });
  t.append(thead, tbody);
  if (foot) {
    const tf = el("tfoot"), tr = el("tr");
    foot.forEach((c, i) => tr.append(el("td", numCols.includes(i) ? "num strong" : "strong", c)));
    tf.append(tr);
    t.append(tf);
  }
  return t;
}

function renderProfit() {
  const salesTotal = sum(sales, (s) => s.amount);
  const expTotal = sum(expenses, (e) => e.amount);
  const commission = payrollRows().reduce((t, r) => t + r.commission, 0);
  const profit = salesTotal - expTotal - commission;
  $("tiles").replaceChildren(
    tile("Sales", peso.format(salesTotal), `${sales.length} service${sales.length === 1 ? "" : "s"}`),
    tile("Expenses", peso.format(expTotal)),
    tile("Barber shares (50/50)", peso.format(commission)),
    tile("Profit", peso.format(profit), "Sales - expenses - commissions")
  );

  // by category
  const cats = new Map();
  expenses.forEach((e) => cats.set(e.category || "Other", (cats.get(e.category || "Other") || 0) + (Number(e.amount) || 0)));
  const catBox = $("by-cat");
  catBox.replaceChildren();
  if (!cats.size) catBox.append(el("p", "empty", "No expenses in this period."));
  else {
    const rows = [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, peso.format(v)]);
    catBox.append(simpleTable(["Category", "Amount"], rows, ["Total", peso.format(expTotal)], [1]));
  }

  // list
  const listBox = $("expense-list");
  listBox.replaceChildren();
  if (!expenses.length) { listBox.append(el("p", "empty", "No expenses in this period.")); return; }
  const rows = expenses.map((e) => {
    const act = el("td", "row-actions");
    if (isOwner) {
      const del = el("button", "btn btn-sm btn-outline", "Delete");
      del.type = "button";
      del.setAttribute("aria-label", `Delete expense ${e.description || e.category}`);
      del.addEventListener("click", async () => {
        if (!window.confirm(`Delete this expense (${peso.format(Number(e.amount) || 0)}, ${e.category})?`)) return;
        del.disabled = true;
        try { await deleteDoc(doc(db, "expenses", e.id)); await load(); logIt("Deleted expense", `${e.category} ${peso.format(Number(e.amount) || 0)} ${e.description || ""}`); }
        catch (err) { notify(friendlyError(err), "error"); del.disabled = false; }
      });
      act.append(del);
    }
    return [fmtDate(e.date), e.category || "Other", e.description || "", peso.format(Number(e.amount) || 0), act];
  });
  listBox.append(simpleTable(["Date", "Category", "Description", "Amount", ""], rows, null, [3]));
}

function renderPayroll() {
  const box = $("payroll-table");
  box.replaceChildren();
  const rows = payrollRows();
  if (!rows.length) { box.append(el("p", "empty", "No barbers or sales in this period.")); return; }
  const totalSales = sum(rows, (r) => r.total);
  const totalComm = sum(rows, (r) => r.commission);
  const body = rows.map((r) => {
    const cell = el("td", "");
    if (r.id) {
      const input = document.createElement("input");
      input.type = "number"; input.min = "0"; input.max = "100"; input.step = "0.5";
      input.className = "rate-input";
      input.value = String(r.rate);
      input.placeholder = "0";
      input.setAttribute("aria-label", `Commission percent for ${r.name}`);
      const save = el("button", "btn btn-sm btn-outline", "Save rate");
      save.type = "button";
      save.addEventListener("click", async () => {
        const v = Number(input.value || 0);
        if (!Number.isFinite(v) || v < 0 || v > 100) return notify("The commission must be between 0 and 100 percent.", "error");
        save.disabled = true;
        clearNotice();
        try {
          await updateDoc(doc(db, "barbers", r.id), { commissionRate: v });
          const b = barbers.find((x) => x.id === r.id);
          if (b) b.commissionRate = v;
          logIt("Changed commission rate", `${r.name}: ${r.rate}% -> ${v}%`);
          notify(`${r.name}'s commission is now ${v}%.`, "success");
          render();
        } catch (err) { notify(friendlyError(err), "error"); save.disabled = false; }
      });
      cell.append(input, " %  ", save);
    } else cell.textContent = "-";
    return [r.name, String(r.count), peso.format(r.total), cell, peso.format(r.commission)];
  });
  box.append(simpleTable(["Barber", "Services", "Sales", "Barber share %", "Barber's share"], body,
    ["Total", String(sum(rows, (r) => r.count)), peso.format(totalSales), "", peso.format(totalComm)], [1, 2, 4]));
  const days = dailyRows();
  if (days.length) {
    box.append(el("h3", "", "Daily payout (what each barber is paid per day)"));
    box.append(simpleTable(["Date", "Barber", "Sales", "Barber's share", "Shop's share"],
      days.map((d) => [d.date, d.name, peso.format(d.total), peso.format(d.share), peso.format(d.total - d.share)]),
      ["Total", "", peso.format(sum(days, (d) => d.total)), peso.format(sum(days, (d) => d.share)), peso.format(sum(days, (d) => d.total - d.share))], [2, 3, 4]));
  }
  box.append(el("p", "hint", `Shop keeps ${peso.format(totalSales - totalComm)} of ${peso.format(totalSales)} in sales, before other expenses.`));
}

function render() {
  if (tab === "profit") renderProfit(); else renderPayroll();
  // the profit tiles also need the commission, so keep both up to date
  if (tab === "payroll") renderProfit(); else renderPayroll();
}

// ---------- add expense ----------
async function addExpense(e) {
  e.preventDefault();
  clearNotice();
  const date = $("x-date").value;
  const category = $("x-cat").value;
  const description = $("x-desc").value.trim();
  const amountText = $("x-amount").value.trim();
  const amount = Number(amountText);
  if (!date) return notify("Pick the date of the expense.", "error");
  if (amountText === "" || !Number.isFinite(amount) || amount <= 0) return notify("Enter the amount of the expense.", "error");
  const btn = $("x-save");
  btn.disabled = true;
  try {
    await addDoc(collection(db, "expenses"), { date, category, description, amount, createdAt: serverTimestamp() });
    logIt("Added expense", `${category} ${peso.format(amount)} ${description}`.trim());
    $("x-desc").value = "";
    $("x-amount").value = "";
    notify("Expense added.", "success");
    if (date >= $("from").value && date <= $("to").value) await load();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
  btn.disabled = false;
}

const logIt = (action, detail) => logActivity(action, detail);

// ---------- PDF ----------
const pdfMoney = (n) => "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const WALNUT = [122, 82, 54], OAT = [236, 225, 210], INK = [59, 45, 34];

async function downloadPdf() {
  clearNotice();
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) return notify("The PDF tool could not load. Check your internet connection and try again.", "error");
  let logo = null;
  try { logo = await (await import("./logo.js")).loadLogo(); } catch (err) { logo = null; }

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight(), M = 40;
  const title = tab === "profit" ? "Profit & Expenses Report" : "Barber Commission Report";
  let top = 110;
  if (logo) {
    const lw = 150, lh = lw * logo.h / logo.w;
    doc.addImage(logo.dataUrl, "PNG", M, 30, lw, lh);
    top = 30 + lh + 12;
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(title, pageW - M, 54, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Period: ${periodText()}`, pageW - M, 72, { align: "right" });
    doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, pageW - M, 86, { align: "right" });
  } else {
    doc.setTextColor(...WALNUT); doc.setFont("times", "bold"); doc.setFontSize(20); doc.text("The Gentle Juan Cuts", M, 52);
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(title, M, 74);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Period: ${periodText()}`, M, 91); doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, M, 105);
  }
  doc.setDrawColor(...WALNUT); doc.setLineWidth(1.2); doc.line(M, top, pageW - M, top);

  const common = {
    theme: "striped", headStyles: { fillColor: WALNUT, textColor: [251, 246, 238], fontStyle: "bold" },
    footStyles: { fillColor: OAT, textColor: INK, fontStyle: "bold" }, alternateRowStyles: { fillColor: [250, 246, 240] },
    styles: { fontSize: 9.5, cellPadding: 5, textColor: INK }, margin: { left: M, right: M }
  };
  const heading = (text, y) => { doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(text, M, y); };

  if (tab === "profit") {
    const salesTotal = sum(sales, (s) => s.amount), expTotal = sum(expenses, (e) => e.amount);
    const commission = payrollRows().reduce((t, r) => t + r.commission, 0);
    doc.autoTable({
      startY: top + 12, head: [["Sales", "Expenses", "Barber shares (50/50)", "Profit"]],
      body: [[pdfMoney(salesTotal), pdfMoney(expTotal), pdfMoney(commission), pdfMoney(salesTotal - expTotal - commission)]],
      theme: "grid", headStyles: { fillColor: OAT, textColor: INK, fontStyle: "bold", halign: "center" },
      bodyStyles: { halign: "center", fontSize: 12, fontStyle: "bold", textColor: WALNUT, cellPadding: 8 },
      styles: { lineColor: [217, 204, 185] }, margin: { left: M, right: M }
    });
    const cats = new Map();
    expenses.forEach((e) => cats.set(e.category || "Other", (cats.get(e.category || "Other") || 0) + (Number(e.amount) || 0)));
    let y = doc.lastAutoTable.finalY + 24;
    heading("Expenses by category", y);
    doc.autoTable({ ...common, startY: y + 6, head: [["Category", "Amount"]],
      body: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, pdfMoney(v)]),
      foot: [["Total", pdfMoney(expTotal)]], columnStyles: { 1: { halign: "right" } } });
    y = doc.lastAutoTable.finalY + 24;
    if (y > pageH - 120) { doc.addPage(); y = 50; }
    heading("All expenses", y);
    doc.autoTable({ ...common, startY: y + 6, head: [["Date", "Category", "Description", "Amount"]],
      body: [...expenses].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((e) => [fmtDate(e.date), e.category || "Other", e.description || "", pdfMoney(e.amount)]),
      columnStyles: { 3: { halign: "right" } } });
  } else {
    const rows = payrollRows();
    doc.autoTable({ ...common, startY: top + 14, head: [["Barber", "Services", "Sales", "Rate", "Barber's share"]],
      body: rows.map((r) => [r.name, String(r.count), pdfMoney(r.total), `${r.rate}%`, pdfMoney(r.commission)]),
      foot: [["Total", String(sum(rows, (r) => r.count)), pdfMoney(sum(rows, (r) => r.total)), "", pdfMoney(sum(rows, (r) => r.commission))]],
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(122, 105, 88);
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 22, { align: "right" });
    doc.text(`The Gentle Juan Cuts - ${title}`, M, pageH - 22);
  }
  doc.save(`${tab === "profit" ? "profit" : "commission"}_${$("from").value}_to_${$("to").value}.pdf`);
}

// ---------- tabs ----------
const tabs = [...document.querySelectorAll(".tab")];
function showTab(name) {
  tab = name;
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(`panel-${t.dataset.tab}`).hidden = !on;
  });
  try { history.replaceState(null, "", `#${name}`); } catch (e) { /* ignore */ }
}

// ---------- init ----------
requireStaff((ctx) => {
  if (!ctx.isAdmin) {
    notify("Only the owner and admins can open Finance.", "error");
    $("finance-body").style.display = "none";
    document.querySelector(".page-head .actions").style.display = "none";
    return;
  }
  isOwner = ctx.isOwner;

  CATEGORIES.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; $("x-cat").append(o); });
  $("x-date").value = todayStr();
  $("expense-form").addEventListener("submit", addExpense);

  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  const wanted = location.hash.replace("#", "");
  showTab(tabs.some((t) => t.dataset.tab === wanted) ? wanted : "profit");

  document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
    const [f, t] = presetRange(btn.dataset.preset);
    $("from").value = f; $("to").value = t; load();
  }));
  $("from").addEventListener("change", load);
  $("to").addEventListener("change", load);
  $("pdf-btn").addEventListener("click", downloadPdf);
  $("print-btn").addEventListener("click", () => window.print());

  const [f, t] = presetRange("month");
  $("from").value = f; $("to").value = t;
  load();
});
