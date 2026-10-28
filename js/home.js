import { db } from "./firebase-config.js";
import "./appcheck.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

document.getElementById("year").textContent = new Date().getFullYear();

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

// Build DOM with textContent (never innerHTML with database values).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadServices() {
  const box = document.getElementById("services-list");
  try {
    const snap = await getDocs(query(collection(db, "services"), orderBy("name")));
    box.replaceChildren();
    const rows = [];
    snap.forEach((doc) => {
      const s = doc.data();
      if (s.status !== "unavailable") rows.push(s);
    });
    if (!rows.length) {
      box.append(el("p", "empty", "No rates listed yet."));
      return;
    }
    const table = el("table", "table rates-table");
    const head = el("thead");
    const hr = el("tr");
    const anyPhoto = rows.some((s) => typeof s.photoUrl === "string" && s.photoUrl);
    if (anyPhoto) hr.append(el("th", "", ""));
    ["Haircut type", "What's included", "Price"].forEach((h) => hr.append(el("th", h === "Price" ? "num" : h === "What's included" ? "desc" : "", h)));
    head.append(hr);
    const body = el("tbody");
    rows.forEach((s) => {
      const tr = el("tr");
      if (anyPhoto) {
        const td = el("td", "rate-photo");
        if (typeof s.photoUrl === "string" && s.photoUrl) {
          const img = document.createElement("img");
          img.alt = s.name;
          img.loading = "lazy";
          import("./photos.js").then((m) => m.photoSrc(s.photoUrl)).then((src) => { if (src) img.src = src; else img.remove(); }).catch(() => img.remove());
          td.append(img);
        }
        tr.append(td);
      }
      tr.append(el("td", "strong", s.name), el("td", "muted desc", s.description || ""),
        el("td", "num strong", peso.format(Number(s.price) || 0)));
      body.append(tr);
    });
    table.append(head, body);
    box.append(table);
  } catch (err) {
    console.error(err);
    box.replaceChildren(el("p", "empty", "Could not load rates. Check your Firebase config."));
  }
}

// ---------- Slideshow + sample video (set in Settings > Website) ----------
async function loadShowcase() {
  try {
    const { getSite, safeImage, parseVideo } = await import("./media.js");
    const site = await getSite();

    const { photoSrc } = await import("./photos.js");
    const resolved = await Promise.all(site.slides.map(async (s) => {
      const ref = safeImage(s.url);
      return { url: ref ? await photoSrc(ref) : "", caption: s.caption || "" };
    }));
    const slides = resolved.filter((s) => s.url);
    if (slides.length) startSlideshow(slides);
    loadGallery(site.gallery, safeImage, photoSrc);

    const vid = parseVideo(site.videoUrl);
    if (vid) {
      const box = document.getElementById("video-box");
      box.replaceChildren();
      if (vid.kind === "iframe") {
        const f = document.createElement("iframe");
        f.src = vid.src;
        f.title = site.videoTitle || "Sample video";
        f.loading = "lazy";
        f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";
        f.allowFullscreen = true;
        f.referrerPolicy = "strict-origin-when-cross-origin";
        box.append(f);
      } else {
        const v = document.createElement("video");
        v.src = vid.src;
        v.controls = true;
        v.preload = "metadata";
        v.setAttribute("playsinline", "");
        box.append(v);
      }
      document.getElementById("video-title").textContent = site.videoTitle || "";
    }
  } catch (err) {
    console.error(err); // placeholders stay
  }
}

// "Our Work" pictures (set in Settings > Website). Placeholders stay until some are added.
async function loadGallery(items, safeImage, photoSrc) {
  const box = document.querySelector("#gallery .gallery");
  if (!box || !items.length) return;
  const shots = (await Promise.all(items.map(async (g) => {
    const ref = safeImage(g.url);
    return { src: ref ? await photoSrc(ref) : "", caption: g.caption || "" };
  }))).filter((g) => g.src);
  if (!shots.length) return;
  box.replaceChildren(...shots.map((g) => {
    const fig = el("figure", "shot");
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = g.caption || "Haircut";
    img.loading = "lazy";
    fig.append(img);
    if (g.caption) fig.append(el("figcaption", "", g.caption));
    return fig;
  }));
}

function startSlideshow(slides) {
  const stage = document.getElementById("slide-stage");
  const caption = document.getElementById("slide-caption");
  const dots = document.getElementById("slide-dots");
  const prev = document.getElementById("slide-prev");
  const next = document.getElementById("slide-next");
  let i = 0;
  let timer = null;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const imgs = slides.map((s, n) => {
    const img = document.createElement("img");
    img.className = "slide-img";
    img.alt = s.caption || `Picture ${n + 1}`;
    img.loading = n === 0 ? "eager" : "lazy";
    img.src = s.url;
    img.addEventListener("error", () => { img.dataset.broken = "1"; });
    return img;
  });
  stage.replaceChildren(...imgs);

  const dotBtns = slides.map((_, n) => {
    const d = el("button", "dot");
    d.type = "button";
    d.setAttribute("aria-label", `Show picture ${n + 1}`);
    d.addEventListener("click", () => { go(n); restart(); });
    return d;
  });
  dots.replaceChildren(...dotBtns);

  function go(n) {
    i = (n + slides.length) % slides.length;
    imgs.forEach((im, k) => im.classList.toggle("on", k === i));
    dotBtns.forEach((d, k) => d.classList.toggle("on", k === i));
    caption.textContent = slides[i].caption;
  }
  function restart() {
    clearInterval(timer);
    if (!reduce && slides.length > 1) timer = setInterval(() => go(i + 1), 5000);
  }
  if (slides.length > 1) {
    prev.hidden = next.hidden = dots.hidden = false;
    prev.addEventListener("click", () => { go(i - 1); restart(); });
    next.addEventListener("click", () => { go(i + 1); restart(); });
    const show = document.getElementById("slideshow");
    show.addEventListener("mouseenter", () => clearInterval(timer));
    show.addEventListener("mouseleave", restart);
  }
  go(0);
  restart();
}

// Barber photo: uses the barber's optional "photoUrl" field (https link) when present,
// otherwise shows a placeholder.
function barberPhoto(b) {
  const placeholder = () => {
    const d = el("div", "photo-ph ph-person");
    d.setAttribute("role", "img");
    d.setAttribute("aria-label", `Photo of ${b.name} coming soon`);
    return d;
  };
  if (typeof b.photoUrl === "string" && b.photoUrl) {
    const img = document.createElement("img");
    img.className = "photo-img";
    img.alt = b.name;
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(placeholder()));
    if (/^https:\/\//.test(b.photoUrl)) {
      img.src = b.photoUrl;
      return img;
    }
    if (/^photo:/.test(b.photoUrl)) {
      const holder = placeholder();
      import("./photos.js").then((m) => m.photoSrc(b.photoUrl)).then((src) => {
        if (!src) return;
        img.src = src;
        holder.replaceWith(img);
      }).catch(() => {});
      return holder;
    }
  }
  return placeholder();
}

async function loadBarbers() {
  const box = document.getElementById("barbers-list");
  try {
    const snap = await getDocs(query(collection(db, "barbers"), orderBy("name")));
    box.replaceChildren();
    if (snap.empty) {
      box.append(el("p", "empty", "No barbers listed yet."));
      return;
    }
    let shown = 0;
    snap.forEach((doc) => {
      const b = doc.data();
      if (b.active === false) return;
      shown++;
      const raw = b.status === "break" ? "busy" : b.status;
      const status = ["available", "busy", "off"].includes(raw) ? raw : "available";
      const label = { available: "Available", busy: "Busy", off: "Off duty" }[status];
      const card = el("div", "card barber-card");
      card.append(barberPhoto(b));
      card.append(el("h3", "", b.name));
      card.append(el("span", `badge ${status}`, label));
      box.append(card);
    });
    if (!shown) box.append(el("p", "empty", "No barbers listed yet."));
  } catch (err) {
    console.error(err);
    box.replaceChildren(el("p", "empty", "Could not load barbers. Check your Firebase config."));
  }
}

async function loadBusiness() {
  try {
    const { getBusiness, hoursText, closedDateMap } = await import("./business.js");
    const b = await getBusiness();
    const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };

    set("hours-text", hoursText(b));
    // Upcoming closed dates (next 5)
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const next = [...closedDateMap(b).entries()].filter(([d]) => d >= today).sort((a, c) => a[0].localeCompare(c[0])).slice(0, 5);
    if (next.length) {
      set("closures", "Closed on: " + next.map(([d, note]) => {
        const [y, m, day] = d.split("-").map(Number);
        const label = new Date(y, m - 1, day).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
        return note ? `${label} (${note})` : label;
      }).join(", "));
    }
    set("biz-address", b.address || "");
    set("biz-name", b.name);
    set("biz-phone", b.phone ? `Phone: ${b.phone}` : "");

    const mail = document.getElementById("biz-email");
    if (mail && b.email) {
      mail.style.display = "";
      mail.textContent = `Email: ${b.email}`;
    }

    // Facebook: show a link if a web address was entered, otherwise plain text
    const fb = document.getElementById("biz-facebook");
    if (fb) {
      fb.replaceChildren();
      const value = (b.facebook || "").trim();
      if (!value) {
        fb.style.display = "none";
      } else {
        fb.style.display = "";
        fb.append("Facebook: ");
        if (/^https?:\/\//i.test(value)) {
          const a = document.createElement("a");
          a.href = value;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = value.replace(/^https?:\/\/(www\.)?/i, "");
          fb.append(a);
        } else {
          fb.append(value);
        }
      }
    }
  } catch (err) {
    console.error(err); // the page keeps its default text
  }
}

loadServices();
loadShowcase();
loadBarbers();
loadBusiness();
