// Installable app: registers the service worker and shows an "Install app" button when the browser allows it.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((err) => console.error(err));
}

let deferred = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("gjc:installDismissed") === "1"; } catch (err) { /* ignore */ }
  if (dismissed || document.getElementById("install-app")) return;

  const bar = document.createElement("div");
  bar.id = "install-app";
  bar.className = "install-app";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-sm";
  btn.textContent = "Install app";
  btn.addEventListener("click", async () => {
    bar.remove();
    deferred.prompt();
    try { await deferred.userChoice; } catch (err) { /* ignore */ }
    deferred = null;
  });
  const x = document.createElement("button");
  x.type = "button";
  x.className = "btn btn-outline btn-sm";
  x.textContent = "Not now";
  x.addEventListener("click", () => {
    bar.remove();
    try { sessionStorage.setItem("gjc:installDismissed", "1"); } catch (err) { /* ignore */ }
  });
  bar.append(btn, x);
  document.body.append(bar);
});

window.addEventListener("appinstalled", () => {
  const bar = document.getElementById("install-app");
  if (bar) bar.remove();
});
