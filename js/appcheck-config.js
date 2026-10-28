// Firebase App Check (protects your database from bots and fake bookings).
// 1. Firebase Console > App Check > Apps > your web app > register with reCAPTCHA v3 (or Enterprise).
// 2. Paste the reCAPTCHA SITE key (the public one) between the quotes below. Leave it empty to keep App Check off.
// 3. Test the website and the admin pages. Then, in the App Check page, turn on "Enforce" for Cloud Firestore.
// (On localhost, a debug token is used. The console prints it; add it under App Check > Manage debug tokens.)
export const RECAPTCHA_SITE_KEY = "";
