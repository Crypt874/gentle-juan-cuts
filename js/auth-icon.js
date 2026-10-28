// Header user icon on the public pages.
// Not signed in -> goes to the staff login. Signed in -> goes straight to the dashboard.
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const link = document.getElementById("staff-link");

if (link) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      link.href = "admin/appointments.html";
      link.title = "Staff dashboard";
      link.setAttribute("aria-label", "Staff dashboard");
      link.classList.add("signed-in");
    } else {
      link.href = "admin/login.html";
      link.title = "Staff login";
      link.setAttribute("aria-label", "Staff login");
      link.classList.remove("signed-in");
    }
  });
}
