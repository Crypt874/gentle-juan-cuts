// Shared helpers for all staff pages (appointments, queue, ...)
import { auth, db } from "./firebase-config.js";
import "./appcheck.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, runTransaction, serverTimestamp, addDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

// Build DOM nodes with textContent (never innerHTML with database values).
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function pad(n) { return String(n).padStart(2, "0"); }

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function label12h(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function queueLabel(n) { return `#${String(n).padStart(3, "0")}`; }

// "2026-10-08" -> "10/08/26"
export function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : (ymd || "");
}

// Barber day-to-day status: available | busy | off ("break" was an older value and counts as busy)
export function barberStatus(b) {
  const s = b && b.status;
  if (s === "available" || s === "busy" || s === "off") return s;
  if (s === "break") return "busy";
  return "available";
}
export const BARBER_STATUS_LABEL = { available: "Available", busy: "Busy", off: "Off duty" };

// Barbers that customers/staff can pick for new bookings
export function isBookableBarber(b) {
  return b.active !== false && barberStatus(b) !== "off";
}
// Services that are offered (missing status counts as available)
export function isOfferedService(s) {
  return s.status !== "unavailable";
}

export const PAYMENT_METHODS = ["Cash", "GCash", "Card", "Other"];

export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

// Turns "+63 912 345 6789" and "0912-345-6789" into the same key: "09123456789".
// Used as the customer ID so repeat customers stay together.
export function phoneKey(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2);
  return d.length >= 7 ? d : "";
}

export function notify(text, type = "error") {
  const box = document.getElementById("message");
  if (!box) return;
  box.textContent = text;
  box.className = `message show ${type}`;
}

export function clearNotice() {
  const box = document.getElementById("message");
  if (!box) return;
  box.textContent = "";
  box.className = "message";
}

export function friendlyError(err) {
  if (err && err.code === "permission-denied") return "You don't have permission to do that.";
  if (err && err.message === "already-in-queue") return "That customer is already in the queue.";
  if (err && err.message === "not-confirmed") return "Only confirmed appointments can be checked in.";
  if (err && err.message === "not-serving") return "That customer is no longer being served. The page will refresh.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

// ---------- Activity log ----------
// Records who did something important (accounts, prices, settings, expenses ...). Best effort:
// if it can't be saved, the action itself is not affected. Owner/admin read it in Settings > Activity log.
let currentProfile = null;
export async function logActivity(action, detail = "") {
  try {
    const u = auth.currentUser;
    if (!u) return;
    await addDoc(collection(db, "activity"), {
      at: serverTimestamp(),
      uid: u.uid,
      name: (currentProfile && (currentProfile.name || currentProfile.email)) || u.email || "",
      role: (currentProfile && currentProfile.role) || "",
      action: String(action).slice(0, 80),
      detail: String(detail || "").slice(0, 300)
    });
  } catch (err) {
    console.error(err);
  }
}

// ---------- Auth guard + nav ----------
// Roles:
//   owner    = the shop owner: everything, including backup/restore and managing admins
//   admin    = manager: everything except backup/restore; can manage staff and employee accounts only
//   staff    = front desk: appointments, queue, receipts, customers; services and barbers are view-only
//   employee = a barber: only their own appointments, queue and dashboard (view only)
// (older accounts saved as "barber" are treated as employees)
// PAGE_ACCESS below uses "access levels": owner counts as "admin", employee counts as "barber".
export const ROLE_LABEL = { owner: "Owner", admin: "Admin", staff: "Staff", employee: "Employee" };
export const normRole = (r) => (r === "barber" ? "employee" : r);
const levelOf = (role) => ({ owner: "admin", admin: "admin", staff: "staff", employee: "barber" }[role]);

export const PAGE_ACCESS = {
  "dashboard.html": ["admin", "staff", "barber"],
  "appointments.html": ["admin", "staff", "barber"],
  "queue.html": ["admin", "staff", "barber"],
  "board.html": ["admin", "staff"],
  "receipts.html": ["admin", "staff"],
  "customers.html": ["admin", "staff"],
  "services.html": ["admin", "staff"],
  "barbers.html": ["admin", "staff"],
  "sales.html": ["admin"],
  "finance.html": ["admin"],
  "earnings.html": ["barber"],
  "settings.html": ["admin"]
};

const NAV_LINKS = [
  ["dashboard.html", "Dashboard"],
  ["appointments.html", "Appointments"],
  ["queue.html", "Queue"],
  ["receipts.html", "Receipts"],
  ["customers.html", "Customers"],
  ["services.html", "Services"],
  ["barbers.html", "Barbers"],
  ["sales.html", "Sales"],
  ["finance.html", "Finance"],
  ["earnings.html", "My earnings"],
  ["settings.html", "Settings"]
];

function roleCanOpen(role, page) {
  return (PAGE_ACCESS[page] || ["admin"]).includes(levelOf(role));
}

function renderNav(profile) {
  const nav = document.getElementById("staff-nav");
  if (!nav) return;
  nav.replaceChildren();
  const page = location.pathname.split("/").pop();
  NAV_LINKS.filter(([href]) => roleCanOpen(profile.role, href)).forEach(([href, text]) => {
    const a = el("a", page === href ? "active" : "", text);
    a.href = href;
    nav.append(a);
  });
  // Opens the customer website in a new tab, so changes can be checked without logging out.
  const site = el("a", "nav-site", "View website");
  site.href = "../index.html";
  site.target = "_blank";
  site.rel = "noopener";
  site.title = "See the customer website in a new tab";
  nav.append(site);
  nav.append(el("span", "who", `${profile.name || profile.email || "Staff"} (${ROLE_LABEL[profile.role] || profile.role})`));
  const out = el("button", "btn btn-outline btn-sm", "Log out");
  out.type = "button";
  out.addEventListener("click", async () => {
    if (!window.confirm("Log out of The Gentle Juan Cuts?")) return;
    await signOut(auth);
    location.replace("login.html");
  });
  nav.append(out);
}

// Calls onReady({ user, profile, canEdit, isAdmin, isBarber }) once a signed-in team member is confirmed.
// admin and staff can edit; barbers get a read-only view of their own work.
// A turned-off account (active: false) is signed out, and a role can't open pages it has no access to.
export function requireStaff(onReady) {
  let started = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.replace("login.html");
      return;
    }
    let profile = null;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      profile = snap.exists() ? snap.data() : null;
    } catch (err) {
      console.error(err);
    }
    if (profile) profile = { ...profile, role: normRole(profile.role) };
    if (!profile || !["owner", "admin", "staff", "employee"].includes(profile.role)) {
      await signOut(auth);
      location.replace("login.html?error=norole");
      return;
    }
    if (profile.active === false) {
      await signOut(auth);
      location.replace("login.html?error=disabled");
      return;
    }
    const page = location.pathname.split("/").pop();
    if (page && !roleCanOpen(profile.role, page)) {
      location.replace("appointments.html");
      return;
    }
    if (started) return;
    started = true;
    currentProfile = profile;
    renderNav(profile);
    const flags = {
      user,
      profile,
      canEdit: ["owner", "admin", "staff"].includes(profile.role),
      isOwner: profile.role === "owner",
      isAdmin: ["owner", "admin"].includes(profile.role), // management: owner or admin
      isBarber: profile.role === "employee",              // employees are the barbers
      isEmployee: profile.role === "employee",
      level: levelOf(profile.role)
    };
    onReady(flags);
    import("./alerts.js").then((m) => m.startAlerts(flags)).catch((e) => console.error(e));
  });
}

// ---------- Queue numbering ----------
// Adds a customer to TODAY's queue with the next number (#001, #002, ...).
// If appointmentId is given, the appointment is marked as checked in (queueId) in the same transaction.
export async function createQueueEntry(entry, appointmentId) {
  return (await createQueueEntryFull(entry, appointmentId)).number;
}

// Same, but also returns the new queue document id.
export async function createQueueEntryFull(entry, appointmentId) {
  const date = todayStr();
  return runTransaction(db, async (tx) => {
    let apptRef = null;
    if (appointmentId) {
      apptRef = doc(db, "appointments", appointmentId);
      const apptSnap = await tx.get(apptRef);
      if (!apptSnap.exists()) throw new Error("missing-appointment");
      const cur = apptSnap.data();
      if (cur.queueId) throw new Error("already-in-queue");
      if (cur.status !== "confirmed") throw new Error("not-confirmed");
    }

    const counterRef = doc(db, "counters", `queue_${date}`);
    const counterSnap = await tx.get(counterRef);
    const next = (counterSnap.exists() ? counterSnap.data().last : 0) + 1;

    const queueRef = doc(collection(db, "queue"));
    tx.set(counterRef, { last: next });
    tx.set(queueRef, {
      ...entry,
      queueNumber: next,
      date,
      status: "waiting",
      createdAt: serverTimestamp()
    });
    if (apptRef) tx.update(apptRef, { queueId: queueRef.id });
    return { number: next, id: queueRef.id };
  });
}