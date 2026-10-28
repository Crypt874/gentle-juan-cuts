// Settings > Accounts (admin only): add logins for staff and barbers, edit them, turn access off or on.
import { db, auth } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, query, orderBy, onSnapshot, doc, writeBatch, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { el, notify, clearNotice, friendlyError, ROLE_LABEL, normRole, logActivity } from "./staff-common.js";

const ROLE_ORDER = { owner: 0, admin: 1, staff: 2, employee: 3 };
let viewerIsOwner = false;

// An owner (or co-owner) manages every other account. An admin manages staff and employee accounts only.
const canManage = (emp) => emp.id !== myUid && (viewerIsOwner || ["staff", "employee"].includes(emp.role));
const rolesICanGive = () => (viewerIsOwner ? ["owner", "admin", "staff", "employee"] : ["staff", "employee"]);
const ROLE_HELP = {
  owner: "Co-owner: the same powers as you, including backup/restore and managing admins and other owners. Only give this to someone you fully trust.",
  admin: "Admin: manager. Sees everything and can manage staff and employee accounts, but not backup/restore or other admins.",
  staff: "Staff: front desk. Appointments, queue, receipts and customers.",
  employee: "Employee: a barber. Sees only their own appointments, queue and dashboard."
};

const $ = (id) => document.getElementById(id);
const listBox = $("acct-list");
const formCard = $("acct-form-card");
const form = $("acct-form");
const saveBtn = $("acct-save-btn");

let myUid = null;
let employees = [];   // {id, ...users doc}
let barbers = [];     // {id, ...barbers doc}
let editing = null;   // account being edited, or null when adding

// Creating a login signs that person in. A second, separate Firebase app is used for it,
// so the admin stays signed in on the main app.
function secondaryAuth() {
  const app = getApps().find((a) => a.name === "employee-creator") || initializeApp(auth.app.options, "employee-creator");
  return getAuth(app);
}

function makePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function authErrorText(err) {
  switch (err && err.code) {
    case "auth/email-already-in-use": return "That email already has a login. Use a different email. (If that account was deleted here, also remove it in Firebase Console > Authentication so the email can be used again.)";
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/weak-password": return "The password must be at least 6 characters.";
    case "auth/operation-not-allowed": return "Email/Password sign-in is not enabled in Firebase Authentication.";
    case "auth/network-request-failed": return "No internet connection. Please try again.";
    default: return "Could not create the login. Please try again.";
  }
}

// ---------- form ----------
function option(select, value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  select.append(o);
}

function fillBarberSelect(currentId) {
  const sel = $("e-barber");
  sel.replaceChildren();
  // a barber profile can only belong to one login
  const taken = new Set(employees
    .filter((u) => u.barberId && (!editing || u.id !== editing.id))
    .map((u) => u.barberId));
  option(sel, "__new__", "Create a new barber profile for this person");
  const free = barbers.filter((b) => !taken.has(b.id));
  free.forEach((b) => option(sel, b.id, `Use existing profile: ${b.name}`));
  sel.value = currentId && free.some((b) => b.id === currentId) ? currentId : "__new__";
}

function syncRole() {
  $("barber-wrap").style.display = $("e-role").value === "employee" ? "" : "none";
  $("role-help").textContent = ROLE_HELP[$("e-role").value] || "";
}

function openForm(emp) {
  clearNotice();
  editing = emp || null;
  $("acct-form-title").textContent = emp ? "Edit account" : "Add account";
  $("e-name").value = emp ? emp.name || "" : "";
  $("e-email").value = emp ? emp.email || "" : "";
  $("e-email").disabled = !!emp;          // the email is the login, so it can't change
  const roleSel = $("e-role");
  roleSel.replaceChildren();
  rolesICanGive().forEach((r) => option(roleSel, r, ROLE_LABEL[r]));
  roleSel.value = emp && rolesICanGive().includes(emp.role) ? emp.role : "staff";
  $("pw-wrap").style.display = emp ? "none" : "";
  $("e-password").value = emp ? "" : makePassword();
  fillBarberSelect(emp ? emp.barberId : "");
  syncRole();
  formCard.style.display = "";
  $("e-name").focus();
}

function closeForm() {
  formCard.style.display = "none";
  editing = null;
  form.reset();
}

// A barber needs a barber profile. This either links an existing one or adds a new one to the batch.
function barberIdFor(batch, name) {
  const choice = $("e-barber").value;
  if (choice && choice !== "__new__") return choice;
  const ref = doc(collection(db, "barbers"));
  batch.set(ref, { name, status: "available", active: true, createdAt: serverTimestamp() });
  return ref.id;
}

async function createAccount(name, email, role, password) {
  const sec = secondaryAuth();
  let uid;
  try {
    const cred = await createUserWithEmailAndPassword(sec, email, password);
    uid = cred.user.uid;
  } catch (err) {
    console.error(err);
    return notify(authErrorText(err), "error");
  }
  try {
    const batch = writeBatch(db);
    const data = { name, email, role, active: true, createdAt: serverTimestamp() };
    if (role === "employee") data.barberId = barberIdFor(batch, name);
    batch.set(doc(db, "users", uid), data);
    await batch.commit();
  } catch (err) {
    console.error(err);
    await signOut(sec);
    return notify(
      `The login was created but saving the account failed (login ID: ${uid}). ` +
      "Add a document with that ID in Firestore > users with name, email and role, or ask for help.", "error");
  }
  await signOut(sec);
  logActivity("Created account", `${name} (${email}) as ${ROLE_LABEL[role]}`);
  closeForm();
  notify(`${name}'s account was created. Email: ${email}   Temporary password: ${password}   - write it down now, it won't be shown again.`, "success");
}

async function saveEdit(name, role) {
  const wasBarber = editing.role === "employee";
  if (role !== editing.role) {
    const from = ROLE_LABEL[editing.role] || editing.role;
    const text = `Change ${editing.name}'s role from ${from} to ${ROLE_LABEL[role]}?` +
      (role === "owner" ? "\n\nCo-owners have the same powers as you: they can manage every account (including yours), back up/restore, and delete records." : "") +
      (role === "admin" ? "\n\nAdmins see everything and can manage staff and employee accounts, but cannot back up/restore or manage other admins." : "") +
      (wasBarber && role !== "employee" ? "\n\nTheir barber profile will be hidden from booking." : "") +
      "\n\nThey get the new access the next time they open a page.";
    if (!window.confirm(text)) return;
  }
  const batch = writeBatch(db);
  const data = { name, role };
  data.barberId = role === "employee" ? barberIdFor(batch, name) : deleteField();
  batch.update(doc(db, "users", editing.id), data);
  if (wasBarber && role !== "employee" && editing.barberId) {
    batch.update(doc(db, "barbers", editing.barberId), { active: false });
  }
  await batch.commit();
  logActivity(role !== editing.role ? "Changed account role" : "Edited account", role !== editing.role ? `${editing.name || editing.email}: ${ROLE_LABEL[editing.role] || editing.role} -> ${ROLE_LABEL[role]}` : `${editing.name || editing.email}`);
  closeForm();
  notify("Account updated.", "success");
}

async function deleteAccount(emp) {
  const text = `Delete ${emp.name}'s account permanently?\n\nThey will no longer be able to log in.` +
    (emp.role === "owner" ? " They are a co-owner, so they lose all owner access." : "") +
    (emp.barberId ? " Their barber profile is hidden from booking, but past appointments and sales keep their name." : "") +
    "\n\nThis cannot be undone. (To only pause access, use Deactivate instead.)";
  if (!window.confirm(text)) return;
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", emp.id));
    if (emp.barberId) batch.update(doc(db, "barbers", emp.barberId), { active: false });
    await batch.commit();
    logActivity("Deleted account", `${emp.name} (${emp.email || ""}, ${ROLE_LABEL[emp.role] || emp.role})`);
    notify(`${emp.name}'s account was deleted.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// ---------- actions ----------
async function toggleActive(emp) {
  const turningOff = emp.active !== false;
  const text = turningOff
    ? `Deactivate ${emp.name}'s account? They won't be able to log in or see anything.` +
      (emp.barberId ? " Their barber profile will also be hidden from booking." : "") +
      "\n\nYou can reactivate it later."
    : `Reactivate ${emp.name}'s account?`;
  if (!window.confirm(text)) return;
  clearNotice();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", emp.id), { active: !turningOff });
    if (emp.barberId) batch.update(doc(db, "barbers", emp.barberId), { active: !turningOff });
    await batch.commit();
    logActivity(turningOff ? "Deactivated account" : "Reactivated account", `${emp.name} (${emp.email || ""})`);
    notify(turningOff ? `${emp.name}'s account was deactivated.` : `${emp.name}'s account was reactivated.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

async function sendReset(emp) {
  clearNotice();
  try {
    await sendPasswordResetEmail(auth, emp.email);
    notify(`A password reset email was sent to ${emp.email}.`, "success");
  } catch (err) {
    console.error(err);
    notify("Could not send the reset email. Check the email address and try again.", "error");
  }
}

// ---------- list ----------
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

function renderCard(emp) {
  const isMe = emp.id === myUid;
  const off = emp.active === false;
  const card = el("div", "card" + (off ? " dim" : ""));

  const head = el("div", "appt-head");
  head.append(
    el("h3", "", emp.name || "(no name)"),
    el("span", `badge ${off ? "st-cancelled" : "st-completed"}`, off ? "Deactivated" : "Active")
  );
  card.append(head);

  card.append(el("p", "", emp.email || ""));
  const roleLine = el("p", "");
  roleLine.append(el("span", "badge", ROLE_LABEL[emp.role] || emp.role));
  if (isMe) roleLine.append(" ", el("span", "badge st-confirmed", "You"));
  card.append(roleLine);
  if (emp.role === "employee") {
    const b = barbers.find((x) => x.id === emp.barberId);
    card.append(el("p", "muted", b ? `Barber profile: ${b.name}` : "No barber profile linked"));
  }

  const actions = el("div", "actions");
  if (canManage(emp)) {
    actions.append(actionButton("Edit / change role", "", async () => {
      openForm(emp);
      formCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }
  if (canManage(emp) && emp.email) actions.append(actionButton("Send password reset", "btn-outline", () => sendReset(emp)));
  if (canManage(emp)) {
    actions.append(actionButton(off ? "Reactivate" : "Deactivate", off ? "btn-outline" : "btn-danger", () => toggleActive(emp)));
    actions.append(actionButton("Delete", "btn-danger", () => deleteAccount(emp)));
  }
  if (actions.children.length) card.append(actions);
  return card;
}

function render() {
  listBox.replaceChildren();
  if (!employees.length) {
    listBox.append(el("p", "empty", "No accounts yet."));
    return;
  }
  [...employees]
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
      || (a.name || a.email || "").localeCompare(b.name || b.email || ""))
    .forEach((emp) => listBox.append(renderCard(emp)));
}

// ---------- init ----------
export function initAccounts(ctx) {
  myUid = ctx.user.uid;
  viewerIsOwner = ctx.isOwner;

  $("acct-add-btn").addEventListener("click", () => openForm(null));
  $("acct-cancel-btn").addEventListener("click", closeForm);
  $("e-role").addEventListener("change", syncRole);
  $("gen-btn").addEventListener("click", () => { $("e-password").value = makePassword(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearNotice();
    const name = $("e-name").value.trim();
    const email = $("e-email").value.trim().toLowerCase();
    const role = $("e-role").value;
    const password = $("e-password").value;

    if (name.length < 2) return notify("Please enter the person's name.", "error");
    if (!rolesICanGive().includes(role)) return notify("Please choose a role.", "error");
    if (!editing) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify("Please enter a valid email address.", "error");
      if (password.length < 6) return notify("The password must be at least 6 characters.", "error");
    }

    saveBtn.disabled = true;
    try {
      if (editing) await saveEdit(name, role);
      else await createAccount(name, email, role, password);
    } catch (err) {
      notify(friendlyError(err), "error");
    }
    saveBtn.disabled = false;
  });

  onSnapshot(collection(db, "users"), (snap) => {
    employees = snap.docs.map((d) => { const u = d.data(); return { id: d.id, ...u, role: normRole(u.role) }; });
    render();
  }, (err) => {
    notify(friendlyError(err), "error");
    listBox.replaceChildren();
  });

  onSnapshot(query(collection(db, "barbers"), orderBy("name")), (snap) => {
    barbers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
