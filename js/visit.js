import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, getDocs, setDoc, doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  el, peso, queueLabel, phoneKey, notify, clearNotice, friendlyError, isOfferedService, PAYMENT_METHODS
} from "./staff-common.js";

// Shared by the Queue page and the Appointments page (so a barber can finish a customer from either).
// Services staff can add to a visit at the end (loaded for owner/admin/staff).
let offeredServices = []; // [{ id, name, price }]

export async function loadOfferedServices() {
  try {
    const snap = await getDocs(query(collection(db, "services"), orderBy("name")));
    offeredServices = snap.docs.filter((d) => isOfferedService(d.data()))
      .map((d) => ({ id: d.id, name: d.data().name, price: Number(d.data().price) || 0 }));
  } catch (err) {
    console.error(err);
  }
}

// Asks for any extra services and how the customer paid.
// Resolves to { method, extras: [{ id, name, price }] }, or null if cancelled.
export function askPayment(q) {
  return new Promise((resolve) => {
    const base = Number(q.servicePrice) || 0;
    const overlay = el("div", "pay-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Finish visit");
    const box = el("div", "pay-box card");
    box.append(el("h3", "", "Finish this visit"));
    box.append(el("p", "muted", `${q.queueNumber ? queueLabel(q.queueNumber) + " - " : ""}${q.customerName} - ${q.serviceName} (${peso.format(base)})`));

    const checks = [];
    const total = el("p", "pay-total", "");
    const refresh = () => {
      const sum = base + checks.filter((c) => c.input.checked).reduce((t, c) => t + c.svc.price, 0);
      total.textContent = `Total: ${peso.format(sum)}`;
    };
    if (offeredServices.length) {
      const wrap = el("div", "pay-extras");
      wrap.append(el("strong", "", "Add another service (optional)"));
      offeredServices.forEach((svc) => {
        const label = el("label", "pay-extra");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.addEventListener("change", refresh);
        label.append(input, ` ${svc.name} - ${peso.format(svc.price)}`);
        wrap.append(label);
        checks.push({ svc, input });
      });
      box.append(wrap);
    }
    refresh();
    box.append(total, el("p", "pay-how", "How did the customer pay?"));

    const grid = el("div", "pay-grid");
    const done = (value) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    PAYMENT_METHODS.forEach((m) => {
      const b = el("button", "btn", m);
      b.type = "button";
      b.addEventListener("click", () => done({ method: m, extras: checks.filter((c) => c.input.checked).map((c) => c.svc) }));
      grid.append(b);
    });
    const cancel = el("button", "btn btn-outline btn-sm", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => done(null));
    box.append(grid, cancel);
    overlay.append(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    grid.firstChild.focus();
  });
}

// Completing a customer records the visit everywhere in ONE transaction:
// queue -> completed, service history, one sale per service, customer record, and the appointment (if any).
export async function completeEntry(q, preChoice = null) {
  clearNotice();
  const choice = preChoice || await askPayment(q);
  if (!choice) return;
  const paymentMethod = choice.method;
  const items = [
    { serviceId: q.serviceId, name: q.serviceName, price: Number(q.servicePrice) || 0 },
    ...choice.extras.map((x) => ({ serviceId: x.id, name: x.name, price: x.price }))
  ];
  const totalAmount = items.reduce((t, i) => t + i.price, 0);
  try {
    await runTransaction(db, async (tx) => {
      const qRef = doc(db, "queue", q.id);
      const snap = await tx.get(qRef);
      if (!snap.exists() || snap.data().status !== "serving") throw new Error("not-serving");

      tx.update(qRef, { status: "completed", completedAt: serverTimestamp(), paymentMethod, items, totalAmount });

      const customerId = phoneKey(q.contactNumber);
      items.forEach((it) => {
        const base = {
          customerId: customerId || null,
          customerName: q.customerName,
          serviceId: it.serviceId,
          serviceName: it.name,
          barberId: q.barberId,
          barberName: q.barberName,
          date: q.date,
          queueId: q.id,
          createdAt: serverTimestamp()
        };
        tx.set(doc(collection(db, "serviceHistory")), base);
        tx.set(doc(collection(db, "sales")), { ...base, amount: it.price, paymentMethod });
      });

      if (customerId) {
        tx.set(doc(db, "customers", customerId), {
          name: q.customerName,
          contactNumber: q.contactNumber,
          facebookProfile: q.facebookProfile || "",
          lastVisit: q.date
        }, { merge: true });
      }
      if (q.appointmentId) {
        tx.update(doc(db, "appointments", q.appointmentId), { status: "completed" });
      }
    });
    await saveReceipt({ ...q, paymentMethod, items, totalAmount });
    notify(`${q.customerName} is done. The receipt is saved - find it in Receipts, or use "View receipt" in the Done column.`, "success");
  } catch (err) {
    notify(friendlyError(err), "error");
  }
}

// The services of a visit: the ones saved at completion, or the single booked service.
export function itemsOf(q) {
  if (Array.isArray(q.items) && q.items.length) return q.items.map((i) => ({ name: i.name, price: Number(i.price) || 0 }));
  return [{ name: q.serviceName || "Service", price: Number(q.servicePrice) || 0 }];
}

// ---------- receipts ----------
// One receipt per completed customer, saved in the "receipts" collection (ID = receipt number).
export function receiptRecord(q) {
  const receiptNo = `${String(q.date).replace(/-/g, "")}-${String(q.queueNumber).padStart(3, "0")}`;
  return {
    receiptNo,
    date: q.date,
    queueNumber: q.queueNumber,
    queueId: q.id,
    appointmentId: q.appointmentId || "",
    customerId: phoneKey(q.contactNumber) || null,
    customerName: q.customerName || "",
    contactNumber: q.contactNumber || "",
    serviceId: q.serviceId || "",
    serviceName: itemsOf(q).map((i) => i.name).join(" + "),
    items: itemsOf(q).map((i) => ({ name: i.name, price: i.price })),
    amount: itemsOf(q).reduce((t, i) => t + i.price, 0),
    paymentMethod: q.paymentMethod || "",
    barberId: q.barberId || "",
    barberName: q.barberName || ""
  };
}

// Saved right after the visit is recorded. If saving fails the visit is still completed,
// and the receipt is created the first time someone opens it.
async function saveReceipt(q) {
  const rec = receiptRecord(q);
  try {
    await setDoc(doc(db, "receipts", rec.receiptNo), { ...rec, completedAt: serverTimestamp(), createdAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
  }
}

