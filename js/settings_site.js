// Settings > Website: home page slideshow pictures and the sample video.
import { db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { el, friendlyError } from "./staff-common.js";
import { getSite, safeImage, parseVideo, MAX_SLIDES } from "./media.js";

const $ = (id) => document.getElementById(id);

function say(text, type) {
  const box = $("site-status");
  box.textContent = text;
  box.className = `message show ${type}`;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function slideRow(slide = {}) {
  const row = el("div", "slide-row");
  const url = el("input");
  url.type = "text"; url.maxLength = 300; url.placeholder = "https://... or images/slide1.jpg";
  url.value = slide.url || "";
  url.setAttribute("aria-label", "Picture link");
  const cap = el("input");
  cap.type = "text"; cap.maxLength = 80; cap.placeholder = "Caption (optional)";
  cap.value = slide.caption || "";
  cap.setAttribute("aria-label", "Caption");
  const rm = el("button", "btn btn-outline btn-sm", "Remove");
  rm.type = "button";
  rm.addEventListener("click", () => row.remove());
  row.append(url, cap, rm);
  return row;
}

export async function initSite() {
  const list = $("slide-list");
  const site = await getSite();
  (site.slides.length ? site.slides : [{}]).forEach((s) => list.append(slideRow(s)));
  $("v-url").value = site.videoUrl;
  $("v-title").value = site.videoTitle;

  $("slide-add").addEventListener("click", () => {
    if (list.children.length >= MAX_SLIDES) return say(`You can add up to ${MAX_SLIDES} pictures.`, "error");
    list.append(slideRow());
  });

  $("site-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const slides = [];
    for (const row of list.children) {
      const [u, c] = row.querySelectorAll("input");
      const raw = u.value.trim();
      if (!raw) continue;
      const url = safeImage(raw);
      if (!url) return say(`"${raw}" is not a valid picture. Use a link starting with https:// or a file like images/slide1.jpg.`, "error");
      slides.push({ url, caption: c.value.trim().slice(0, 80) });
    }
    const videoUrl = $("v-url").value.trim();
    if (videoUrl && !parseVideo(videoUrl)) {
      return say("That video link isn't supported. Use a YouTube or Facebook video link, or a direct .mp4 link.", "error");
    }
    const btn = $("site-save");
    btn.disabled = true;
    try {
      await setDoc(doc(db, "settings", "site"), {
        slides, videoUrl, videoTitle: $("v-title").value.trim().slice(0, 80), updatedAt: serverTimestamp()
      });
      say("Saved. Your home page now shows these pictures and video.", "success");
    } catch (err) {
      say(friendlyError(err), "error");
    }
    btn.disabled = false;
  });
}