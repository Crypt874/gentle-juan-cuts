import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, onSnapshot, doc, updateDoc, writeBatch, setDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, peso, label12h, todayStr, cap, phoneKey,
  notify, clearNotice, friendlyError, createQueueEntry, createQueueEntryFull, queueLabel, isBookableBarber, logActivity
} from "./staff-common.js";
import { askPayment, completeEntry, loadOfferedServices } from "./visit.js";

const viewSel = document.getElementById("view");
const dateWrap = document.getElementById("date-wrap");
const dateInput = document.getElementById("filter-date");
const statusSel = document.getElementById("filter-status");
const listBox = document.getElementById("list");

let canEdit = false;
let unsubscribe = null;
let appointments = []; // latest snapshot, each item includes id
let noShows = {};      // customer id (phone key) -> number of earlier no-shows
let barbers = {};      // id -> data (for assigning appointments)
let barberFilter = null; // set for barber logins: their own appointments + unclaimed ones
let myName = "";

// The time-slot lock of a booking. A booking with "any barber" holds the shared "any" lock until someone claims it.
const slotKey = (a) => `${a.barberId || "any"}_${a.date}_${a.time}`;

// ---------- data ----------
function subscribe() {
  if (unsubscribe) unsubscribe();
  clearNotice();
  listBox.replaceChildren(el("p", "empty", "Loading..."));

  const col = collection(db, "appointments");
  const base = viewSel.value === "pending"
    ? where("status", "==", "pending")
    : where("date", "==", dateInput.value);
  const onErr = (err) => {
    console.error(err);
    notify(friendlyError(err), "error");
    listBox.replaceChildren();
  };
  if (barberFilter) {
    // An employee sees their own customers plus the ones nobody has claimed yet.
    const parts = { mine: [], open: [] };
    const take = (key) => (snap) => {
      parts[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      appointments = [...parts.mine, ...parts.open];
      render();
    };
    const u1 = onSnapshot(query(col, base, where("barberId", "==", barberFilter)), take("mine"), onErr);
    const u2 = onSnapshot(query(col, base, where("barberId", "==", "")), take("open"), onErr);
    unsubscribe = () => { u1(); u2(); };
    return;
  }
  unsubscribe = onSnapshot(query(col, base), (snap) => {
    appointments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, onErr);
}

// ---------- actions ----------
async function confirmAppointment(a) {
  clearNotice();
  try {
    await updateDoc(doc(db, "appointments", a.id), { status: "confirmed" });
  } catch (err) {
    notify(friendlyError(err), "error");
    return;
  }
  if (a.customerEmail) await emailCustomer(a, true);
}

// Opens the phone's messaging app with the reminder written.
async function textReminder(a) {
  clearNotice();
  try {
    const { openTextReminder } = await import("./email.js");
    const { getBusiness } = await import("./business.js");
    openTextReminder(a, await getBusiness());
    notify("Your messaging app opened with the reminder. Press Send there.", "success");
  } catch (err) {
    notify("Could not open a text message. Check the customer's contact number.", "error");
  }
}

// Sends the confirmation email (automatic with EmailJS, otherwise opens the email app ready to send).
async function emailCustomer(a, justConfirmed, kind = "confirm") {
  try {
    const { sendConfirmation } = await import("./email.js");
    const { getBusiness } = await import("./business.js");
    const how = await sendConfirmation(a, await getBusiness(), kind);
    notify(how === "sent"
      ? `${kind === "reminder" ? "Reminder" : "Confirmation"} email sent to ${a.customerEmail}.`
      : `Your email app opened with the ${kind === "reminder" ? "reminder" : "confirmation"} for ${a.customerEmail}. Press Send there.`, "success");
  } catch (err) {
    console.error(err);
    notify(`${justConfirmed ? "The appointment is confirmed, but the" : "The"} email could not be sent. Check Settings > Email, or contact the customer directly.`, "error");
  }
}

// The customer didn't come. The time slot is freed and the no-show is counted on the customer.
async function markNoShow(a) {
  if (!window.confirm(`Mark ${a.customerName} (${label12h(a.time)}, ${a.date}) as a no-show?\n\nThe time slot is freed and the no-show is counted on their customer record.`)) return;
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "appointments", a.id), { status: "noshow" });
    batch.delete(doc(db, "bookedSlots", slotKey(a)));
    const key = phoneKey(a.contactNumber);
    if (key) {
      batch.set(doc(db, "customers", key), {
        name: a.customerName, contactNumber: a.contactNumber, facebookProfile: a.facebookProfile || "",
        noShows: increment(1)
      }, { merge: true });
      noShows[key] = (noShows[key] || 0) + 1;
    }
    await batch.commit();
    logActivity("Marked no-show", `${a.customerName}, ${a.date} ${a.time}`);
    notify(`${a.customerName} was marked as a no-show.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

async function cancelAppointment(a) {
  if (!window.confirm(`Cancel the appointment of ${a.customerName} on ${a.date} at ${label12h(a.time)}?`)) return;
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "appointments", a.id), { status: "cancelled" });
    // Free the time slot so someone else can book it.
    batch.delete(doc(db, "bookedSlots", slotKey(a)));
    await batch.commit();
    logActivity("Cancelled appointment", `${a.customerName}, ${a.date} ${a.time}`);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// An employee takes an unclaimed booking: it becomes theirs and is confirmed. The shared "any" time lock is
// swapped for this barber's own lock in one batch, so it fails if they are already booked at that time.
async function claimAppointment(a) {
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "bookedSlots", `${barberFilter}_${a.date}_${a.time}`), {
      barberId: barberFilter, date: a.date, time: a.time, apptId: a.id
    });
    batch.delete(doc(db, "bookedSlots", slotKey(a)));
    batch.update(doc(db, "appointments", a.id), { barberId: barberFilter, barberName: myName, status: "confirmed" });
    await batch.commit();
    logActivity("Claimed a reservation", `${a.customerName}, ${a.date} ${a.time}`);
    notify(`You claimed ${a.customerName} (${label12h(a.time)}, ${a.date}).`, "success");
  } catch (err) {
    if (err.code === "permission-denied") {
      notify(`You are already booked at ${label12h(a.time)} on ${a.date}, or someone else just claimed this one.`, "error");
    } else {
      notify(friendlyError(err), "error");
    }
  }
}

// An employee finishes their reservation: check-in, serve and complete in one go (today's bookings only).
async function finishAppointment(a) {
  clearNotice();
  if (a.date !== todayStr()) return notify("Done is only for today's appointments.", "error");
  const choice = await askPayment({ ...a, queueNumber: 0, servicePrice: a.servicePrice });
  if (!choice) return;
  try {
    const { number, id } = await createQueueEntryFull({
      type: "scheduled", appointmentId: a.id, slotId: slotKey(a), appointmentTime: a.time,
      customerName: a.customerName, contactNumber: a.contactNumber, facebookProfile: a.facebookProfile || "",
      customerEmail: a.customerEmail || "", serviceId: a.serviceId, serviceName: a.serviceName,
      servicePrice: Number(a.servicePrice) || 0, barberId: a.barberId, barberName: a.barberName
    }, a.id);
    await updateDoc(doc(db, "queue", id), { status: "serving", startedAt: serverTimestamp() });
    await completeEntry({
      id, queueNumber: number, date: todayStr(), type: "scheduled", appointmentId: a.id,
      customerName: a.customerName, contactNumber: a.contactNumber, facebookProfile: a.facebookProfile || "",
      serviceId: a.serviceId, serviceName: a.serviceName, servicePrice: Number(a.servicePrice) || 0,
      barberId: a.barberId, barberName: a.barberName
    }, choice);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// Move an appointment to another barber. The new barber's slot is locked first; if that
// barber is already booked at the same time the whole batch is rejected and nothing changes.
async function assignBarber(a, newBarberId) {
  clearNotice();
  const nb = barbers[newBarberId];
  if (!nb) return notify("Select a barber first.", "error");
  if (newBarberId === (a.barberId || "")) return notify("That barber is already assigned.", "error");
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "bookedSlots", `${newBarberId}_${a.date}_${a.time}`), {
      barberId: newBarberId, date: a.date, time: a.time
    });
    batch.delete(doc(db, "bookedSlots", slotKey(a)));
    batch.update(doc(db, "appointments", a.id), { barberId: newBarberId, barberName: nb.name });
    await batch.commit();
    notify(`${a.customerName} is now assigned to ${nb.name}.`, "success");
  } catch (err) {
    if (err.code === "permission-denied") {
      notify(`${nb.name} is already booked at ${label12h(a.time)} on ${a.date}.`, "error");
    } else {
      notify(friendlyError(err), "error");
    }
  }
}

async function checkIn(a) {
  clearNotice();
  if (!a.barberId) {
    notify("Assign a barber first (or wait for a barber to claim this booking).", "error");
    return;
  }
  if (a.date !== todayStr()) {
    notify("Check-in is only for today's appointments.", "error");
    return;
  }
  try {
    const number = await createQueueEntry({
      type: "scheduled",
      appointmentId: a.id,
      slotId: slotKey(a),
      appointmentTime: a.time,
      customerName: a.customerName,
      contactNumber: a.contactNumber,
      facebookProfile: a.facebookProfile || "",
      customerEmail: a.customerEmail || "",
      serviceId: a.serviceId,
      serviceName: a.serviceName,
      servicePrice: Number(a.servicePrice) || 0,
      barberId: a.barberId,
      barberName: a.barberName
    }, a.id);
    notify(`${a.customerName} is now in the queue as ${queueLabel(number)}.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- rendering ----------
function actionButton(text, className, handler) {
  const b = el("button", `btn btn-sm ${className}`, text);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    await handler();
    b.disabled = false;
  });
  return b;
}

function renderCard(a) {
  const card = el("div", "card appt");

  const head = el("div", "appt-head");
  head.append(
    el("h3", "", `${label12h(a.time)} - ${a.customerName}`),
    el("span", `badge st-${a.status}`, a.status === "noshow" ? "No-show" : cap(a.status))
  );
  card.append(head);

  card.append(el("p", "", `${a.serviceName} (${peso.format(Number(a.servicePrice) || 0)}) with ${a.barberId ? a.barberName : "any barber (not claimed yet)"}`));
  card.append(el("p", "", `Date: ${a.date}  |  Contact: ${a.contactNumber}`));
  if (a.customerEmail) card.append(el("p", "", `Email: ${a.customerEmail}`));
  if (a.facebookProfile) card.append(el("p", "", `Facebook/Messenger: ${a.facebookProfile}`));
  if (a.queueId) card.append(el("p", "ok-text", "Checked in - see the Queue page"));
  const earlier = noShows[phoneKey(a.contactNumber)] || 0;
  if (canEdit && earlier >= 1 && (a.status === "pending" || a.status === "confirmed")) {
    card.append(el("p", "warn-text", `Warning: ${earlier} earlier no-show${earlier === 1 ? "" : "s"} for this customer`));
  }
  if (a.status === "cancelled" && a.cancelledBy === "customer") card.append(el("p", "muted", "Cancelled by the customer"));

  if (barberFilter && !a.queueId && (a.status === "pending" || a.status === "confirmed")) {
    const actions = el("div", "actions");
    if (!a.barberId) {
      actions.append(actionButton("Claim", "", () => claimAppointment(a)));
    } else {
      actions.append(actionButton("Done", "", () => finishAppointment(a)));
      actions.append(actionButton("Cancel", "btn-danger", () => cancelAppointment(a)));
    }
    card.append(actions);
  }

  if (canEdit && !a.queueId) {
    const actions = el("div", "actions");
    if (a.status === "pending") {
      actions.append(actionButton("Confirm", "", () => confirmAppointment(a)));
    }
    if (a.status === "confirmed") {
      actions.append(actionButton("Check in", "", () => checkIn(a)));
      if (a.customerEmail) actions.append(actionButton("Email confirmation", "btn-outline", () => emailCustomer(a, false)));
      actions.append(actionButton("Text reminder", "btn-outline", () => textReminder(a)));
      if (a.customerEmail) actions.append(actionButton("Email reminder", "btn-outline", () => emailCustomer(a, false, "reminder")));
    }
    if (a.status === "confirmed" && a.date <= todayStr()) {
      actions.append(actionButton("No-show", "btn-outline", () => markNoShow(a)));
    }
    if (a.status === "pending" || a.status === "confirmed") {
      actions.append(actionButton("Cancel", "btn-danger", () => cancelAppointment(a)));
    }
    if (actions.children.length) card.append(actions);

    if (a.status === "pending" || a.status === "confirmed") {
      const assign = el("div", "actions");
      const sel = document.createElement("select");
      sel.className = "inline-select";
      sel.setAttribute("aria-label", "Assign barber");
      const first = document.createElement("option");
      first.value = "";
      first.textContent = "Assign to barber...";
      sel.append(first);
      const others = Object.entries(barbers)
        .filter(([id, b]) => id !== a.barberId && isBookableBarber(b));
      others.forEach(([id, b]) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = b.name;
        sel.append(o);
      });
      const assignBtn = actionButton("Assign", "btn-outline", () => assignBarber(a, sel.value));
      if (!others.length) {
        first.textContent = "No other barbers available";
        sel.disabled = true;
        assignBtn.disabled = true;
      }
      assign.append(sel, assignBtn);
      card.append(assign);
    }
  }
  return card;
}

function render() {
  const filter = statusSel.value;
  const rows = appointments
    .filter((a) => filter === "all" || a.status === filter)
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));

  listBox.replaceChildren();
  if (!rows.length) {
    listBox.append(el("p", "empty", "No appointments found."));
    return;
  }
  rows.forEach((a) => listBox.append(renderCard(a)));
}

// ---------- init ----------
requireStaff(async (ctx) => {
  canEdit = ctx.canEdit;
  dateInput.value = todayStr();

  if (ctx.isBarber) {
    if (!ctx.profile.barberId) {
      notify("Your login isn't linked to a barber profile yet. Please ask the admin.", "error");
      listBox.replaceChildren(el("p", "empty", "No appointments to show."));
      return;
    }
    barberFilter = ctx.profile.barberId;
    myName = ctx.profile.name || "Barber";
    getDocs(query(collection(db, "barbers"), orderBy("name"))).then((sn) => {
      const b = sn.docs.find((d) => d.id === barberFilter);
      if (b) myName = b.data().name || myName;
    }).catch(() => {});
    loadOfferedServices();
  }

  if (canEdit) {
    try {
      const snap = await getDocs(query(collection(db, "barbers"), orderBy("name")));
      snap.forEach((d) => (barbers[d.id] = d.data()));
    } catch (err) {
      console.error(err);
    }
    try {
      const cs = await getDocs(collection(db, "customers"));
      cs.forEach((d) => { if (d.data().noShows) noShows[d.id] = Number(d.data().noShows) || 0; });
    } catch (err) {
      console.error(err);
    }
  }

  viewSel.addEventListener("change", () => {
    dateWrap.style.display = viewSel.value === "date" ? "" : "none";
    subscribe();
  });
  dateInput.addEventListener("change", () => { if (dateInput.value) subscribe(); });
  statusSel.addEventListener("change", render);

  subscribe();
});