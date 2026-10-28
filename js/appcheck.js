// Turns on Firebase App Check when a reCAPTCHA site key is set in appcheck-config.js.
// Imported first by the pages, so it is ready before the first database request.
import { auth } from "./firebase-config.js";
import { RECAPTCHA_SITE_KEY } from "./appcheck-config.js";

if (RECAPTCHA_SITE_KEY) {
  try {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js");
    initializeAppCheck(auth.app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.error("App Check could not start:", err);
  }
}
