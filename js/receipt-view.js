// Shows a receipt on screen in a pop-up, with Download PDF, Print and Close.
import { el, peso } from "./staff-common.js";
import { shopInfo, receiptRows, receiptItems, downloadReceiptPdf } from "./receipt.js";

let overlay = null;
let lastFocus = null;

function onKey(e) {
  if (e.key === "Escape") closeReceipt();
}

export function closeReceipt() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.body.classList.remove("receipt-open");
  document.removeEventListener("keydown", onKey);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export async function showReceipt(r, opts = {}) {
  closeReceipt();
  lastFocus = document.activeElement;
  const shop = await shopInfo();

  overlay = el("div", "receipt-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Receipt");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeReceipt(); });

  const box = el("div", "receipt-box");
  const paper = el("div", "receipt-paper");

  const logo = el("span", "logo-img receipt-logo");
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", shop.name);
  paper.append(logo);
  if (shop.address) paper.append(el("p", "receipt-center muted", shop.address));
  if (shop.phone) paper.append(el("p", "receipt-center muted", shop.phone));
  paper.append(el("div", "receipt-sep"));
  paper.append(el("p", "receipt-title", "RECEIPT"));

  receiptRows(r).forEach(([label, value]) => {
    const row = el("div", "receipt-row");
    row.append(el("span", "receipt-label", label), el("span", "receipt-value", value));
    paper.append(row);
  });
  paper.append(el("div", "receipt-sep"));

  receiptItems(r).forEach((it) => {
    const svc = el("div", "receipt-row");
    svc.append(el("span", "", it.name), el("span", "receipt-value", peso.format(it.price)));
    paper.append(svc);
  });
  paper.append(el("div", "receipt-sep"));

  const total = el("div", "receipt-total");
  total.append(el("span", "", "TOTAL"), el("span", "", peso.format(Number(r.amount) || 0)));
  paper.append(total);
  paper.append(el("p", "receipt-center receipt-thanks", "Thank you for visiting!"));
  paper.append(el("p", "receipt-center muted", "Please come again."));

  const actions = el("div", "receipt-actions");
  const pdfBtn = el("button", "btn btn-sm", "Download PDF");
  pdfBtn.type = "button";
  pdfBtn.addEventListener("click", async () => {
    pdfBtn.disabled = true;
    await downloadReceiptPdf(r);
    pdfBtn.disabled = false;
  });
  const printBtn = el("button", "btn btn-sm btn-outline", "Print");
  printBtn.type = "button";
  printBtn.addEventListener("click", () => window.print());
  const closeBtn = el("button", "btn btn-sm btn-outline", "Close");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", closeReceipt);
  actions.append(pdfBtn, printBtn, closeBtn);

  box.append(paper, actions);
  overlay.append(box);
  document.body.append(overlay);
  document.body.classList.add("receipt-open");
  document.addEventListener("keydown", onKey);
  closeBtn.focus();
  // Quick print: the pop-up opens and the print window follows right away
  if (opts.print) setTimeout(() => window.print(), 250);
}
