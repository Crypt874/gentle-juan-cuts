// Paste your Firebase web app config here.
// Firebase console > Project settings > General > Your apps > Web app > SDK setup and configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA4TCQhT3Y5Tad08j0bewMKYelky1pS2AY",
  authDomain: "barbershop-4089d.firebaseapp.com",
  projectId: "barbershop-4089d",
  storageBucket: "barbershop-4089d.firebasestorage.app",
  messagingSenderId: "98935138633",
  appId: "1:98935138633:web:b7912f34074d1605e31298"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Shop settings used by the booking page. Edit to match your real hours.
export const SHOP = {
  openHour: 9,    // 9:00 AM
  closeHour: 19,  // last slot starts before 7:00 PM
  slotMinutes: 60,
  closedWeekdays: [] // e.g. [0] to close on Sundays (0 = Sunday)
};
