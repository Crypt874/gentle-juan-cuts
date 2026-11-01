// Customer page: check the status of a booking with its private link/code, or cancel it.
import { db } from "./firebase-config.js";
import "./appcheck.js";
import { getBusiness } from "./business.js";
import { doc, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const label12h = (t) => { const [h, m] = String(t).split(":").map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`; };
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

let current = null;
let cutoffHours = 0; // { id, data }

function say(text, type) {
  const box = $("message");
  box.textContent = text;
  box.className = text ? `message show ${type}` : "message";
}

// Accepts a full link or just the code.
function idFrom(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const id = u.searchParams.get("id");
    if (id) return id;
  } catch (e) { /* not a link */ }
  return raw;
}

const NOTES = {
  pending: ["Waiting for confirmation", "The shop hasn't confirmed your appointment yet. Please check again later."],
  confirmed: ["Confirmed", "Your appointment is confirmed. See you then!"],
  completed: ["Completed", "Thank you for visiting The Gentle Juan Cuts!"],
  cancelled: ["Cancelled", "This booking was cancelled."]
};

function show(id, a) {
  current = { id, data: a };
  const inQueue = !!a.queueId;
  const [title, note] = inQueue && a.status === "confirmed"
    ? ["Checked in", "You're checked in. Please wait for your number to be called."]
    : (NOTES[a.status] || ["Booking", ""]);
  $("r-status-title").textContent = title;
  const badge = $("r-badge");
  badge.textContent = a.status.charAt(0).toUpperCase() + a.status.slice(1);
  badge.className = `badge st-${a.status}`;
  $("r-note").textContent = note + (a.status === "cancelled" && a.cancelledBy === "customer" ? " (You cancelled it.)" : "");

  const rows = [
    ["Name", a.customerName],
    ["Service", `${a.serviceName} (${peso.format(Number(a.servicePrice) || 0)})`],
    ["Barber", a.barberName],
    ["Date", a.date],
    ["Time", label12h(a.time)]
  ];
  const dl = $("r-summary");
  dl.replaceChildren();
  rows.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  });

  const startMs = new Date(`${a.date}T${a.time}:00+08:00`).getTime();
  const tooLate = cutoffHours > 0 && Date.now() > startMs - cutoffHours * 3600000;
  const canCancel = (a.status === "pending" || a.status === "confirmed") && !inQueue && a.date >= todayStr() && !tooLate;
  $("cancel-btn").style.display = canCancel ? "" : "none";
  if (tooLate && (a.status === "pending" || a.status === "confirmed") && !inQueue) {
    $("r-note").textContent += ` Online cancellation closes ${cutoffHours} hour(s) before the appointment. Please contact the shop.`;
  }
  $("result").style.display = "";
}

async function lookup(raw) {
  say("", "");
  $("result").style.display = "none";
  const id = idFrom(raw);
  if (!/^[A-Za-z0-9]{15,40}$/.test(id)) return say("That doesn't look like a booking link or code. Please check it and try again.", "error");
  try {
    cutoffHours = Number((await getBusiness()).cancelCutoffHours) || 0;
    const snap = await getDoc(doc(db, "appointments", id));
    if (!snap.exists()) return say("We couldn't find that booking. Please check the link, or contact the shop.", "error");
    show(id, snap.data());
  } catch (err) {
    console.error(err);
    say("We couldn't find that booking. Please check the link, or contact the shop.", "error");
  }
}

$("find-form").addEventListener("submit", (e) => { e.preventDefault(); lookup($("code").value); });

$("cancel-btn").addEventListener("click", async () => {
  if (!current) return;
  const a = current.data;
  if (!window.confirm(`Cancel your ${a.serviceName} appointment on ${a.date} at ${label12h(a.time)}?`)) return;
  const btn = $("cancel-btn");
  btn.disabled = true;
  say("", "");
  try {
    // Marks the booking cancelled and frees the time for others, in one step.
    const batch = writeBatch(db);
    batch.update(doc(db, "appointments", current.id), { status: "cancelled", cancelledBy: "customer" });
    batch.delete(doc(db, "bookedSlots", `${a.barberId || "any"}_${a.date}_${a.time}`));
    await batch.commit();
    say("Your booking was cancelled.", "success");
    await lookup(current.id);
    say("Your booking was cancelled.", "success");
  } catch (err) {
    console.error(err);
    say("We couldn't cancel it online (it may already be checked in or changed). Please contact the shop.", "error");
  }
  btn.disabled = false;
});

// Opened from the booking link, or remembers the last booking made on this device.
const fromUrl = new URLSearchParams(location.search).get("id");
let last = "";
try { last = localStorage.getItem("gjc:lastBooking") || ""; } catch (e) { /* ignore */ }
if (fromUrl) { $("code").value = fromUrl; lookup(fromUrl); }
else if (last) { $("code").value = last; lookup(last); }
