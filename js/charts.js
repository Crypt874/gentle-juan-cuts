// Small chart helpers (pie + bar) drawn as inline SVG. No chart library needed.
// Colors were checked with the dataviz palette validator: 5 hues in a fixed order, then a quiet gray for "Other".
import { el } from "./staff-common.js";

export const SERIES_COLORS = ["#3a7fb8", "#d4623a", "#3f9467", "#b98a00", "#a45ca8"];
export const OTHER_COLOR = "#9a8c7c";
const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
  return n;
}

// Gives every entity (barber / service) the same color every time, no matter how the list is filtered.
// Entities past the 5th share the gray "Other" color.
export function colorMap(ids) {
  const map = new Map();
  [...ids].sort().forEach((id, i) => map.set(id, i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR));
  return map;
}

// One tooltip for the whole page
let tip = null;
function showTip(text, x, y) {
  if (!tip) {
    tip = el("div", "chart-tip");
    tip.setAttribute("role", "status");
    document.body.append(tip);
  }
  tip.textContent = text;
  tip.style.display = "block";
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(6, Math.min(x + 12, window.innerWidth - w - 6))}px`;
  tip.style.top = `${y + 14}px`;
}
function hideTip() { if (tip) tip.style.display = "none"; }

function wireTip(node, text) {
  node.addEventListener("mousemove", (e) => showTip(text, e.clientX, e.clientY));
  node.addEventListener("mouseleave", hideTip);
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect();
    showTip(text, r.left + r.width / 2, r.top + r.height / 2);
  });
  node.addEventListener("blur", hideTip);
}

// items: [{ id, label, value, color }]. Draws the pie and a legend table next to it (the legend is the data table).
export function pieChart(box, items, unit = "customers") {
  box.replaceChildren();
  const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total) {
    box.append(el("p", "empty", "No customers in this period."));
    return;
  }

  const wrap = el("div", "pie-wrap");
  const S = 220, C = S / 2, R = 100;
  const chart = svg("svg", { viewBox: `0 0 ${S} ${S}`, class: "pie-svg", role: "img", "aria-label": `Pie chart of ${total} ${unit}` });

  let angle = -Math.PI / 2;
  data.forEach((item) => {
    const pct = Math.round((item.value / total) * 100);
    const text = `${item.label}: ${item.value} ${unit} (${pct}%)`;
    let node;
    if (data.length === 1) {
      node = svg("circle", { cx: C, cy: C, r: R, fill: item.color });
    } else {
      const sweep = (item.value / total) * Math.PI * 2;
      const a1 = angle + sweep;
      const x0 = C + R * Math.cos(angle), y0 = C + R * Math.sin(angle);
      const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
      node = svg("path", {
        d: `M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`,
        fill: item.color
      });
      angle = a1;
    }
    node.setAttribute("class", "pie-slice");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", text);
    wireTip(node, text);
    chart.append(node);
  });

  const legend = el("table", "table pie-legend");
  const head = el("thead");
  const hr = el("tr");
  ["", "Name", "Count", "Share"].forEach((h, i) => hr.append(el("th", i > 1 ? "num" : "", h)));
  head.append(hr);
  const body = el("tbody");
  data.forEach((item) => {
    const tr = el("tr");
    const swatch = el("td");
    const dot = el("span", "swatch");
    dot.style.background = item.color;
    swatch.append(dot);
    tr.append(swatch, el("td", "", item.label), el("td", "num strong", String(item.value)),
      el("td", "num", `${Math.round((item.value / total) * 100)}%`));
    body.append(tr);
  });
  const foot = el("tfoot");
  const fr = el("tr");
  fr.append(el("td"), el("td", "strong", "Total"), el("td", "num strong", String(total)), el("td", "num", "100%"));
  foot.append(fr);
  legend.append(head, body, foot);

  wrap.append(chart, legend);
  box.append(wrap);
}

// items: [{ label, value }]. A single-color bar chart (one measure, one hue). Rounded tops, light grid.
export function barChart(box, items, { format = (v) => String(v), color = "#3a7fb8", unit = "" } = {}) {
  box.replaceChildren();
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!items.length || !max) {
    box.append(el("p", "empty", "Nothing recorded in this period."));
    return;
  }
  const W = 640, H = 220, L = 8, B = 26, T = 14;
  const plotH = H - B - T;
  const slot = (W - L * 2) / items.length;
  const bw = Math.max(3, Math.min(34, slot * 0.62));
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "bar-svg", role: "img", "aria-label": `Bar chart, highest value ${format(max)}` });

  [0.5, 1].forEach((f) => {
    const y = T + plotH - plotH * f;
    chart.append(svg("line", { x1: L, x2: W - L, y1: y, y2: y, class: "bar-grid" }));
  });
  chart.append(svg("line", { x1: L, x2: W - L, y1: T + plotH, y2: T + plotH, class: "bar-axis" }));

  const every = Math.ceil(items.length / 12); // keep x labels from colliding
  items.forEach((item, i) => {
    const h = Math.max(item.value ? 2 : 0, (item.value / max) * plotH);
    const x = L + slot * i + (slot - bw) / 2;
    const y = T + plotH - h;
    const text = `${item.label}: ${format(item.value)}${unit ? " " + unit : ""}`;
    if (item.value > 0) {
      const r = Math.min(4, bw / 2, h);
      const bar = svg("path", {
        d: `M${x},${T + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + plotH} Z`,
        fill: color, class: "bar-mark", tabindex: 0, "aria-label": text
      });
      wireTip(bar, text);
      chart.append(bar);
    }
    // wider invisible hit area so thin bars are easy to hover
    const hit = svg("rect", { x: L + slot * i, y: T, width: slot, height: plotH, fill: "transparent" });
    wireTip(hit, text);
    chart.append(hit);
    if (i % every === 0) {
      const t = svg("text", { x: x + bw / 2, y: H - 8, class: "bar-label", "text-anchor": "middle" });
      t.textContent = item.label;
      chart.append(t);
    }
  });
  const top = svg("text", { x: W - L, y: T - 3, class: "bar-label", "text-anchor": "end" });
  top.textContent = `Highest: ${format(max)}`;
  chart.append(top);
  box.append(chart);
}
