// Settings > Business profile. Saved at settings/business and used by the website, booking and receipts.
import { db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getBusiness, hoursText, hourLabel, closedDateMap } from "./business.js";
import { todayStr, fmtDate, logActivity } from "./staff-common.js";
import { friendlyError } from "./staff-common.js";

// Messages for this form appear right above the Save button (the top of the page may be out of view).
function say(text, type) {
  const box = document.getElementById("biz-status");
  box.textContent = text;
  box.className = `message show ${type}`;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function clearSay() {
  const box = document.getElementById("biz-status");
  box.textContent = "";
  box.className = "message";
}

// The website shows placeholder text until real details are saved. Don't put that text into the form.
const isPlaceholder = (v) => !v || /X{2,}/i.test(v) || /^add your shop address/i.test(v);

const $ = (id) => document.getElementById(id);
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

function buildControls() {
  for (let h = 5; h <= 23; h++) {
    [$("b-open"), $("b-close")].forEach((sel) => {
      const o = document.createElement("option");
      o.value = String(h);
      o.textContent = hourLabel(h);
      sel.append(o);
    });
  }
  const box = $("b-days");
  DAYS.forEach(([value, name]) => {
    const label = document.createElement("label");
    label.className = "day";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(value);
    input.addEventListener("change", updatePreview);
    label.append(input, name);
    box.append(label);
  });
  ["b-open", "b-close"].forEach((id) => $(id).addEventListener("change", updatePreview));
}

function readHours() {
  const closed = [];
  $("b-days").querySelectorAll("input").forEach((i) => { if (!i.checked) closed.push(Number(i.value)); });
  return {
    openHour: Number($("b-open").value),
    closeHour: Number($("b-close").value),
    closedWeekdays: closed
  };
}

function updatePreview() {
  const h = readHours();
  $("b-preview").textContent = h.openHour < h.closeHour
    ? `Shown on your website as: ${hoursText(h)}`
    : "Closing time must be later than opening time.";
}

// ---------- closed dates ----------
let closedDates = new Map(); // "YYYY-MM-DD" -> note

function renderClosed() {
  const list = $("cd-list");
  list.replaceChildren();
  const entries = [...closedDates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No closed dates.";
    list.append(li);
    return;
  }
  entries.forEach(([date, note]) => {
    const li = document.createElement("li");
    li.append(`${fmtDate(date)}${note ? ` - ${note}` : ""} `);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn-outline btn-sm";
    rm.textContent = "Remove";
    rm.setAttribute("aria-label", `Remove closed date ${fmtDate(date)}`);
    rm.addEventListener("click", () => { closedDates.delete(date); renderClosed(); });
    li.append(rm);
    list.append(li);
  });
}

function fill(b) {
  closedDates = closedDateMap(b);
  // dates that have already passed are dropped
  [...closedDates.keys()].forEach((d) => { if (d < todayStr()) closedDates.delete(d); });
  renderClosed();
  $("b-name").value = b.name || "";
  $("b-phone").value = isPlaceholder(b.phone) ? "" : b.phone;
  $("b-email").value = b.email || "";
  $("b-facebook").value = b.facebook || "";
  $("b-address").value = isPlaceholder(b.address) ? "" : b.address;
  $("b-open").value = String(b.openHour);
  $("b-close").value = String(b.closeHour);
  $("b-slot").value = String(b.slotMinutes);
  const closed = new Set(b.closedWeekdays || []);
  $("b-days").querySelectorAll("input").forEach((i) => { i.checked = !closed.has(Number(i.value)); });
  updatePreview();
}

export async function initBusiness() {
  buildControls();
  $("cd-date").min = todayStr();
  $("cd-add").addEventListener("click", () => {
    const d = $("cd-date").value;
    if (!d) return say("Pick the date first.", "error");
    if (d < todayStr()) return say("That date has already passed.", "error");
    closedDates.set(d, $("cd-note").value.trim().slice(0, 60));
    $("cd-date").value = "";
    $("cd-note").value = "";
    clearSay();
    renderClosed();
  });
  fill(await getBusiness(true));

  $("biz-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearSay();
    const name = $("b-name").value.trim();
    const phone = $("b-phone").value.trim();
    const email = $("b-email").value.trim();
    const facebook = $("b-facebook").value.trim();
    const address = $("b-address").value.trim();
    const hours = readHours();
    const slotMinutes = Number($("b-slot").value);

    if (name.length < 2) return say("Please enter the shop name.", "error");
    if (phone && !(/^[0-9+\-\s()]{7,30}$/.test(phone) && phone.replace(/\D/g, "").length >= 7)) return say("Please enter a valid phone number, for example 0917 123 4567.", "error");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say("Please enter a valid email address.", "error");
    if (facebook && /^[a-z][a-z0-9+.-]*:/i.test(facebook) && !/^https?:\/\//i.test(facebook)) {
      return say("The Facebook link must start with https://", "error");
    }
    if (hours.openHour >= hours.closeHour) return say("Closing time must be later than opening time.", "error");
    if (hours.closedWeekdays.length >= 7) return say("Choose at least one day the shop is open.", "error");

    const btn = $("biz-save");
    btn.disabled = true;
    try {
      await setDoc(doc(db, "settings", "business"), {
        name, phone, email, facebook, address, ...hours, slotMinutes,
        openTime: `${String(hours.openHour).padStart(2, "0")}:00`,
        closeTime: `${String(hours.closeHour).padStart(2, "0")}:00`,
        closedDateList: [...closedDates.keys()].sort(),
        closedDates: [...closedDates.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, note]) => ({ date, note })),
        updatedAt: serverTimestamp()
      });
      await getBusiness(true);
      logActivity("Saved business profile", `${name}, ${hours.openHour}:00-${hours.closeHour}:00, ${closedDates.size} closed date(s)`);
      say("Saved. Your website, booking page and receipts now use these details.", "success");
    } catch (err) {
      say(friendlyError(err), "error");
    }
    btn.disabled = false;
  });
}
