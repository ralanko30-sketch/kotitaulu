// Kevyet SVG-kaaviot ilman ulkoisia kirjastoja: viiva, pylväs (myös pinottu) ja minikäyrä.
// Kaikissa hover-työkaluvihje. Värit tulevat CSS-muuttujista.

const NS = "http://www.w3.org/2000/svg";
let tipEl;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(html, ev) {
  const t = tip();
  t.innerHTML = html;
  t.style.display = "block";
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY - h - 10;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
  if (y < 8) y = ev.clientY + 16;
  t.style.left = x + "px";
  t.style.top = y + "px";
}
export function hideTip() { if (tipEl) tipEl.style.display = "none"; }

const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

function legendHTML(series) {
  if (series.length < 2) return "";
  return `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>`;
}

const fmtDateShort = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;

// --- Viivakaavio --------------------------------------------------------------
// opts: { series:[{name,color,points:[{x:Date,y:number}], dashed?, dots?}], yFmt, height, band:{lo,hi,label}, yMin }
export function lineChart(container, opts) {
  const draw = () => {
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 200;
    const m = { t: 10, r: 12, b: 24, l: 44 };
    const all = opts.series.flatMap(s => s.points);
    container.innerHTML = legendHTML(opts.series);
    if (all.length < 2) {
      container.insertAdjacentHTML("beforeend", `<div class="empty small">Liian vähän dataa kaavioon vielä.</div>`);
      return;
    }
    const xs = all.map(p => +p.x);
    const ys = all.map(p => p.y);
    if (opts.band) ys.push(opts.band.lo, opts.band.hi);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (opts.yMin != null) yMin = Math.min(yMin, opts.yMin);
    const pad = (yMax - yMin) * 0.08 || 1;
    const { lo, hi, ticks } = niceTicks(yMin - pad, yMax + pad);
    const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
    const fmt = opts.yFmt || ((v) => String(Math.round(v)));

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" });
    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "gl" }, svg);
      el("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "ax" }, svg).textContent = fmt(t);
    }
    // x-akselin päivämäärät
    const nx = Math.min(6, Math.floor((W - m.l) / 80));
    for (let i = 0; i <= nx; i++) {
      const v = x0 + ((x1 - x0) * i) / nx;
      el("text", { x: X(v), y: H - 6, "text-anchor": i === 0 ? "start" : i === nx ? "end" : "middle", class: "ax" }, svg)
        .textContent = fmtDateShort(new Date(v));
    }
    if (opts.band) {
      el("rect", {
        x: m.l, width: W - m.l - m.r, y: Y(opts.band.hi), height: Math.max(0, Y(opts.band.lo) - Y(opts.band.hi)),
        fill: "var(--accent)", opacity: 0.08, rx: 4,
      }, svg);
    }
    for (const s of opts.series) {
      const pts = [...s.points].sort((a, b) => a.x - b.x);
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${X(+p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
      el("path", {
        d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-linejoin": "round",
        "stroke-linecap": "round", "stroke-dasharray": s.dashed ? "4 4" : "none", opacity: s.opacity ?? 1,
      }, svg);
      if (s.dots) {
        for (const p of pts) el("circle", { cx: X(+p.x), cy: Y(p.y), r: 2.5, fill: s.color, opacity: 0.55 }, svg);
      }
    }
    // hover
    const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--text-2)", "stroke-width": 1, opacity: 0 }, svg);
    const markers = opts.series.map(s => el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, opacity: 0 }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let best = null;
      for (const p of all) if (!best || Math.abs(+p.x - xv) < Math.abs(+best.x - xv)) best = p;
      if (!best) return;
      cross.setAttribute("x1", X(+best.x)); cross.setAttribute("x2", X(+best.x)); cross.setAttribute("opacity", 0.4);
      const rows = [];
      opts.series.forEach((s, i) => {
        let near = null;
        for (const p of s.points) if (!near || Math.abs(+p.x - +best.x) < Math.abs(+near.x - +best.x)) near = p;
        if (near && Math.abs(+near.x - +best.x) < 4 * 864e5) {
          markers[i].setAttribute("cx", X(+near.x)); markers[i].setAttribute("cy", Y(near.y)); markers[i].setAttribute("opacity", 1);
          rows.push(`<div class="tr"><span><i style="background:${s.color}"></i>${s.name}</span><b>${fmt(near.y)}</b></div>`);
        } else markers[i].setAttribute("opacity", 0);
      });
      const label = best.label || new Date(best.x).toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "numeric" });
      showTip(`<div class="th">${label}</div>${rows.join("")}`, ev);
    });
    hit.addEventListener("pointerleave", () => {
      hideTip(); cross.setAttribute("opacity", 0); markers.forEach(mk => mk.setAttribute("opacity", 0));
    });
    container.appendChild(svg);
  };
  draw();
  observe(container, draw);
}

// --- Pylväskaavio (myös pinottu) -------------------------------------------------
// opts: { labels:[str], series:[{name,color,values:[num]}], yFmt, height, tipLabels?:[str] }
export function barChart(container, opts) {
  const draw = () => {
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 180;
    const m = { t: 10, r: 8, b: 24, l: 40 };
    container.innerHTML = legendHTML(opts.series);
    const n = opts.labels.length;
    const totals = opts.labels.map((_, i) => opts.series.reduce((s, se) => s + (se.values[i] || 0), 0));
    const { hi, ticks } = niceTicks(0, Math.max(1e-9, ...totals));
    const fmt = opts.yFmt || ((v) => String(Math.round(v)));
    const Y = (v) => H - m.b - (v / (hi || 1)) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / n;
    const barW = Math.max(4, Math.min(36, bw * 0.62));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" });
    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "gl" }, svg);
      el("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "ax" }, svg).textContent = fmt(t);
    }
    const every = Math.ceil(n / Math.floor((W - m.l) / 44));
    opts.labels.forEach((lab, i) => {
      const cx = m.l + bw * i + bw / 2;
      if (i % every === 0 || i === n - 1)
        el("text", { x: cx, y: H - 6, "text-anchor": "middle", class: "ax" }, svg).textContent = lab;
      let acc = 0;
      const segs = opts.series.map(s => ({ s, v: s.values[i] || 0 })).filter(x => x.v > 0);
      segs.forEach((sg, k) => {
        const y1 = Y(acc), y2 = Y(acc + sg.v);
        const top = k === segs.length - 1;
        const h = Math.max(0, y1 - y2 - (top ? 0 : 2)); // 2px väli pinottujen välissä
        const x = cx - barW / 2;
        const r = top ? Math.min(4, barW / 2, h) : 0;
        const d = `M${x},${y1}V${y1 - h + r}${r ? `Q${x},${y1 - h} ${x + r},${y1 - h}` : ""}H${x + barW - r}${r ? `Q${x + barW},${y1 - h} ${x + barW},${y1 - h + r}` : ""}V${y1}Z`;
        el("path", { d, fill: sg.s.color }, svg);
        acc += sg.v;
      });
      const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => {
        const rows = opts.series.map(s => `<div class="tr"><span><i style="background:${s.color}"></i>${s.name}</span><b>${fmt(s.values[i] || 0)}</b></div>`);
        if (opts.series.length > 1) rows.push(`<div class="tr"><span>Yhteensä</span><b>${fmt(totals[i])}</b></div>`);
        showTip(`<div class="th">${(opts.tipLabels || opts.labels)[i]}</div>${rows.join("")}`, ev);
      });
      hit.addEventListener("pointerleave", hideTip);
    });
    container.appendChild(svg);
  };
  draw();
  observe(container, draw);
}

// --- Minikäyrä -------------------------------------------------------------------
export function sparkline(container, values, color = "var(--accent-hi)") {
  const draw = () => {
    const W = Math.max(100, container.clientWidth || 200), H = container.clientHeight || 40;
    container.innerHTML = "";
    const v = values.filter(x => x != null && isFinite(x));
    if (v.length < 2) return;
    const lo = Math.min(...v), hi = Math.max(...v);
    const X = (i) => 2 + (i / (v.length - 1)) * (W - 4);
    const Y = (y) => H - 3 - ((y - lo) / (hi - lo || 1)) * (H - 6);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, preserveAspectRatio: "none" });
    el("path", { d: v.map((y, i) => `${i ? "L" : "M"}${X(i)},${Y(y)}`).join(""), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    el("circle", { cx: X(v.length - 1), cy: Y(v[v.length - 1]), r: 3, fill: color }, svg);
    container.appendChild(svg);
  };
  draw();
  observe(container, draw);
}

// Piirtää uudelleen, kun leveys muuttuu
const observers = new WeakMap();
function observe(container, draw) {
  if (observers.has(container)) observers.get(container).disconnect();
  let w = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - w) > 20) { w = container.clientWidth; draw(); }
  });
  ro.observe(container);
  observers.set(container, ro);
}
