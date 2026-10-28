// Booking confirmation emails.
// If EmailJS is set up (Settings > Email) the email is sent automatically.
// Otherwise we open the staff member's own email app with the message already written (mailto).
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { label12h } from "./staff-common.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getEmailSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "email"));
    return snap.exists() ? snap.data() : {};
  } catch (err) {
    console.error(err);
    return {};
  }
}

function prettyDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return ymd || "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function confirmationText(a, shop) {
  const lines = [
    `Hi ${a.customerName},`,
    "",
    `Your appointment at ${shop.name} is confirmed.`,
    "",
    `Service: ${a.serviceName}`,
    `Barber: ${a.barberName}`,
    `Date: ${prettyDate(a.date)}`,
    `Time: ${label12h(a.time)}`
  ];
  if (shop.address) lines.push(`Where: ${shop.address}`);
  lines.push("", "Please arrive a few minutes early. If you can't make it, contact us so we can free up your slot.");
  if (shop.phone) lines.push(`Phone: ${shop.phone}`);
  lines.push("", `Thank you,`, shop.name);
  return lines.join("\n");
}

// Short reminder, used for both the email and the text message.
export function reminderText(a, shop) {
  const lines = [
    `Hi ${a.customerName}, this is a reminder of your appointment at ${shop.name}:`,
    `${a.serviceName} with ${a.barberName || "our barber"}, ${prettyDate(a.date)} at ${label12h(a.time)}.`
  ];
  if (shop.address) lines.push(`Where: ${shop.address}`);
  lines.push("If you can't make it, please let us know so we can free your slot.");
  if (shop.phone) lines.push(`Phone: ${shop.phone}`);
  return lines.join("\n");
}

// Opens the phone's text-message app with the reminder ready to send (free, you press Send).
export function openTextReminder(a, shop) {
  const num = String(a.contactNumber || "").replace(/[^0-9+]/g, "");
  if (num.length < 7) throw new Error("no-number");
  window.location.href = `sms:${num}?&body=${encodeURIComponent(reminderText(a, shop))}`;
}

// Returns "sent" (EmailJS) or "mailto" (opened the email app) or throws.
export async function sendConfirmation(a, shop, kind = "confirm") {
  if (!EMAIL_RE.test(a.customerEmail || "")) throw new Error("no-email");
  const subject = kind === "reminder" ? `Appointment reminder - ${shop.name}` : `Appointment confirmed - ${shop.name}`;
  const message = kind === "reminder" ? reminderText(a, shop) : confirmationText(a, shop);
  const cfg = await getEmailSettings();

  if (cfg.enabled && cfg.serviceId && cfg.templateId && cfg.publicKey) {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          to_email: a.customerEmail, to_name: a.customerName, subject, message,
          shop_name: shop.name, service: a.serviceName, barber: a.barberName,
          date: prettyDate(a.date), time: label12h(a.time)
        }
      })
    });
    if (!res.ok) throw new Error("emailjs-" + res.status);
    return "sent";
  }

  window.location.href = `mailto:${encodeURIComponent(a.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  return "mailto";
}
