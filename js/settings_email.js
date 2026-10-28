// Settings > Email: optional automatic confirmation emails through EmailJS (free plan available).
import { db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { friendlyError } from "./staff-common.js";
import { getEmailSettings, sendConfirmation, EMAIL_RE } from "./email.js";
import { getBusiness } from "./business.js";

const $ = (id) => document.getElementById(id);

function say(text, type) {
  const box = $("mail-status");
  box.textContent = text;
  box.className = `message show ${type}`;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export async function initEmail() {
  const cfg = await getEmailSettings();
  $("m-enabled").checked = !!cfg.enabled;
  $("m-service").value = cfg.serviceId || "";
  $("m-template").value = cfg.templateId || "";
  $("m-key").value = cfg.publicKey || "";

  const read = () => ({
    enabled: $("m-enabled").checked,
    serviceId: $("m-service").value.trim(),
    templateId: $("m-template").value.trim(),
    publicKey: $("m-key").value.trim()
  });

  $("mail-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = read();
    if (v.enabled && !(v.serviceId && v.templateId && v.publicKey)) {
      return say("Fill in all three EmailJS codes, or turn automatic emails off.", "error");
    }
    const btn = $("mail-save");
    btn.disabled = true;
    try {
      await setDoc(doc(db, "settings", "email"), { ...v, updatedAt: serverTimestamp() });
      say(v.enabled ? "Saved. Confirmation emails will be sent automatically." : "Saved. Staff will get a ready-written email to send from their own email app.", "success");
    } catch (err) {
      say(friendlyError(err), "error");
    }
    btn.disabled = false;
  });

  $("mail-test").addEventListener("click", async () => {
    const to = $("m-test").value.trim();
    if (!EMAIL_RE.test(to)) return say("Enter your own email address in the test box first.", "error");
    const v = read();
    if (!(v.enabled && v.serviceId && v.templateId && v.publicKey)) {
      return say("Turn on automatic emails and fill in the three codes first, then save and test.", "error");
    }
    const btn = $("mail-test");
    btn.disabled = true;
    try {
      // Test uses the typed codes (not yet saved), so save first for them to apply to real bookings.
      const { sendTestWith } = await import("./email-test.js");
      await sendTestWith(v, to, await getBusiness());
      say(`Test email sent to ${to}. Check your inbox (and spam).`, "success");
    } catch (err) {
      console.error(err);
      say("The test email failed. Double-check the three codes and that your EmailJS template uses {{to_email}} as the recipient.", "error");
    }
    btn.disabled = false;
  });
}