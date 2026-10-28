// Website slideshow + sample video settings, stored at settings/site (Settings > Website).
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const MAX_SLIDES = 8;
export const MAX_GALLERY = 12;

export async function getSite() {
  try {
    const snap = await getDoc(doc(db, "settings", "site"));
    const d = snap.exists() ? snap.data() : {};
    return {
      slides: Array.isArray(d.slides) ? d.slides : [],
      gallery: Array.isArray(d.gallery) ? d.gallery : [],
      videoUrl: typeof d.videoUrl === "string" ? d.videoUrl : "",
      videoTitle: typeof d.videoTitle === "string" ? d.videoTitle : ""
    };
  } catch (err) {
    console.error(err);
    return { slides: [], gallery: [], videoUrl: "", videoTitle: "" };
  }
}

// An image can be an https link or a file you uploaded to the site, e.g. "images/slide1.jpg".
export function safeImage(url) {
  const u = String(url || "").trim();
  if (/^https:\/\//i.test(u)) return u;
  if (/^photo:[A-Za-z0-9]{10,40}$/.test(u)) return u; // picked from the gallery (see photos.js)
  if (/^images\/[\w\-./ ]+\.(jpe?g|png|webp|gif)$/i.test(u) && !u.includes("..")) return u;
  return "";
}

// Turns a YouTube / Facebook / direct video link into something the page can embed.
// Returns { kind: "iframe" | "video", src } or null if the link isn't a supported video.
export function parseVideo(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  let m = /^https:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})/i.exec(u)
    || /^https:\/\/youtu\.be\/([\w-]{11})/i.exec(u)
    || /^https:\/\/(?:www\.)?youtube\.com\/(?:embed|shorts)\/([\w-]{11})/i.exec(u);
  if (m) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  if (/^https:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\//i.test(u)) {
    return { kind: "iframe", src: `https://www.facebook.com/plugins/video.php?show_text=false&href=${encodeURIComponent(u)}` };
  }
  if (/^https:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(u) || (/^videos\/[\w\-./ ]+\.(mp4|webm|ogg)$/i.test(u) && !u.includes(".."))) {
    return { kind: "video", src: u };
  }
  return null;
}
