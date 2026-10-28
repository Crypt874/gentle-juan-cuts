import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, peso, notify, clearNotice, friendlyError, logActivity
} from "./staff-common.js";

const listBox = document.getElementById("list");
const formCard = document.getElementById("form-card");
const formTitle = document.getElementById("form-title");
const form = document.getElementById("service-form");
const addBtn = document.getElementById("add-btn");
const saveBtn = document.getElementById("save-btn");

let canEdit = false;
let editingId = null; // null = adding a new service
let services = [];
let photoRef = ""; // "photo:<id>", an https link, or ""

// ---------- photo (picked from the gallery) ----------
const photoImg = document.getElementById("s-photo-img");
const photoFile = document.getElementById("s-photo-file");
const photoPick = document.getElementById("s-photo-pick");
const photoRemove = document.getElementById("s-photo-remove");

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
  const m = await import("./photos.js");
  try { await setPhoto(await m.savePhoto(f)); }
  catch (err) { console.error(err); notify(m.photoErrorText(err), "error"); }
  photoPick.disabled = false;
  photoPick.textContent = "Choose from gallery";
});

// ---------- form ----------
function openForm(svc) {
  clearNotice();
  editingId = svc ? svc.id : null;
  formTitle.textContent = svc ? "Edit service" : "Add service";
  document.getElementById("s-name").value = svc ? svc.name : "";
  document.getElementById("s-price").value = svc ? Number(svc.price) || 0 : "";
  document.getElementById("s-desc").value = svc ? (svc.description || "") : "";
  document.getElementById("s-status").value = svc && svc.status === "unavailable" ? "unavailable" : "available";
  setPhoto(svc && typeof svc.photoUrl === "string" ? svc.photoUrl : "");
  formCard.style.display = "";
  document.getElementById("s-name").focus();
}

function closeForm() {
  photoRef = "";
  formCard.style.display = "none";
  editingId = null;
  form.reset();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const name = document.getElementById("s-name").value.trim();
  const priceText = document.getElementById("s-price").value.trim();
  const price = Number(priceText);
  const description = document.getElementById("s-desc").value.trim();
  const status = document.getElementById("s-status").value;

  if (name.length < 2) return notify("Please enter a service name.", "error");
  if (priceText === "" || !Number.isFinite(price) || price < 0) return notify("Please enter a valid price.", "error");

  saveBtn.disabled = true;
  try {
    const data = { name, description, price, status };
    if (editingId) {
      const old = services.find((x) => x.id === editingId);
      await updateDoc(doc(db, "services", editingId), { ...data, photoUrl: photoRef || deleteField() });
      logActivity("Edited service", old && Number(old.price) !== price ? `${name}: price ${peso.format(Number(old.price) || 0)} -> ${peso.format(price)}` : name);
      notify("Service updated.", "success");
    } else {
      await addDoc(collection(db, "services"), { ...data, ...(photoRef ? { photoUrl: photoRef } : {}), createdAt: serverTimestamp() });
      logActivity("Added service", `${name} ${peso.format(price)}`);
      notify("Service added.", "success");
    }
    closeForm();
  } catch (err) {
    notify(friendlyError(err), "error");
  }
  saveBtn.disabled = false;
});

document.getElementById("cancel-btn").addEventListener("click", closeForm);
addBtn.addEventListener("click", () => openForm(null));

// ---------- list ----------
async function toggleStatus(svc) {
  clearNotice();
  try {
    await updateDoc(doc(db, "services", svc.id), {
      status: svc.status === "unavailable" ? "available" : "unavailable"
    });
    logActivity(svc.status === "unavailable" ? "Marked service available" : "Marked service unavailable", svc.name);
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

function renderCard(svc) {
  const off = svc.status === "unavailable";
  const card = el("div", "card" + (off ? " dim" : ""));

  const head = el("div", "appt-head");
  head.append(
    el("h3", "", svc.name),
    el("span", `badge ${off ? "st-cancelled" : "st-completed"}`, off ? "Unavailable" : "Available")
  );
  card.append(head);
  if (typeof svc.photoUrl === "string" && svc.photoUrl) {
    const img = el("img", "svc-photo");
    img.alt = svc.name;
    img.loading = "lazy";
    card.append(img);
    import("./photos.js").then((m) => m.photoSrc(svc.photoUrl)).then((src) => { if (src) img.src = src; else img.remove(); }).catch(() => img.remove());
  }
  if (svc.description) card.append(el("p", "", svc.description));
  card.append(el("p", "price", peso.format(Number(svc.price) || 0)));

  if (canEdit) {
    const actions = el("div", "actions");
    const edit = el("button", "btn btn-sm", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      openForm(svc);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const toggle = el("button", "btn btn-sm btn-outline", off ? "Mark available" : "Mark unavailable");
    toggle.type = "button";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      await toggleStatus(svc);
      toggle.disabled = false;
    });
    actions.append(edit, toggle);
    card.append(actions);
  }
  return card;
}

function render() {
  listBox.replaceChildren();
  if (!services.length) {
    listBox.append(el("p", "empty", "No services yet."));
    return;
  }
  services.forEach((s) => listBox.append(renderCard(s)));
}

// ---------- init ----------
requireStaff((ctx) => {
  canEdit = ctx.isAdmin; // staff can view services and prices, but only the admin changes them
  if (canEdit) addBtn.style.display = "";

  onSnapshot(query(collection(db, "services"), orderBy("name")), (snap) => {
    services = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    notify(friendlyError(err), "error");
    listBox.replaceChildren();
  });
});
