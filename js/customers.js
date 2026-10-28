import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, onSnapshot, getDocs, getDoc, doc,
  setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  requireStaff, el, fmtDate, phoneKey, notify, clearNotice, friendlyError
} from "./staff-common.js";

const listBox = document.getElementById("list");
const searchInput = document.getElementById("search");
const formCard = document.getElementById("form-card");
const formTitle = document.getElementById("form-title");
const form = document.getElementById("customer-form");
const addBtn = document.getElementById("add-btn");
const saveBtn = document.getElementById("save-btn");
const contactInput = document.getElementById("c-contact");
const contactHint = document.getElementById("contact-hint");
const profileCard = document.getElementById("profile");
const profileHint = document.getElementById("profile-hint");

let canEdit = false;
let customers = [];     // {id, ...data}
let selectedId = null;
let editingId = null;   // null = adding

// ---------- search + list ----------
function matches(c, text, digits) {
  if (!text) return true;
  if ((c.name || "").toLowerCase().includes(text)) return true;
  if (digits && (c.contactNumber || "").replace(/\D/g, "").includes(digits)) return true;
  return false;
}

function renderList() {
  const text = searchInput.value.trim().toLowerCase();
  const digits = searchInput.value.replace(/\D/g, "");
  const rows = customers.filter((c) => matches(c, text, digits));

  listBox.replaceChildren();
  if (!rows.length) {
    listBox.append(el("p", "empty", customers.length ? "No customers match your search." : "No customers yet."));
    return;
  }
  rows.forEach((c) => {
    const card = el("div", "card cust" + (c.id === selectedId ? " selected" : ""));
    card.append(el("h3", "", c.name));
    card.append(el("p", "", c.contactNumber || ""));
    const view = el("button", "btn btn-sm btn-outline", "View");
    view.type = "button";
    view.addEventListener("click", () => selectCustomer(c.id));
    const actions = el("div", "actions");
    actions.append(view);
    card.append(actions);
    listBox.append(card);
  });
}

// ---------- profile ----------
function detail(dl, label, value) {
  dl.append(el("dt", "", label), el("dd", "", value || "-"));
}

async function selectCustomer(id) {
  selectedId = id;
  renderList();
  const c = customers.find((x) => x.id === id);
  if (!c) {
    profileCard.style.display = "none";
    profileHint.style.display = "";
    return;
  }
  profileHint.style.display = "none";
  profileCard.style.display = "";

  const dl = document.getElementById("profile-details");
  dl.replaceChildren();
  detail(dl, "Name", c.name);
  detail(dl, "Contact", c.contactNumber);
  detail(dl, "Facebook/Messenger", c.facebookProfile);
  detail(dl, "Last visit", c.lastVisit ? fmtDate(c.lastVisit) : "");
  detail(dl, "No-shows", String(Number(c.noShows) || 0));

  const actions = document.getElementById("profile-actions");
  actions.replaceChildren();
  if (canEdit) {
    const edit = el("button", "btn btn-sm", "Edit customer");
    edit.type = "button";
    edit.addEventListener("click", () => {
      openForm(c);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    actions.append(edit);
  }

  await loadHistory(c);
}

async function loadHistory(c) {
  const box = document.getElementById("history");
  box.replaceChildren(el("p", "empty", "Loading..."));
  try {
    const snap = await getDocs(query(collection(db, "serviceHistory"), where("customerId", "==", c.id)));
    // ignore the answer if the user already clicked another customer
    if (selectedId !== c.id) return;
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    box.replaceChildren();
    if (!rows.length) {
      box.append(el("p", "empty", "No completed services yet."));
      return;
    }

    const table = el("table", "table");
    const thead = el("thead");
    const hr = el("tr");
    ["Date", "Service", "Barber"].forEach((h) => hr.append(el("th", "", h)));
    thead.append(hr);
    const tbody = el("tbody");
    rows.forEach((r) => {
      const tr = el("tr");
      tr.append(el("td", "", fmtDate(r.date)), el("td", "", r.serviceName || ""), el("td", "", r.barberName || ""));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    box.append(table);
    box.append(el("p", "hint", `${rows.length} visit${rows.length === 1 ? "" : "s"} recorded.`));
  } catch (err) {
    box.replaceChildren();
    notify(friendlyError(err), "error");
  }
}

// ---------- add / edit ----------
function openForm(c) {
  clearNotice();
  editingId = c ? c.id : null;
  formTitle.textContent = c ? "Edit customer" : "Add customer";
  document.getElementById("c-name").value = c ? c.name : "";
  contactInput.value = c ? (c.contactNumber || "") : "";
  contactInput.disabled = !!c; // the phone number is the customer's ID
  contactHint.style.display = c ? "" : "none";
  document.getElementById("c-fb").value = c ? (c.facebookProfile || "") : "";
  formCard.style.display = "";
  document.getElementById("c-name").focus();
}

function closeForm() {
  formCard.style.display = "none";
  editingId = null;
  contactInput.disabled = false;
  form.reset();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const name = document.getElementById("c-name").value.trim();
  const facebookProfile = document.getElementById("c-fb").value.trim();
  if (name.length < 2) return notify("Please enter the customer's name.", "error");

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "customers", editingId), { name, facebookProfile });
      notify("Customer updated.", "success");
      const id = editingId;
      closeForm();
      selectedId = id;
    } else {
      const contact = contactInput.value.trim();
      const id = phoneKey(contact);
      if (!id) {
        saveBtn.disabled = false;
        return notify("Please enter a valid contact number.", "error");
      }
      const existing = await getDoc(doc(db, "customers", id));
      if (existing.exists()) {
        notify(`A customer with that number already exists (${existing.data().name}).`, "error");
        selectedId = id;
        saveBtn.disabled = false;
        return;
      }
      await setDoc(doc(db, "customers", id), {
        name, contactNumber: contact, facebookProfile, lastVisit: "", createdAt: serverTimestamp()
      });
      notify("Customer added.", "success");
      closeForm();
      selectedId = id;
    }
  } catch (err) {
    notify(friendlyError(err), "error");
  }
  saveBtn.disabled = false;
});

document.getElementById("cancel-btn").addEventListener("click", closeForm);
addBtn.addEventListener("click", () => openForm(null));
searchInput.addEventListener("input", renderList);

// ---------- init ----------
requireStaff((ctx) => {
  canEdit = ctx.canEdit;
  if (canEdit) addBtn.style.display = "";

  onSnapshot(query(collection(db, "customers"), orderBy("name")), (snap) => {
    customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderList();
    if (selectedId) selectCustomer(selectedId); // refresh the open profile after edits
  }, (err) => {
    notify(friendlyError(err), "error");
    listBox.replaceChildren();
  });
});
