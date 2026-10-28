// Settings page: tabs for Business profile, Accounts, and Backup & restore (this file handles backup/restore).
// Admin only. Staff accounts ("users") are never backed up or restored, so a restore
// can't change anyone's role or lock the admin out.
import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { requireStaff, el, pad, todayStr, fmtDate, notify, clearNotice, friendlyError, logActivity } from "./staff-common.js";

const APP_ID = "gentle-juan-cuts-backup";
const VERSION = 1;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const BATCH_SIZE = 400;
const LAST_BACKUP_KEY = "gjc:lastBackup";

const NAMES = [
  "services", "barbers", "customers", "appointments", "bookedSlots",
  "queue", "counters", "serviceHistory", "sales", "expenses", "receipts", "photos", "settings"
];

// Fields the security rules allow when an appointment is first created.
const APPT_CREATE_KEYS = [
  "customerName", "contactNumber", "facebookProfile", "serviceId", "serviceName",
  "servicePrice", "barberId", "barberName", "date", "time", "status", "createdAt", "customerEmail"
];

const $ = (id) => document.getElementById(id);
const backupBtn = $("backup-btn");
const restoreBtn = $("restore-btn");
const fileInput = $("restore-file");
const preview = $("restore-preview");
const progressEl = $("restore-progress");

let pending = null; // parsed backup waiting to be restored

// ---------- converting Firestore data to/from plain JSON ----------
function encode(v) {
  if (v instanceof Timestamp) return { __type: "timestamp", seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") {
    const out = {};
    Object.keys(v).forEach((k) => { out[k] = encode(v[k]); });
    return out;
  }
  return v;
}

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    if (v.__type === "timestamp") {
      if (!Number.isFinite(v.seconds) || !Number.isFinite(v.nanoseconds)) throw new Error("bad-file");
      return new Timestamp(v.seconds, v.nanoseconds);
    }
    const out = {};
    Object.keys(v).forEach((k) => {
      if (k === "__proto__") return;
      out[k] = decode(v[k]);
    });
    return out;
  }
  return v;
}

// ---------- backup ----------
async function readAll() {
  const out = {};
  for (const name of NAMES) {
    const snap = await getDocs(collection(db, name));
    out[name] = snap.docs.map((d) => ({ id: d.id, data: encode(d.data()) }));
  }
  return out;
}

function downloadBackup(collections, prefix) {
  const now = new Date();
  const file = { app: APP_ID, version: VERSION, createdAt: now.toISOString(), collections };
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const name = `${prefix}_${todayStr()}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}

function showLastBackup() {
  const box = $("last-backup");
  let iso = "";
  try { iso = localStorage.getItem(LAST_BACKUP_KEY) || ""; } catch (e) { /* storage unavailable */ }
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) {
    box.textContent = "You haven't downloaded a backup from this computer yet.";
    return;
  }
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const when = `${fmtDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)} at ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
  box.textContent = days >= 7
    ? `Last backup: ${when} (${days} days ago - time for a new one).`
    : `Last backup: ${when}.`;
}

backupBtn.addEventListener("click", async () => {
  clearNotice();
  backupBtn.disabled = true;
  backupBtn.textContent = "Saving...";
  try {
    const data = await readAll();
    const name = downloadBackup(data, "gentle-juan-cuts-backup");
    try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch (e) { /* ignore */ }
    const total = NAMES.reduce((s, n) => s + data[n].length, 0);
    logActivity("Downloaded backup", `${total} records`);
    notify(`Backup saved (${total} records). Look for "${name}" in your Downloads folder and keep it safe.`, "success");
    showLastBackup();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
  backupBtn.disabled = false;
  backupBtn.textContent = "Download backup";
});

// ---------- reading a backup file ----------
function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error("not-json"); }
  if (!raw || raw.app !== APP_ID || raw.version !== VERSION || !raw.collections || typeof raw.collections !== "object") {
    throw new Error("not-backup");
  }
  const data = {};
  Object.keys(raw.collections).forEach((name) => {
    if (!NAMES.includes(name)) return; // anything else (for example "users") is ignored, never restored
    const list = raw.collections[name];
    if (!Array.isArray(list)) throw new Error("not-backup");
    const map = new Map();
    list.forEach((item) => {
      const id = item && item.id;
      if (typeof id !== "string" || !id || id.length > 200 || id.includes("/") || id === "." || id === ".." || /^__.*__$/.test(id)
        || !item.data || typeof item.data !== "object" || Array.isArray(item.data)) {
        throw new Error("bad-doc");
      }
      map.set(id, decode(item.data));
    });
    data[name] = map;
  });
  if (!Object.keys(data).length) throw new Error("not-backup");
  return { createdAt: raw.createdAt, data };
}

function fileErrorText(err) {
  if (err.message === "not-json") return "That file couldn't be read. Choose a backup file that ends in .json.";
  if (err.message === "bad-doc" || err.message === "bad-file") return "That backup file is damaged and can't be restored.";
  return "That doesn't look like a Gentle Juan Cuts backup file.";
}

function resetRestore() {
  pending = null;
  fileInput.value = "";
  fileInput.disabled = false;
  restoreBtn.disabled = false;
  preview.style.display = "none";
  progressEl.textContent = "";
}

fileInput.addEventListener("change", async () => {
  clearNotice();
  pending = null;
  preview.style.display = "none";
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    fileInput.value = "";
    return notify("That file is too large to be a backup of this shop.", "error");
  }
  try {
    pending = parseBackup(await file.text());
  } catch (err) {
    fileInput.value = "";
    return notify(fileErrorText(err), "error");
  }

  const records = Object.keys(pending.data).reduce((s, n) => s + pending.data[n].size, 0);
  const made = pending.createdAt ? new Date(pending.createdAt) : null;
  const when = made && !Number.isNaN(made.getTime())
    ? `${made.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })} at ${made.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
    : "an unknown date";
  $("restore-meta").textContent = `Backup from ${when} - ${records} records.`;
  progressEl.textContent = "";
  preview.style.display = "";
});

// ---------- restoring ----------
// The rules only let a NEW appointment be created as "pending" with a fixed set of fields,
// so missing appointments are created as a bare "pending" copy first and then updated to the real data.
function appointmentStub(d) {
  const stub = {};
  APPT_CREATE_KEYS.forEach((k) => { if (k in d) stub[k] = d[k]; });
  stub.status = "pending";
  if (typeof stub.facebookProfile !== "string") stub.facebookProfile = "";
  return stub;
}

function buildPlan(data, existing) {
  const phases = [[], []]; // 1: create stubs/slots, 2: write the real records
  let skipped = 0;
  Object.keys(data).forEach((name) => {
    const have = existing[name];
    data[name].forEach((d, id) => {
      const ref = doc(db, name, id);
      if (name === "receipts" || name === "photos") {
        // Receipts and photos can't be edited, only created, so existing ones are left alone.
        if (!have.has(id)) phases[0].push({ ref, data: d });
        return;
      }
      if (name === "bookedSlots") {
        const ok = ["barberId", "date", "time"].every((k) => typeof d[k] === "string")
          && id === `${d.barberId}_${d.date}_${d.time}`;
        if (!ok) { skipped++; return; }
        // Time slots can't be edited, only created, so existing ones are left alone.
        if (!have.has(id)) phases[0].push({ ref, data: { barberId: d.barberId, date: d.date, time: d.time } });
      } else if (name === "appointments" && !have.has(id)) {
        phases[0].push({ ref, data: appointmentStub(d) });
        phases[1].push({ ref, data: d });
      } else {
        phases[1].push({ ref, data: d });
      }
    });
  });
  return { phases, skipped };
}

async function runRestore() {
  clearNotice();
  if (!window.confirm("Restore this backup?\n\nNothing will be deleted. Anything saved in the backup is put back. A copy of your current data will be downloaded first, just in case.")) return;

  restoreBtn.disabled = true;
  fileInput.disabled = true;
  let done = 0;
  let total = 0;
  let safetyCopySaved = false;
  try {
    progressEl.textContent = "Saving a copy of your current data first...";
    const current = await readAll();
    downloadBackup(current, "before-restore");
    safetyCopySaved = true;

    const existing = {};
    NAMES.forEach((n) => { existing[n] = new Set(current[n].map((x) => x.id)); });
    const { phases, skipped } = buildPlan(pending.data, existing);
    total = phases.reduce((s, p) => s + p.length, 0);

    for (const ops of phases) {
      for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        const slice = ops.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        slice.forEach((op) => batch.set(op.ref, op.data));
        await batch.commit();
        done += slice.length;
        progressEl.textContent = `Restoring... ${done} of ${total}`;
      }
    }

    const restored = Object.keys(pending.data).reduce((s, n) => s + pending.data[n].size, 0) - skipped;
    logActivity("Restored backup", `${restored} records`);
    notify(`Done! ${restored} records were restored. Reload any other open pages to see them.`, "success");
    resetRestore();
  } catch (err) {
    console.error(err);
    const denied = err && err.code === "permission-denied";
    notify(
      (denied ? "A record in the backup was refused by the shop's security rules. " : "Something went wrong. ") +
      (total ? `The restore stopped partway (${done} of ${total}). ` : "Nothing was changed. ") +
      (safetyCopySaved && total ? "The copy of your data from before (before-restore_...json) was downloaded; restore that file to go back." : ""),
      "error"
    );
    progressEl.textContent = "";
    fileInput.disabled = false;
    restoreBtn.disabled = false;
  }
}

restoreBtn.addEventListener("click", runRestore);
$("restore-cancel").addEventListener("click", () => { clearNotice(); resetRestore(); });

// ---------- tabs ----------
const tabs = [...document.querySelectorAll(".tab")];

function showTab(name) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(`panel-${t.dataset.tab}`).hidden = !on;
  });
  try { history.replaceState(null, "", `#${name}`); } catch (e) { /* ignore */ }
}

tabs.forEach((t, i) => {
  t.addEventListener("click", () => showTab(t.dataset.tab));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  });
});

// If one section's file is missing, the others (and backup) still work.
function sectionFailed(panelId, err) {
  console.error(err);
  $(panelId).prepend(el("p", "empty", "This section could not load. Check that all the settings files are in your js folder."));
}

// ---------- init ----------
requireStaff((ctx) => {
  if (!ctx.isAdmin) {
    notify("Only the owner and admins can open Settings.", "error");
    $("settings-body").style.display = "none";
    return;
  }
  // Backup & restore is for the owner only
  if (!ctx.isOwner) {
    const i = tabs.findIndex((t) => t.dataset.tab === "backup");
    if (i >= 0) { tabs[i].remove(); tabs.splice(i, 1); }
    $("panel-backup").remove();
  } else {
    showLastBackup();
  }

  const wanted = location.hash.replace("#", "");
  showTab(tabs.some((t) => t.dataset.tab === wanted) ? wanted : "business");

  import("./settings-business.js").then((m) => m.initBusiness(ctx)).catch((err) => sectionFailed("panel-business", err));
  import("./settings-site.js").then((m) => m.initSite(ctx)).catch((err) => sectionFailed("panel-site", err));
  import("./settings-email.js").then((m) => m.initEmail(ctx)).catch((err) => sectionFailed("panel-email", err));
  import("./settings-activity.js").then((m) => m.initActivity(ctx)).catch((err) => sectionFailed("panel-activity", err));
  import("./settings-accounts.js").then((m) => m.initAccounts(ctx)).catch((err) => sectionFailed("panel-accounts", err));
});
