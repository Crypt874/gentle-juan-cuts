// Receipts page: every receipt that was saved when a service was completed.
// Search, filter by date, open one to view, print, or download as PDF.
import { db } from "./firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, peso, pad, todayStr, fmtDate, notify, clearNotice, friendlyError } from "./staff-common.js";

const $ = (id) => document.getElementById(id);
const fromInput = $("from");
const toInput = $("to");
const searchInput = $("search");
const wrap = $("table-wrap");

let rows = [];

// ---------- dates ----------
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

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
  if (name === "month") {
    return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  }
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

// ---------- loading ----------
async function load() {
  clearNotice();
  const from = fromInput.value;
  const to = toInput.value;
  if (!from || !to) return notify("Pick a start and end date.", "error");
  if (from > to) return notify("The start date must be before the end date.", "error");

  try {
    const snap = await getDocs(query(collection(db, "receipts"), where("date", ">=", from), where("date", "<=", to)));
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("period-label").textContent = from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
    render();
    markPreset(from, to);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- list ----------
function matches(r, text, digits) {
  if (!text) return true;
  const hay = [r.receiptNo, r.customerName, r.serviceName, r.barberName, r.paymentMethod].join(" ").toLowerCase();
  if (hay.includes(text)) return true;
  return !!digits && String(r.contactNumber || "").replace(/\D/g, "").includes(digits);
}

function timeOf(r) {
  const t = r.completedAt;
  return t && typeof t.toDate === "function"
    ? t.toDate().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
    : "";
}

async function openReceipt(r, button, print = false) {
  button.disabled = true;
  try {
    const { showReceipt } = await import("./receipt-view.js");
    await showReceipt(r, { print });
  } catch (err) {
    console.error(err);
    notify("The receipt could not be opened. Check that receipt-view.js, receipt.js and logo.js are in your js folder.", "error");
  }
  button.disabled = false;
}

function render() {
  const text = searchInput.value.trim().toLowerCase();
  const digits = searchInput.value.replace(/\D/g, "");
  const list = rows
    .filter((r) => matches(r, text, digits))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.queueNumber || 0) - (a.queueNumber || 0));

  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  $("summary").textContent = list.length
    ? `${list.length} receipt${list.length === 1 ? "" : "s"}  -  Total ${peso.format(total)}`
    : "";

  wrap.replaceChildren();
  if (!list.length) {
    wrap.append(el("p", "empty", rows.length ? "No receipts match your search." : "No receipts in this period."));
    return;
  }

  const table = el("table", "table");
  const thead = el("thead");
  const hr = el("tr");
  ["Receipt no.", "Date", "Customer", "Service", "Barber", "Payment", "Amount", ""].forEach((h) => hr.append(el("th", h === "Amount" ? "num" : "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  list.forEach((r) => {
    const tr = el("tr");
    const when = timeOf(r) ? `${fmtDate(r.date)} ${timeOf(r)}` : fmtDate(r.date);
    const view = el("button", "btn btn-sm btn-outline", "View");
    view.type = "button";
    view.setAttribute("aria-label", `View receipt ${r.receiptNo || r.id}`);
    view.addEventListener("click", () => openReceipt(r, view));
    const prt = el("button", "btn btn-sm btn-outline", "Print");
    prt.type = "button";
    prt.setAttribute("aria-label", `Print receipt ${r.receiptNo || r.id}`);
    prt.addEventListener("click", () => openReceipt(r, prt, true));
    const action = el("td", "row-actions");
    action.append(view, " ", prt);
    tr.append(
      el("td", "strong", r.receiptNo || r.id),
      el("td", "", when),
      el("td", "", r.customerName || ""),
      el("td", "", r.serviceName || ""),
      el("td", "", r.barberName || ""),
      el("td", "", r.paymentMethod || "-"),
      el("td", "num", peso.format(Number(r.amount) || 0)),
      action
    );
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
}

// ---------- init ----------
requireStaff((ctx) => {
  if (ctx.isEmployee) {
    notify("Receipts are not available to employee accounts.", "error");
    $("toolbar").style.display = "none";
    wrap.replaceChildren();
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
  searchInput.addEventListener("input", render);

  const [f, t] = presetRange("month");
  fromInput.value = f;
  toInput.value = t;
  load();
});
