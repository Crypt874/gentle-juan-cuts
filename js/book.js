import { db, SHOP } from "./firebase-config.js";
import "./appcheck.js";
import { closedDateMap } from "./business.js";
import {
  collection, getDocs, query, where, orderBy,
  doc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let closedDates = new Map(); // holidays from Settings > Business profile
const form = $("booking-form");
const serviceSel = $("service");
const barberSel = $("barber");
const dateInput = $("date");
const timeGrid = $("time-grid");
const timeHint = $("time-hint");
const msg = $("message");
const submitBtn = $("submit-btn");

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

let services = {}; // id -> data
let barbers = {};  // id -> data

// ---------- helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function label12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

function allSlots() {
  const slots = [];
  for (let mins = SHOP.openHour * 60; mins < SHOP.closeHour * 60; mins += SHOP.slotMinutes) {
    slots.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  }
  return slots;
}

function showMessage(text, type) {
  msg.textContent = text;
  msg.className = `message show ${type}`;
}

function clearMessage() {
  msg.className = "message";
  msg.textContent = "";
}

function fillSelect(select, placeholder, items, labelFn) {
  select.replaceChildren();
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.append(first);
  items.forEach(([id, data]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = labelFn(data);
    select.append(opt);
  });
}

// ---------- load services & barbers ----------
async function loadOptions() {
  try {
    const [sSnap, bSnap] = await Promise.all([
      getDocs(query(collection(db, "services"), orderBy("name"))),
      getDocs(query(collection(db, "barbers"), orderBy("name")))
    ]);
    sSnap.forEach((d) => (services[d.id] = d.data()));
    bSnap.forEach((d) => (barbers[d.id] = d.data()));

    fillSelect(serviceSel, "Select a service",
      Object.entries(services).filter(([, sv]) => sv.status !== "unavailable"),
      (s) => `${s.name} - ${peso.format(Number(s.price) || 0)}`);

    const available = Object.entries(barbers).filter(([, b]) => b.active !== false && b.status !== "off");
    fillSelect(barberSel, "Select a barber", available, (b) => b.name);
    const any = document.createElement("option");
    any.value = "any";
    any.textContent = "Any barber (no preference)";
    barberSel.insertBefore(any, barberSel.children[1]);
  } catch (err) {
    console.error(err);
    showMessage("Could not load services and barbers. Check your Firebase config and rules.", "error");
  }
}

// ---------- time slots ----------
async function renderTimes() {
  const barberId = barberSel.value;
  const date = dateInput.value;
  timeGrid.replaceChildren();

  if (!barberId || !date) {
    timeHint.textContent = "Choose a barber and date to see open times.";
    return;
  }

  const day = new Date(`${date}T00:00:00`).getDay();
  if (closedDates.has(date)) {
    const why = closedDates.get(date);
    timeHint.textContent = `The shop is closed on that date${why ? ` (${why})` : ""}. Please pick another date.`;
    return;
  }
  if (SHOP.closedWeekdays.includes(day)) {
    timeHint.textContent = "The shop is closed on that day. Please pick another date.";
    return;
  }

  timeHint.textContent = "Checking availability...";

  let taken = new Set();
  try {
    const snap = await getDocs(query(
      collection(db, "bookedSlots"),
      where("barberId", "==", barberId),
      where("date", "==", date)
    ));
    snap.forEach((d) => taken.add(d.data().time));
  } catch (err) {
    console.error(err);
    timeHint.textContent = "Could not check availability. Try again.";
    return;
  }

  const now = new Date();
  const isToday = date === todayStr();
  let openCount = 0;

  allSlots().forEach((slot) => {
    const [h, m] = slot.split(":").map(Number);
    const past = isToday && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes());
    const disabled = taken.has(slot) || past;
    if (!disabled) openCount++;

    const wrap = document.createDocumentFragment();
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "time";
    input.id = `t-${slot.replace(":", "")}`;
    input.value = slot;
    input.disabled = disabled;
    const lab = document.createElement("label");
    lab.htmlFor = input.id;
    lab.textContent = label12h(slot);
    wrap.append(input, lab);
    timeGrid.append(wrap);
  });

  timeHint.textContent = openCount
    ? "Greyed-out times are already taken."
    : "No open times left for that barber on this date. Try another day or barber.";
}

// ---------- submit ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const name = $("name").value.trim();
  const contact = $("contact").value.trim();
  const facebook = $("facebook").value.trim();
  const email = $("email").value.trim();
  const serviceId = serviceSel.value;
  const barberId = barberSel.value;
  const date = dateInput.value;
  const time = (form.querySelector('input[name="time"]:checked') || {}).value;

  if (name.length < 2) return showMessage("Please enter your full name.", "error");
  if (!/^[0-9+\-\s()]{7,20}$/.test(contact)) return showMessage("Please enter a valid contact number.", "error");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMessage("Please enter a valid email address, or leave it blank.", "error");
  if (!serviceId) return showMessage("Please select a service.", "error");
  if (!barberId) return showMessage("Please select a barber.", "error");
  if (!date || date < todayStr()) return showMessage("Please pick a valid date.", "error");
  if (!time) return showMessage("Please select a time.", "error");

  const service = services[serviceId];
  const isAny = barberId === "any";
  const barber = isAny ? { name: "Any barber" } : barbers[barberId];

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    // Two writes in one batch: the appointment + the slot lock.
    // If someone already took the slot, the lock write is denied and nothing is saved.
    const batch = writeBatch(db);
    const apptRef = doc(collection(db, "appointments"));
    const slotRef = doc(db, "bookedSlots", `${barberId}_${date}_${time}`);

    batch.set(apptRef, {
      customerName: name,
      contactNumber: contact,
      facebookProfile: facebook,
      ...(email ? { customerEmail: email } : {}),
      serviceId,
      serviceName: service.name,
      servicePrice: Number(service.price) || 0,
      barberId: isAny ? "" : barberId,
      barberName: barber.name,
      date,
      time,
      status: "pending",
      createdAt: serverTimestamp()
    });
    batch.set(slotRef, { barberId, date, time, apptId: apptRef.id });

    await batch.commit();
    showSuccess({ name, service: service.name, barber: barber.name, date, time, id: apptRef.id });
  } catch (err) {
    console.error(err);
    if (err.code === "permission-denied") {
      showMessage("That time was just booked by someone else. Please pick another time.", "error");
      renderTimes();
    } else {
      showMessage("Something went wrong. Please try again.", "error");
    }
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Appointment";
  }
});

function showSuccess(info) {
  form.style.display = "none";
  document.querySelector(".form-card > h1").style.display = "none";
  document.querySelector(".form-card > .hint").style.display = "none";
  $("success-box").style.display = "block";

  const rows = [
    ["Name", info.name],
    ["Service", info.service],
    ["Barber", info.barber],
    ["Date", info.date],
    ["Time", label12h(info.time)],
    ["Status", "Pending"]
  ];
  // Private link to check or cancel this booking later
  const link = new URL(`check.html?id=${encodeURIComponent(info.id)}`, location.href).href;
  try { localStorage.setItem("gjc:lastBooking", info.id); } catch (e) { /* storage unavailable */ }
  $("track-link").value = link;
  $("track-open").href = link;
  $("track-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); $("track-copy").textContent = "Copied!"; }
    catch (e) { $("track-link").select(); }
  });
  const dl = $("summary");
  dl.replaceChildren();
  rows.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  });
}

// ---------- init ----------
dateInput.min = todayStr();

// Opening hours, slot length and closed days come from Settings > Business profile.
// If they can't be loaded, the defaults in firebase-config.js are used.
import("./business.js")
  .then((m) => m.getBusiness())
  .then((biz) => {
    SHOP.openHour = biz.openHour;
    SHOP.closeHour = biz.closeHour;
    SHOP.slotMinutes = biz.slotMinutes;
    SHOP.closedWeekdays = biz.closedWeekdays || [];
    closedDates = closedDateMap(biz);
    if (barberSel.value && dateInput.value) renderTimes();
  })
  .catch((err) => console.error(err));
barberSel.addEventListener("change", renderTimes);
dateInput.addEventListener("change", renderTimes);
loadOptions();
