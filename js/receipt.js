// Receipt helpers: the rows shown on a receipt, and the PDF version.
// A receipt record looks like: { receiptNo, date, queueNumber, customerName, contactNumber,
// serviceName, amount, barberName, completedAt }.
// The shop name, address and phone come from Settings > Business profile.
import { notify } from "./staff-common.js";

const FALLBACK_SHOP = {
  name: "The Gentle Juan Cuts",
  address: "Add your shop address here",
  phone: "09XX XXX XXXX"
};

// Shop details for the top of a receipt (falls back to defaults if they can't be loaded).
export async function shopInfo() {
  try {
    const b = await (await import("./business.js")).getBusiness();
    return { name: b.name || FALLBACK_SHOP.name, address: b.address || "", phone: b.phone || "" };
  } catch (err) {
    return { ...FALLBACK_SHOP };
  }
}

// The built-in PDF font cannot draw the peso sign, so the PDF writes "PHP 1,500".
export const money = (n) => "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function receiptNumber(date, queueNumber) {
  return `${String(date || "").replace(/-/g, "")}-${String(queueNumber || 0).padStart(3, "0")}`;
}

function whenOf(r) {
  const t = r.completedAt;
  if (t && typeof t.toDate === "function") return { d: t.toDate(), hasTime: true };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date || "");
  return { d: m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(), hasTime: false };
}

// [label, value] pairs shown on screen and in the PDF
// The lines on a receipt: every service of the visit (older receipts have just one).
export function receiptItems(r) {
  if (Array.isArray(r.items) && r.items.length) return r.items.map((i) => ({ name: String(i.name || "Service"), price: Number(i.price) || 0 }));
  return [{ name: r.serviceName || "Service", price: Number(r.amount) || 0 }];
}

export function receiptRows(r) {
  const { d, hasTime } = whenOf(r);
  const rows = [
    ["Receipt no.", r.receiptNo || receiptNumber(r.date, r.queueNumber)],
    ["Date", d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })]
  ];
  if (hasTime) rows.push(["Time", d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })]);
  rows.push(["Queue no.", `#${String(r.queueNumber || 0).padStart(3, "0")}`]);
  rows.push(["Customer", r.customerName || "Walk-in"]);
  if (r.contactNumber) rows.push(["Contact", r.contactNumber]);
  rows.push(["Barber", r.barberName || "-"]);
  if (r.paymentMethod) rows.push(["Payment", r.paymentMethod]);
  return rows;
}

const WALNUT = [122, 82, 54];
const INK = [59, 45, 34];
const MUTED = [122, 105, 88];
const W = 80;   // 80 mm wide, like a till receipt
const M = 6;

function draw(doc, r, logo, shop) {
  let y = 10;

  const center = (text, size, style, color) => {
    doc.setFont("helvetica", style || "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(color || INK));
    doc.splitTextToSize(text, W - 2 * M).forEach((line) => {
      doc.text(line, W / 2, y, { align: "center" });
      y += size * 0.45 + 1;
    });
  };
  const dash = () => {
    y += 1;
    doc.setDrawColor(...MUTED);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(M, y, W - M, y);
    doc.setLineDashPattern([], 0);
    y += 4.5;
  };
  const row = (label, value) => {
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, M, y);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.splitTextToSize(String(value), W - 2 * M - 22).forEach((line) => {
      doc.text(line, W - M, y, { align: "right" });
      y += 4;
    });
    y += 0.8;
  };

  if (logo) {
    const lw = 46;
    const lh = lw * logo.h / logo.w;
    doc.addImage(logo.dataUrl, "PNG", (W - lw) / 2, y - 3, lw, lh);
    y += lh + 2;
  } else {
    center(shop.name, 14, "bold", WALNUT);
  }
  if (shop.address) center(shop.address, 8, "normal", MUTED);
  if (shop.phone) center(shop.phone, 8, "normal", MUTED);
  dash();
  center("RECEIPT", 11, "bold");
  y += 1.5;

  receiptRows(r).forEach(([label, value]) => row(label, value));
  dash();

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  receiptItems(r).forEach((it) => {
    doc.splitTextToSize(it.name, W - 2 * M - 26).forEach((line, i) => {
      doc.text(line, M, y);
      if (i === 0) doc.text(money(it.price), W - M, y, { align: "right" });
      y += 4.5;
    });
  });
  dash();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...WALNUT);
  doc.text("TOTAL", M, y);
  doc.text(money(r.amount), W - M, y, { align: "right" });
  y += 8;

  center("Thank you for visiting!", 9.5, "bold");
  center("Please come again.", 8.5, "normal", MUTED);
  return y + 6;
}

export async function downloadReceiptPdf(r) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    notify("The PDF tool could not load. Check your internet connection and try again.", "error");
    return;
  }
  const shop = await shopInfo();
  let logo = null;
  try { logo = await (await import("./logo.js")).loadLogo(); } catch (err) { logo = null; }
  // First pass measures the height, second pass makes a page that fits exactly.
  const height = draw(new jsPDF({ unit: "mm", format: [W, 400] }), r, logo, shop);
  const doc = new jsPDF({ unit: "mm", format: [W, Math.max(height, 90)] });
  draw(doc, r, logo, shop);
  doc.save(`receipt_${r.receiptNo || receiptNumber(r.date, r.queueNumber)}.pdf`);
}
