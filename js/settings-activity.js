// Settings > Activity log (owner and admin): who did what, newest first.
import { db } from "./firebase-config.js";
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { el, friendlyError, ROLE_LABEL, normRole } from "./staff-common.js";

const $ = (id) => document.getElementById(id);
let rows = [];

function when(a) {
  const t = a.at;
  const d = t && typeof t.toDate === "function" ? t.toDate() : null;
  return d ? d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "just now";
}

function render() {
  const text = $("act-search").value.trim().toLowerCase();
  const list = rows.filter((a) => !text || [a.name, a.action, a.detail, a.role].join(" ").toLowerCase().includes(text));
  const box = $("act-list");
  box.replaceChildren();
  if (!list.length) { box.append(el("p", "empty", rows.length ? "Nothing matches your search." : "No activity recorded yet.")); return; }
  const t = el("table", "table");
  const thead = el("thead"), hr = el("tr");
  ["When", "Who", "Action", "Details"].forEach((h) => hr.append(el("th", "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  list.forEach((a) => {
    const tr = el("tr");
    const who = el("td", "");
    who.append(el("span", "strong", a.name || "?"));
    if (a.role) who.append(el("span", "muted", ` (${ROLE_LABEL[normRole(a.role)] || a.role})`));
    tr.append(el("td", "", when(a)), who, el("td", "strong", a.action || ""), el("td", "muted", a.detail || ""));
    tbody.append(tr);
  });
  t.append(thead, tbody);
  box.append(t);
}

async function load() {
  const box = $("act-list");
  box.replaceChildren(el("p", "empty", "Loading..."));
  try {
    const snap = await getDocs(query(collection(db, "activity"), orderBy("at", "desc"), limit(200)));
    rows = snap.docs.map((d) => d.data());
    render();
  } catch (err) {
    box.replaceChildren(el("p", "empty", friendlyError(err)));
  }
}

export function initActivity() {
  $("act-refresh").addEventListener("click", load);
  $("act-search").addEventListener("input", render);
  // loads when the tab is first opened
  let loaded = false;
  $("tab-activity").addEventListener("click", () => { if (!loaded) { loaded = true; load(); } });
  if (location.hash === "#activity") { loaded = true; load(); }
}
