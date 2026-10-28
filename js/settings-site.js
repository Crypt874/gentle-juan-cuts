// Settings > Website: home page slideshow pictures and the sample video.
import { db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { el, friendlyError, logActivity } from "./staff-common.js";
import { getSite, safeImage, parseVideo, MAX_SLIDES, MAX_GALLERY } from "./media.js";
import { savePhoto, photoSrc, photoErrorText } from "./photos.js";

const $ = (id) => document.getElementById(id);

function say(text, type) {
  const box = $("site-status");
  box.textContent = text;
  box.className = `message show ${type}`;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// One row = small preview, picture (gallery upload or link), caption, Remove.
function slideRow(slide = {}) {
  const row = el("div", "slide-row");
  const thumb = el("img", "slide-thumb");
  thumb.alt = "";
  thumb.hidden = true;
  const url = el("input");
  url.type = "text"; url.maxLength = 300; url.placeholder = "Choose from gallery, or paste https://...";
  url.setAttribute("aria-label", "Picture link");
  const cap = el("input");
  cap.type = "text"; cap.maxLength = 80; cap.placeholder = "Caption (optional)";
  cap.value = slide.caption || "";
  cap.setAttribute("aria-label", "Caption");

  const file = el("input");
  file.type = "file"; file.accept = "image/*"; file.hidden = true;
  const pick = el("button", "btn btn-sm", "Choose from gallery");
  pick.type = "button";
  pick.addEventListener("click", () => file.click());
  const rm = el("button", "btn btn-outline btn-sm", "Remove");
  rm.type = "button";
  rm.addEventListener("click", () => row.remove());

  const showPreview = async (ref) => {
    const src = await photoSrc(ref);
    thumb.hidden = !src;
    if (src) thumb.src = src;
  };
  const useRef = (ref) => {
    row.dataset.ref = ref;
    url.value = "Photo from your gallery";
    url.readOnly = true;
    showPreview(ref);
  };
  url.addEventListener("input", () => { delete row.dataset.ref; });

  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (!f) return;
    pick.disabled = true;
    pick.textContent = "Uploading...";
    try {
      useRef(await savePhoto(f));
    } catch (err) {
      console.error(err);
      say(photoErrorText(err), "error");
    }
    pick.disabled = false;
    pick.textContent = "Choose from gallery";
  });

  const first = slide.url || "";
  if (/^photo:/.test(first)) useRef(first);
  else { url.value = first; if (/^https:/.test(first)) showPreview(first); }

  const btns = el("div", "slide-btns");
  btns.append(pick, rm);
  row.append(thumb, url, cap, btns, file);
  return row;
}

// Reads the rows of a list into [{url, caption}], or returns an error message.
function readRows(list) {
  const out = [];
  for (const row of list.children) {
    const [u, c] = row.querySelectorAll("input[type=text]");
    const raw = row.dataset.ref || u.value.trim();
    if (!raw) continue;
    const url = safeImage(raw);
    if (!url) return { error: `"${raw}" is not a valid picture. Use Choose from gallery, or a link starting with https://` };
    out.push({ url, caption: c.value.trim().slice(0, 80) });
  }
  return { rows: out };
}

export async function initSite() {
  const list = $("slide-list");
  const site = await getSite();
  (site.slides.length ? site.slides : [{}]).forEach((s) => list.append(slideRow(s)));
  const glist = $("gallery-list");
  (site.gallery.length ? site.gallery : [{}]).forEach((g) => glist.append(slideRow(g)));
  $("gallery-add").addEventListener("click", () => {
    if (glist.children.length >= MAX_GALLERY) return say(`You can add up to ${MAX_GALLERY} gallery photos.`, "error");
    glist.append(slideRow());
  });
  $("v-url").value = site.videoUrl;
  $("v-title").value = site.videoTitle;

  $("slide-add").addEventListener("click", () => {
    if (list.children.length >= MAX_SLIDES) return say(`You can add up to ${MAX_SLIDES} pictures.`, "error");
    list.append(slideRow());
  });

  $("site-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sl = readRows(list);
    if (sl.error) return say(sl.error, "error");
    const gl = readRows(glist);
    if (gl.error) return say(gl.error, "error");
    const slides = sl.rows;
    const gallery = gl.rows;
    const videoUrl = $("v-url").value.trim();
    if (videoUrl && !parseVideo(videoUrl)) {
      return say("That video link isn't supported. Use a YouTube or Facebook video link, or a direct .mp4 link.", "error");
    }
    const btn = $("site-save");
    btn.disabled = true;
    try {
      await setDoc(doc(db, "settings", "site"), {
        slides, gallery, videoUrl, videoTitle: $("v-title").value.trim().slice(0, 80), updatedAt: serverTimestamp()
      });
      logActivity("Updated website", `${slides.length} slideshow picture(s), ${gallery.length} gallery photo(s)${videoUrl ? ", video" : ""}`);
      say("Saved. Your home page now shows these pictures and video.", "success");
    } catch (err) {
      say(friendlyError(err), "error");
    }
    btn.disabled = false;
  });
}
