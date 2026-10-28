import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { notify, clearNotice } from "./staff-common.js";

const form = document.getElementById("login-form");
const btn = document.getElementById("login-btn");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

// Discourage browser autofill / "save password": the fields start read-only and only become
// editable when the user clicks or tabs into them, and they are emptied every time the page is shown.
[emailInput, passwordInput].forEach((input) => {
  const unlock = () => input.removeAttribute("readonly");
  input.addEventListener("focus", unlock);
  input.addEventListener("pointerdown", unlock);
});

function clearFields() {
  emailInput.value = "";
  passwordInput.value = "";
}
clearFields();
window.addEventListener("pageshow", clearFields); // also runs when coming back with the Back button

if (new URLSearchParams(location.search).get("error") === "norole") {
  notify("This account has no staff role yet. Ask the admin to set it up.", "error");
}

if (new URLSearchParams(location.search).get("error") === "disabled") {
  notify("This account has been turned off. Please ask the admin.", "error");
}

// "Forgot password?" sends a reset link to the email typed above.
const forgot = document.getElementById("forgot-link");
if (forgot) {
  forgot.addEventListener("click", async (e) => {
    e.preventDefault();
    clearNotice();
    const email = emailInput.value.trim();
    if (!email) return notify("Type your email above first, then click Forgot password.", "error");
    try {
      await sendPasswordResetEmail(auth, email);
      notify("If that email has an account, a password reset link is on its way. Check your inbox and spam folder.", "success");
    } catch (err) {
      console.error(err);
      if (err.code === "auth/invalid-email") notify("That email address doesn't look right.", "error");
      else if (err.code === "auth/too-many-requests") notify("Too many attempts. Wait a few minutes and try again.", "error");
      else notify("Could not send the reset email. Please try again.", "error");
    }
  });
}

// Already signed in? Go straight to the dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) location.replace("appointments.html");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return notify("Enter your email and password.", "error");

  btn.disabled = true;
  btn.textContent = "Logging in...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    location.replace("appointments.html");
  } catch (err) {
    console.error(err);
    const wrong = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"];
    if (wrong.includes(err.code)) notify("Wrong email or password.", "error");
    else if (err.code === "auth/too-many-requests") notify("Too many attempts. Wait a few minutes and try again.", "error");
    else if (err.code === "auth/operation-not-allowed") notify("Email/Password sign-in is not enabled in Firebase Authentication.", "error");
    else notify("Could not log in. Please try again.", "error");
    passwordInput.value = "";
    btn.disabled = false;
    btn.textContent = "Log in";
  }
});