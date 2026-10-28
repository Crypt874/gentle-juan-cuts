import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, onSnapshot, getDocs, doc, addDoc, updateDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, label12h, todayStr, cap, notify, clearNotice, friendlyError,
  barberStatus, BARBER_STATUS_LABEL, logActivity
} from "./staff-common.js";

const listBox = document.getElementById("list");
const formCard = document.getElementById("form-card");
const formTitle = document.getElementById("form-title");
const form = document.getElementById("barber-form");
const addBtn = document.getElementById("add-btn");
const saveBtn = document.getElementById("save-btn");
const scheduleCard = document.getElementById("schedule-card");
const scheduleDate = document.getElementById("schedule-date");

let isAdmin = false;
let editingId = null;
let barbers = [];
let photoRef = ""; // picture chosen in the form ("photo:<id>", an https link, or "")
let scheduleBarber = null; // barber whose schedule is open

// ---------- add / edit form (admin only) ----------
function openForm(b) {
  clearNotice();
  editingId = b ? b.id : null;
  formTitle.textContent = b ? "Edit barber" : "Add barber";
  document.getElementById("b-name").value = b ? b.name : "";
  document.getElementById("b-status").value = b ? barberStatus(b) : "available";
  setPhoto(b && typeof b.photoUrl === "string" ? b.photoUrl : "");
  formCard.style.display = "";
  document.getElementById("b-name").focus();
}

// ---------- photo (picked from the gallery) ----------
const photoImg = document.getElementById("b-photo-img");
const photoFile = document.getElementById("b-photo-file");
const photoPick = document.getElementById("b-photo-pick");
const photoRemove = document.getElementById("b-photo-remove");

async function setPhoto(ref) {
  photoRef = ref;
  photoRemove.hidden = !ref;
  photoImg.hidden = true;
  if (!ref) return;
  const { photoSrc } = await import("./photos.js");
  const src = await photoSrc(ref);
  if (ref === photoRef && src) { photoImg.src = src; photoImg.hidden = false; }
}

photoPick.addEventListener("click", () => photoFile.click());
photoRemove.addEventListener("click", () => setPhoto(""));
photoFile.addEventListener("change", async () => {
  const f = photoFile.files && photoFile.files[0];
  photoFile.value = "";
  if (!f) return;
  clearNotice();
  photoPick.disabled = true;
  photoPick.textContent = "Uploading...";
  try {
    const { savePhoto } = await import("./photos.js");
    await setPhoto(await savePhoto(f));
  } catch (err) {
    console.error(err);
    const { photoErrorText } = await import("./photos.js");
    notify(photoErrorText(err), "error");
  }
  photoPick.disabled = false;
  photoPick.textContent = "Choose from gallery";
});

function closeForm() {
  photoRef = "";
  formCard.style.display = "none";
  editingId = null;
  form.reset();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const name = document.getElementById("b-name").value.trim();
  const status = document.getElementById("b-status").value;
  if (name.length < 2) return notify("Please enter the barber's name.", "error");

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "barbers", editingId), { name, status, photoUrl: photoRef || deleteField() });
      logActivity("Edited barber", name);
      notify("Barber updated.", "success");
    } else {
      await addDoc(collection(db, "barbers"), { name, status, active: true, createdAt: serverTimestamp(), ...(photoRef ? { photoUrl: photoRef } : {}) });
      logActivity("Added barber", name);
      notify("Barber added.", "success");
    }
    closeForm();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
  saveBtn.disabled = false;
});

document.getElementById("cancel-btn").addEventListener("click", closeForm);
addBtn.addEventListener("click", () => openForm(null));

// ---------- quick actions ----------
async function setStatus(b, status) {
  clearNotice();
  try {
    await updateDoc(doc(db, "barbers", b.id), { status });
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

async function toggleActive(b) {
  const nowActive = b.active !== false;
  if (nowActive && !window.confirm(`Deactivate ${b.name}? They will no longer appear for booking. Existing appointments are not changed.`)) return;
  clearNotice();
  try {
    await updateDoc(doc(db, "barbers", b.id), { active: !nowActive });
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- list ----------
function renderCard(b) {
  const active = b.active !== false;
  const status = barberStatus(b);
  const card = el("div", "card" + (active ? "" : " dim"));

  const head = el("div", "appt-head");
  head.append(el("h3", "", b.name));
  card.append(head);

  const badges = el("p", "");
  const statusBadge = el("span", `badge st-${status === "available" ? "completed" : status === "busy" ? "waiting" : "cancelled"}`,
    BARBER_STATUS_LABEL[status]);
  badges.append(statusBadge);
  if (!active) {
    badges.append(" ", el("span", "badge st-cancelled", "Deactivated"));
  }
  card.append(badges);

  const actions = el("div", "actions");

  const sched = el("button", "btn btn-sm btn-outline", "View schedule");
  sched.type = "button";
  sched.addEventListener("click", () => openSchedule(b));
  actions.append(sched);

  if (isAdmin) {
    const sel = document.createElement("select");
    sel.className = "inline-select";
    sel.setAttribute("aria-label", `Status for ${b.name}`);
    ["available", "busy", "off"].forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = BARBER_STATUS_LABEL[v];
      sel.append(o);
    });
    sel.value = status;
    sel.addEventListener("change", () => setStatus(b, sel.value));
    actions.append(sel);

    const edit = el("button", "btn btn-sm", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      openForm(b);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const toggle = el("button", "btn btn-sm btn-outline", active ? "Deactivate" : "Activate");
    toggle.type = "button";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      await toggleActive(b);
      toggle.disabled = false;
    });
    actions.append(edit, toggle);
  }
  card.append(actions);
  return card;
}

function render() {
  listBox.replaceChildren();
  if (!barbers.length) {
    listBox.append(el("p", "empty", "No barbers yet."));
    return;
  }
  barbers.forEach((b) => listBox.append(renderCard(b)));
  // keep an open schedule's title in sync
  if (scheduleBarber) {
    const fresh = barbers.find((b) => b.id === scheduleBarber.id);
    if (fresh) scheduleBarber = fresh;
  }
}

// ---------- schedule ----------
async function loadSchedule() {
  const box = document.getElementById("schedule-list");
  box.replaceChildren(el("p", "empty", "Loading..."));
  if (!scheduleBarber || !scheduleDate.value) return;
  document.getElementById("schedule-title").textContent = `Schedule - ${scheduleBarber.name}`;
  try {
    const snap = await getDocs(query(collection(db, "appointments"), where("date", "==", scheduleDate.value)));
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => a.barberId === scheduleBarber.id && a.status !== "cancelled")
      .sort((x, y) => x.time.localeCompare(y.time));
    box.replaceChildren();
    if (!rows.length) {
      box.append(el("p", "empty", "No appointments for this barber on that date."));
      return;
    }
    rows.forEach((a) => {
      const row = el("div", "card appt");
      const head = el("div", "appt-head");
      head.append(
        el("h3", "", `${label12h(a.time)} - ${a.customerName}`),
        el("span", `badge st-${a.status}`, cap(a.status))
      );
      row.append(head, el("p", "", a.serviceName));
      box.append(row);
    });
  } catch (err) {
    box.replaceChildren();
    notify(friendlyError(err), "error");
  }
}

function openSchedule(b) {
  scheduleBarber = b;
  scheduleDate.value = scheduleDate.value || todayStr();
  scheduleCard.style.display = "";
  loadSchedule();
  scheduleCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

scheduleDate.addEventListener("change", loadSchedule);
document.getElementById("schedule-close").addEventListener("click", () => {
  scheduleCard.style.display = "none";
  scheduleBarber = null;
});

// ---------- init ----------
requireStaff((ctx) => {
  isAdmin = ctx.isAdmin;
  // Barbers are added by creating a Barber account (Settings > Accounts), so there is no "Add barber" button here.
  scheduleDate.value = todayStr();

  onSnapshot(query(collection(db, "barbers"), orderBy("name")), (snap) => {
    barbers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    notify(friendlyError(err), "error");
    listBox.replaceChildren();
  });
});
