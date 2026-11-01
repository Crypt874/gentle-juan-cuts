import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, getDoc, setDoc, onSnapshot, doc, updateDoc,
  writeBatch, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, peso, label12h, todayStr, cap, phoneKey, queueLabel,
  notify, clearNotice, friendlyError, createQueueEntry, isBookableBarber, isOfferedService, logActivity
} from "./staff-common.js";
import { loadOfferedServices, completeEntry, itemsOf, receiptRecord } from "./visit.js";

const colWaiting = document.getElementById("col-waiting");
const colServing = document.getElementById("col-serving");
const colDone = document.getElementById("col-done");

let canEdit = false;
let myBarberId = "";
let myName = "";
let isAdmin = false;   // owner/admin may step in; staff may not change a barber's customer
const parts = { mine: [], open: [] }; // an employee's two lists: own customers + unclaimed ones
let redraw = () => {};   // set for employee logins
let barberList = {};   // id -> data, for assigning unclaimed customers (owner/admin/staff)

// Staff can act on everyone; an employee only on their own customers.
const canAct = (q) => isAdmin || (!!myBarberId && q.barberId === myBarberId);
const isUnclaimed = (q) => !q.barberId;

// ---------- actions ----------
async function startServing(q) {
  clearNotice();
  try {
    await updateDoc(doc(db, "queue", q.id), { status: "serving", startedAt: serverTimestamp() });
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// An employee takes an unclaimed customer.
async function claimEntry(q) {
  clearNotice();
  try {
    await updateDoc(doc(db, "queue", q.id), { barberId: myBarberId, barberName: myName });
    // show it at once under "mine" (the live lists confirm it a moment later)
    parts.open = parts.open.filter((x) => x.id !== q.id);
    parts.mine = [...parts.mine.filter((x) => x.id !== q.id), { ...q, barberId: myBarberId, barberName: myName }];
    redraw();
    logActivity("Claimed a walk-in", `${queueLabel(q.queueNumber)} ${q.customerName}`);
    notify(`You claimed ${q.customerName}. You can now start serving, finish or cancel them.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// Owner/admin/staff give an unclaimed customer to a barber.
async function assignEntry(q, barberId) {
  clearNotice();
  const b = barberList[barberId];
  if (!b) return notify("Select a barber first.", "error");
  try {
    await updateDoc(doc(db, "queue", q.id), { barberId, barberName: b.name });
    if (q.appointmentId) await updateDoc(doc(db, "appointments", q.appointmentId), { barberId, barberName: b.name });
    logActivity("Assigned a customer", `${queueLabel(q.queueNumber)} ${q.customerName} to ${b.name}`);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

async function cancelEntry(q) {
  if (!window.confirm(`Cancel ${queueLabel(q.queueNumber)} - ${q.customerName}?`)) return;
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "queue", q.id), { status: "cancelled", completedAt: serverTimestamp() });
    if (q.appointmentId) {
      batch.update(doc(db, "appointments", q.appointmentId), { status: "cancelled" });
      if (q.slotId) batch.delete(doc(db, "bookedSlots", q.slotId));
    }
    await batch.commit();
    logActivity("Cancelled queue entry", `${queueLabel(q.queueNumber)} ${q.customerName}`);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

async function viewReceipt(q, print = false) {
  const rec = receiptRecord(q);
  let data = null;
  try {
    const snap = await getDoc(doc(db, "receipts", rec.receiptNo));
    if (snap.exists()) data = snap.data();
  } catch (err) {
    console.error(err);
  }
  if (!data) {
    data = { ...rec, completedAt: q.completedAt || null };
    try {
      await setDoc(doc(db, "receipts", rec.receiptNo), { ...rec, completedAt: q.completedAt || serverTimestamp(), createdAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
    }
  }
  const { showReceipt } = await import("./receipt-view.js");
  await showReceipt(data, { print });
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

// Dropdown + button for giving a customer to a barber (owner/admin/staff).
function assignControls(q, placeholder, buttonText) {
  const sel = document.createElement("select");
  sel.className = "inline-select";
  sel.setAttribute("aria-label", "Assign barber");
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  sel.append(first);
  Object.entries(barberList).filter(([id, b]) => isBookableBarber(b) && id !== q.barberId).forEach(([id, b]) => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = b.name;
    sel.append(o);
  });
  return [sel, actionButton(buttonText, "btn-outline", () => assignEntry(q, sel.value))];
}

function renderCard(q) {
  const card = el("div", `card qcard q-${q.status}`);

  const head = el("div", "appt-head");
  head.append(
    el("h3", "", `${queueLabel(q.queueNumber)} - ${q.customerName}`),
    el("span", `badge st-${q.status}`, cap(q.status))
  );
  card.append(head);

  const its = itemsOf(q);
  card.append(el("p", "", `${its.map((i) => i.name).join(" + ")} (${peso.format(its.reduce((t, i) => t + i.price, 0))})`));
  card.append(el("p", isUnclaimed(q) ? "warn-text" : "", isUnclaimed(q) ? "Barber: Any barber (not claimed yet)" : `Barber: ${q.barberName}`));
  const typeText = q.type === "scheduled"
    ? `Scheduled${q.appointmentTime ? " for " + label12h(q.appointmentTime) : ""}`
    : "Walk-in";
  card.append(el("p", "muted", typeText));

  if (isUnclaimed(q) && q.status === "waiting") {
    const actions = el("div", "actions");
    if (myBarberId) {
      actions.append(actionButton("Claim", "", () => claimEntry(q)));
    } else if (canEdit) {
      actions.append(...assignControls(q, "Assign to barber...", "Assign"));
      actions.append(actionButton("Cancel", "btn-danger", () => cancelEntry(q)));
    }
    if (actions.children.length) card.append(actions);
  } else if (canAct(q) && !isUnclaimed(q)) {
    const actions = el("div", "actions");
    if (q.status === "waiting") {
      actions.append(actionButton("Start serving", "", () => startServing(q)));
      actions.append(actionButton("Cancel", "btn-danger", () => cancelEntry(q)));
    } else if (q.status === "serving") {
      actions.append(actionButton(canEdit ? "Complete" : "Done", "", () => completeEntry(q)));
      actions.append(actionButton("Cancel", "btn-danger", () => cancelEntry(q)));
    }
    if (actions.children.length) card.append(actions);
  } else if (canEdit && !isUnclaimed(q) && (q.status === "waiting" || q.status === "serving")) {
    // Staff can't change a barber's customer; they can only move a waiting one to another barber.
    card.append(el("p", "muted", `Only ${q.barberName} can ${q.status === "waiting" ? "start, finish or cancel" : "finish or cancel"} this customer.`));
    if (q.status === "waiting") {
      const actions = el("div", "actions");
      actions.append(...assignControls(q, "Move to another barber...", "Move"));
      card.append(actions);
    }
  }

  // Every finished customer gets a receipt (staff see all; a barber sees their own customers')
  if (q.status === "completed" && (canEdit || (myBarberId && q.barberId === myBarberId))) {
    const receiptRow = el("div", "actions");
    const mk = (text, print) => {
      const rb = el("button", "btn btn-sm btn-outline", text);
      rb.type = "button";
      rb.addEventListener("click", async () => {
        rb.disabled = true;
        try {
          await viewReceipt(q, print);
        } catch (err) {
          console.error(err);
          notify("The receipt could not be opened. Check that receipt-view.js, receipt.js and logo.js are in your js folder.", "error");
        }
        rb.disabled = false;
      });
      return rb;
    };
    receiptRow.append(mk("View receipt", false), mk("Print receipt", true));
    card.append(receiptRow);
  }
  return card;
}

function fillColumn(box, countId, items, emptyText) {
  box.replaceChildren();
  document.getElementById(countId).textContent = items.length;
  if (!items.length) box.append(el("p", "empty", emptyText));
  items.forEach((q) => box.append(renderCard(q)));
}

function render(entries) {
  const byNumber = (a, b) => a.queueNumber - b.queueNumber;
  fillColumn(colWaiting, "count-waiting", entries.filter((q) => q.status === "waiting").sort(byNumber), "Nobody waiting.");
  fillColumn(colServing, "count-serving", entries.filter((q) => q.status === "serving").sort(byNumber), "Nobody being served.");
  fillColumn(colDone, "count-done",
    entries.filter((q) => q.status === "completed" || q.status === "cancelled").sort((a, b) => b.queueNumber - a.queueNumber),
    "No finished customers yet.");
}

// ---------- walk-in form ----------
async function setupWalkInForm() {
  document.getElementById("walkin-card").style.display = "";
  const serviceSel = document.getElementById("w-service");
  const barberSel = document.getElementById("w-barber");
  const services = {};
  const barbers = {};

  function fill(select, placeholder, entries, labelFn) {
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.append(first);
    entries.forEach(([id, data]) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = labelFn(data);
      select.append(o);
    });
  }

  try {
    const [sSnap, bSnap] = await Promise.all([
      getDocs(query(collection(db, "services"), orderBy("name"))),
      getDocs(query(collection(db, "barbers"), orderBy("name")))
    ]);
    sSnap.forEach((d) => (services[d.id] = d.data()));
    bSnap.forEach((d) => (barbers[d.id] = d.data()));
    fill(serviceSel, "Select a service",
      Object.entries(services).filter(([, sv]) => isOfferedService(sv)),
      (s) => `${s.name} - ${peso.format(Number(s.price) || 0)}`);
    fill(barberSel, "Select a barber",
      Object.entries(barbers).filter(([, b]) => isBookableBarber(b)), (b) => b.name);
    const any = document.createElement("option");
    any.value = "any";
    any.textContent = "Any barber (no preference)";
    barberSel.insertBefore(any, barberSel.children[1]);
    barberList = barbers;
  } catch (err) {
    notify(friendlyError(err), "error");
  }

  const form = document.getElementById("walkin-form");
  const btn = document.getElementById("w-btn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearNotice();
    const name = document.getElementById("w-name").value.trim();
    const contact = document.getElementById("w-contact").value.trim();
    const serviceId = serviceSel.value;
    const barberId = barberSel.value;

    if (name.length < 2) return notify("Please enter the customer's name.", "error");
    if (contact && !phoneKey(contact)) return notify("That contact number doesn't look right.", "error");
    if (!serviceId) return notify("Please select a service.", "error");
    if (!barberId) return notify("Please select a barber, or \"Any barber\".", "error");

    btn.disabled = true;
    try {
      const number = await createQueueEntry({
        type: "walk-in",
        appointmentId: "",
        slotId: "",
        appointmentTime: "",
        customerName: name,
        contactNumber: contact,
        facebookProfile: "",
        serviceId,
        serviceName: services[serviceId].name,
        servicePrice: Number(services[serviceId].price) || 0,
        barberId: barberId === "any" ? "" : barberId,
        barberName: barberId === "any" ? "Any barber" : barbers[barberId].name
      }, null);
      form.reset();
      notify(`${name} was added as ${queueLabel(number)}.`, "success");
    } catch (err) {
      notify(friendlyError(err), "error");
    }
    btn.disabled = false;
  });
}

// ---------- init ----------
let subscribedDate = "";
let unsubs = [];

// Listens to today's queue. After midnight it switches to the new day by itself.
function subscribe(ctx) {
  const today = todayStr();
  if (today === subscribedDate) return;
  subscribedDate = today;
  unsubs.forEach((u) => u());
  unsubs = [];
  parts.mine = [];
  parts.open = [];
  document.getElementById("today-label").textContent =
    new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const onErr = (err) => notify(friendlyError(err), "error");
  if (ctx.isBarber) {
    // Two lists, merged: this barber's own customers + customers nobody has claimed yet.
    redraw = () => {
      const seen = new Set();
      render([...parts.mine, ...parts.open].filter((q) => (seen.has(q.id) ? false : seen.add(q.id))));
    };
    const take = (key) => (snap) => { parts[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); redraw(); };
    const fail = (what) => (err) => {
      console.error(what, err);
      notify(`Could not load ${what}. ${friendlyError(err)} (If this says permission, publish the newest firestore.rules.)`, "error");
    };
    unsubs.push(
      onSnapshot(query(collection(db, "queue"), where("date", "==", today), where("barberId", "==", myBarberId)), take("mine"), fail("your customers")),
      onSnapshot(query(collection(db, "queue"), where("date", "==", today), where("barberId", "==", "")), take("open"), fail("unclaimed customers"))
    );
    return;
  }
  unsubs.push(onSnapshot(query(collection(db, "queue"), where("date", "==", today)), (snap) => {
    render(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onErr));
}

// Customers still "waiting" or "serving" from an earlier day were never finished: close them as cancelled
// (nothing is charged). Each role closes what it is allowed to: owner/admin everything, staff the unclaimed ones,
// a barber their own.
async function closeOldEntries(ctx) {
  const today = todayStr();
  let closed = 0;
  try {
    for (const status of ["waiting", "serving"]) {
      const filters = [where("status", "==", status)];
      if (ctx.isBarber) filters.push(where("barberId", "==", myBarberId));
      const snap = await getDocs(query(collection(db, "queue"), ...filters));
      for (const d of snap.docs) {
        const q = d.data();
        if (!q.date || q.date >= today) continue;
        if (!ctx.isAdmin && !ctx.isBarber && q.barberId) continue; // staff can't touch a barber's customer
        try {
          await updateDoc(doc(db, "queue", d.id), { status: "cancelled", completedAt: serverTimestamp() });
          closed += 1;
        } catch (err) {
          console.error(err);
        }
      }
    }
    if (closed) logActivity("Closed unfinished customers from earlier days", `${closed} cancelled`);
  } catch (err) {
    console.error(err);
  }
}

requireStaff((ctx) => {
  canEdit = ctx.canEdit;
  isAdmin = ctx.isAdmin;
  loadOfferedServices();
  if (canEdit) {
    setupWalkInForm();
    document.getElementById("board-link").style.display = "";
  }
  if (ctx.isBarber) {
    if (!ctx.profile.barberId) {
      notify("Your login isn't linked to a barber profile yet. Please ask the admin.", "error");
      return;
    }
    myBarberId = ctx.profile.barberId;
    myName = ctx.profile.name || ctx.profile.displayName || "Barber";
    getDocs(query(collection(db, "barbers"), orderBy("name"))).then((s) => {
      const b = s.docs.find((d) => d.id === myBarberId);
      if (b) myName = b.data().name || myName;
    }).catch(() => {});
  }
  subscribe(ctx);
  closeOldEntries(ctx);
  // A page left open overnight moves to the new day by itself.
  setInterval(() => {
    if (todayStr() !== subscribedDate) { subscribe(ctx); closeOldEntries(ctx); }
  }, 30000);
});
