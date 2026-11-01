// Business profile (Settings > Business profile), stored in Firestore at settings/business.
// Used by the home page, the booking page and receipts. Falls back to the defaults below
// if nothing has been saved yet or it can't be loaded.
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const DEFAULT_BUSINESS = {
  name: "The Gentle Juan Cuts",
  phone: "09XX XXX XXXX",
  email: "",
  address: "Add your shop address here.",
  facebook: "",
  openHour: 9,        // 9:00 AM
  closeHour: 19,      // the last slot starts before 7:00 PM
  slotMinutes: 60,
  cancelCutoffHours: 0, // 0 = customers can cancel any time
  closedWeekdays: [], // 0 = Sunday ... 6 = Saturday
  closedDates: []     // holidays etc.: [{ date: "2026-12-25", note: "Christmas" }]
};

let cached = null;

export function getBusiness(force = false) {
  if (!cached || force) {
    cached = (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "business"));
        return snap.exists() ? { ...DEFAULT_BUSINESS, ...snap.data() } : { ...DEFAULT_BUSINESS };
      } catch (err) {
        console.error(err);
        return { ...DEFAULT_BUSINESS };
      }
    })();
  }
  return cached;
}

export function hourLabel(h) {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Daily, 9:00 AM - 7:00 PM" or "Mon-Sat, 9:00 AM - 7:00 PM"
export function hoursText(b) {
  const closed = new Set(b.closedWeekdays || []);
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const open = order.filter((d) => !closed.has(d));
  let days;
  if (open.length === 7) {
    days = "Daily";
  } else if (!open.length) {
    return "Closed";
  } else {
    const parts = [];
    let start = null;
    let prev = null;
    const flush = () => {
      if (start === null) return;
      parts.push(start === prev ? DAY_NAMES[start] : `${DAY_NAMES[start]}-${DAY_NAMES[prev]}`);
    };
    order.forEach((d, i) => {
      if (closed.has(d)) { flush(); start = null; prev = null; return; }
      if (start === null) start = d;
      prev = d;
      if (i === order.length - 1) flush();
    });
    days = parts.join(", ");
  }
  return `${days}, ${hourLabel(b.openHour)} - ${hourLabel(b.closeHour)}`;
}

// Closed dates as a Map: "YYYY-MM-DD" -> note. Ignores anything that isn't a valid date.
export function closedDateMap(b) {
  const map = new Map();
  (Array.isArray(b.closedDates) ? b.closedDates : []).forEach((c) => {
    if (c && typeof c.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) map.set(c.date, String(c.note || ""));
  });
  return map;
}
