// Photos picked from the phone/computer gallery. Each picture is shrunk in the browser
// and saved as its own small document in the "photos" collection (no paid storage needed).
// Elsewhere a picture is referred to as "photo:<id>".
import { db, auth } from "./firebase-config.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const PHOTO_RE = /^photo:[A-Za-z0-9]{10,40}$/;
const MAX_SIDE = 1000;          // longest side in pixels
const MAX_CHARS = 450000;       // keep each document well under Firestore's 1 MB limit
const cache = new Map();

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
    img.src = url;
  });
}

// Shrinks the picture and returns a JPEG data URL under the size limit.
async function shrink(file) {
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let tries = 0; tries < 6; tries++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.58]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= MAX_CHARS) return data;
    }
    scale *= 0.8;
  }
  throw new Error("too-big");
}

// Saves a chosen file and returns its reference ("photo:<id>").
export async function savePhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("not-image");
  if (file.size > 25 * 1024 * 1024) throw new Error("too-big");
  const data = await shrink(file);
  const ref = await addDoc(collection(db, "photos"), {
    data, createdAt: serverTimestamp(), by: auth.currentUser ? auth.currentUser.uid : ""
  });
  cache.set(`photo:${ref.id}`, data);
  return `photo:${ref.id}`;
}

// Turns a stored picture reference into something an <img> can show ("" if it can't).
export async function photoSrc(ref) {
  const r = String(ref || "");
  if (/^https:\/\//i.test(r) || /^images\//i.test(r)) return r;
  if (!PHOTO_RE.test(r)) return "";
  if (cache.has(r)) return cache.get(r);
  try {
    const snap = await getDoc(doc(db, "photos", r.slice(6)));
    const data = snap.exists() ? snap.data().data : "";
    const ok = typeof data === "string" && data.startsWith("data:image/jpeg;base64,") ? data : "";
    cache.set(r, ok);
    return ok;
  } catch (err) {
    console.error(err);
    return "";
  }
}

export function photoErrorText(err) {
  if (err && err.message === "not-image") return "Please choose a picture file (JPG, PNG, WEBP).";
  if (err && (err.message === "too-big" || err.message === "bad-image")) return "That picture could not be used. Try a different one.";
  if (err && err.code === "permission-denied") return "Only the owner and admins can upload pictures.";
  return "The picture could not be uploaded. Please try again.";
}
