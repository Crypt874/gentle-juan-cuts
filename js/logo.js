import { LOGO_DATA_URL } from "./logo-data.js";

// Loads the shop logo once so it can be placed inside PDFs (receipts and sales reports).
// Returns { dataUrl, w, h }, or null if the image can't be loaded (PDFs then fall back to text).
let cached = null;

export function loadLogo() {
  if (!cached) {
    cached = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve({ dataUrl: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = LOGO_DATA_URL;
    });
  }
  return cached;
}
