"use strict";
/* firescout fire render.
   Opens when the user clicks inside the dashed area of interest. Plays the fire render and lays invisible
   "zones" over it that follow the fire as the camera moves (fire-track.json holds the fire's position per
   quarter second). Hovering a zone shows the matching satellite reading for the pinned area. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const modal = $("#render"), video = $("#r-video"), stage = $("#r-stage"), svg = $("#r-zones");
  const tip = $("#r-tip"), list = $("#r-list"), dots = $("#r-dots"), loading = $("#r-loading"), playBtn = $("#r-play");
  const zoneEl = Object.fromEntries([...svg.querySelectorAll(".zone")].map((z) => [z.dataset.zone, z]));

  // ---- what each zone means, and where its colour comes from (matches the app's layer colours)
  const ZONES = {
    fire:  { name: "fire pixels",      color: "#e5391f" },
    heat:  { name: "heat intensity",   color: "#f59e0b" },
    burn:  { name: "burned area",      color: "#7a2416" },
    smoke: { name: "smoke",            color: "#6a4bd8" },
    air:   { name: "air quality",      color: "#2457c5" },
  };
  const ORDER = ["fire", "heat", "burn", "smoke", "air"];
  for (const [k, z] of Object.entries(ZONES)) zoneEl[k].style.setProperty("--c", z.color);

  // ---- where the fire is in the frame (x0, x1, y0, y1 as fractions of the frame), sampled 4x a second
  let track = null, fps = 4;
  const FALLBACK = [0.24, 0.76, 0.40, 0.98];
  fetch("media/fire-track.json").then((r) => r.json()).then((j) => { track = j.track; fps = j.fps; }).catch(() => {});
  function box(t) {
    if (!track) return FALLBACK;
    const f = (t * fps) % track.length, i = Math.floor(f), j = (i + 1) % track.length, k = f - i;
    return track[i].map((v, n) => v + (track[j][n] - v) * k);
  }

  // ---- place the zones on the fire (svg units: 1600 x 900)
  let lastKey = "";
  function layout(t) {
    const [x0, x1, y0, y1] = box(t), W = 1600, H = 900;
    const key = [x0, x1, y0, y1].map((v) => v.toFixed(4)).join();
    if (key === lastKey) return; lastKey = key;
    const X0 = x0 * W, X1 = x1 * W, Y0 = y0 * H, Y1 = y1 * H, w = X1 - X0, h = Y1 - Y0, cx = (X0 + X1) / 2;
    const set = (el, o) => { for (const k in o) el.setAttribute(k, o[k]); };
    set(zoneEl.smoke, { x: 0.14 * W, y: 0.02 * H, width: 0.72 * W, height: Y0 - 0.02 * H + 0.03 * h });   // drifting particles above the flames
    set(zoneEl.heat,  { x: X0, y: Y0, width: w, height: 0.27 * h });                                        // flame tips
    set(zoneEl.fire,  { x: X0, y: Y0 + 0.2 * h, width: w, height: 0.8 * h });                               // the wall of flames
    set(zoneEl.burn,  { cx, cy: Y0 + 0.72 * h, rx: 0.36 * w, ry: 0.26 * h });                               // scorched ground in the middle
    const spots = { smoke: [cx, Y0 * 0.55], heat: [cx + w * 0.28, Y0 + 0.11 * h], fire: [X0 + w * 0.07, Y0 + 0.5 * h],
                    burn: [cx, Y0 + 0.74 * h], air: [0.08 * W, 0.55 * H] };
    if (!dots.children.length) for (const k of ORDER) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      g.setAttribute("r", 9); g.dataset.zone = k; g.style.setProperty("--c", ZONES[k].color); dots.append(g);
    }
    for (const g of dots.children) { const [x, y] = spots[g.dataset.zone]; g.setAttribute("cx", x); g.setAttribute("cy", y); }
  }
  function loop() {
    if (modal.hidden) return;
    layout(video.currentTime || 0);
    if (active && !pinned) placeTip(lastPointer); else if (pinned) placeTip(anchorOf(pinned));
    requestAnimationFrame(loop);
  }

  // ---- reading the numbers
  const fmtN = (n) => Number(n).toLocaleString();
  function heatLevel(n) { return n == null ? null : n === 0 ? "none detected" : n < 10 ? "low" : n < 50 ? "moderate" : "high"; }
  function info(zone) {
    const s = window.firescout.snapshot(), r = s.ins, win = `7 days to ${window.firescout.fmt(s.end)}`;
    const sensor = s.sensor.toUpperCase();
    const state = s.loading ? "loading" : !r ? "none" : "ok";
    const out = { zone, state, big: "", sub: "", note: "", short: "", chart: false };
    if (state === "loading") { out.big = "reading the satellites…"; out.short = "loading…"; return out; }
    if (state === "none") { out.big = "no reading yet"; out.sub = "firescout couldn't read this area for this date. try an earlier date."; out.short = "–"; return out; }
    if (zone === "fire") {
      out.big = r.fire_pixels == null ? "no data" : `${fmtN(r.fire_pixels)} fire pixels`;
      out.sub = `${sensor} detections within ${s.radius} km, ${win}.`;
      out.note = "each pixel is a ~1 km hotspot, not a single fire.";
      out.short = r.fire_pixels == null ? "–" : fmtN(r.fire_pixels);
    } else if (zone === "heat") {
      const lv = heatLevel(r.fire_pixels);
      out.big = lv ? `${lv}` : "no data";
      out.sub = r.fire_pixels == null ? "" : `worked out from ${fmtN(r.fire_pixels)} fire pixels in the area.`;
      out.note = "this is a relative level, not a temperature. low is under 10 pixels, moderate under 50.";
      out.short = lv || "–";
    } else if (zone === "burn") {
      const ha = r.burned_ha;
      out.big = ha == null ? "no data" : `${Math.round(ha).toLocaleString()} ha`;
      out.sub = `land that lost its greenery (dnbr above 0.27) within ${Math.min(s.radius, 150)} km, 30 days to ${window.firescout.fmt(s.end)}.`;
      out.note = "from sentinel-2. 0 can also mean there were no clear-sky photos.";
      out.short = ha == null ? "–" : `${Math.round(ha).toLocaleString()} ha`;
    } else if (zone === "smoke") {
      out.big = r.so2_du == null ? "no data" : `${r.so2_du.toFixed(2)} DU`;
      out.sub = r.so2_ratio == null ? `sulfur dioxide, ${win}.` : `sulfur dioxide, ${r.so2_ratio.toFixed(1)} times this area's 30-day normal (${win}).`;
      out.note = "sulfur dioxide travels with smoke plumes but isn't a smoke particle count. volcanoes and industry add it too.";
      out.short = r.so2_du == null ? "–" : `${r.so2_du.toFixed(2)} DU`;
    } else {
      out.big = r.signal === "alert" ? "alert" : r.signal === "watch" ? "watch" : "nothing unusual";
      out.sub = r.signal_reason;
      out.note = "fires and raised sulfur dioxide together means they co-occur, not that one caused the other. this isn't a pm2.5 or aqi reading.";
      out.chart = true;
      out.short = r.signal === "none" ? "calm" : r.signal;
    }
    out.level = r.signal;
    return out;
  }

  // ---- tooltip
  let active = null, pinned = null, lastPointer = { x: 0, y: 0, fromKey: false };
  function renderTip(zone) {
    const z = ZONES[zone], d = info(zone);
    tip.style.setProperty("--c", z.color);
    tip.dataset.state = d.state;
    tip.replaceChildren();
    const head = document.createElement("div"); head.className = "tip-head";
    const dot = document.createElement("i"), nm = document.createElement("b"); nm.textContent = z.name; head.append(dot, nm);
    const big = document.createElement("div"); big.className = "tip-big"; big.textContent = d.big;
    tip.append(head, big);
    if (d.sub) { const p = document.createElement("p"); p.className = "tip-sub"; p.textContent = d.sub; tip.append(p); }
    if (d.chart && d.state === "ok") {
      const cv = document.createElement("canvas"); cv.className = "tip-chart"; cv.height = 56; tip.append(cv);
      const cap = document.createElement("p"); cap.className = "tip-note"; cap.textContent = "daily sulfur dioxide, last 30 days"; tip.append(cap);
      requestAnimationFrame(() => window.firescout.drawSpark(window.firescout.snapshot().series, cv));
    }
    if (d.note) { const p = document.createElement("p"); p.className = "tip-note"; p.textContent = d.note; tip.append(p); }
  }
  function anchorOf(zone) {
    const el = dots.querySelector(`[data-zone="${zone}"]`), r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2 - sr.left, y: r.top + r.height / 2 - sr.top, fromKey: true };
  }
  function placeTip(pt) {
    if (tip.hidden || !pt) return;
    const sr = stage.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, gap = 18;
    let x = pt.x + gap, y = pt.y + gap;
    if (x + tw > sr.width - 8) x = pt.x - tw - gap;
    if (y + th > sr.height - 8) y = pt.y - th - gap;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
  function show(zone, pt) {
    active = zone; lastPointer = pt || lastPointer;
    renderTip(zone); tip.hidden = false; placeTip(pinned ? anchorOf(pinned) : lastPointer);
    for (const k of ORDER) { zoneEl[k].classList.toggle("on", k === zone); }
    for (const li of list.children) li.classList.toggle("on", li.dataset.zone === zone);
    stage.classList.add("reading");
  }
  function hide() {
    if (pinned) return;
    active = null; tip.hidden = true; stage.classList.remove("reading");
    for (const k of ORDER) zoneEl[k].classList.remove("on");
    for (const li of list.children) li.classList.remove("on");
  }
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  for (const k of ORDER) {
    const el = zoneEl[k];
    el.addEventListener("pointerenter", (e) => { if (!pinned) show(k, local(e)); });
    el.addEventListener("pointermove", (e) => { lastPointer = local(e); if (!pinned && active !== k) show(k, lastPointer); });
    el.addEventListener("pointerleave", () => { if (!pinned) hide(); });
    el.addEventListener("focus", () => { if (!pinned) show(k, anchorOf(k)); });
    el.addEventListener("blur", () => { if (!pinned) hide(); });
    el.addEventListener("click", (e) => { e.stopPropagation(); togglePin(k, local(e)); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePin(k, anchorOf(k)); } });
  }
  function togglePin(k, pt) {
    if (pinned === k) { pinned = null; hide(); return; }
    pinned = k; show(k, pt);
  }
  stage.addEventListener("click", (e) => { if (pinned && !e.target.classList?.contains("zone")) { pinned = null; hide(); } });

  // ---- side list (same five readings, easy to use on touch screens too)
  function buildList() {
    list.replaceChildren();
    for (const k of ORDER) {
      const li = document.createElement("li"); li.dataset.zone = k; li.style.setProperty("--c", ZONES[k].color);
      const b = document.createElement("button"); b.type = "button";
      const i = document.createElement("i"), n = document.createElement("span"), v = document.createElement("b");
      n.textContent = ZONES[k].name; b.append(i, n, v); li.append(b); list.append(li);
      b.addEventListener("pointerenter", () => { if (!pinned) show(k, anchorOf(k)); });
      b.addEventListener("pointerleave", () => { if (!pinned) hide(); });
      b.addEventListener("click", () => togglePin(k, anchorOf(k)));
    }
  }
  function refreshList() {
    for (const li of list.children) $("b", li).textContent = info(li.dataset.zone).short;
    if (active) renderTip(active);
  }
  buildList();
  window.addEventListener("firescout:readout", () => { if (!modal.hidden) { refreshTitle(); refreshList(); } });

  // ---- open / close
  let lastFocus = null, srcSet = false;
  function refreshTitle() {
    const s = window.firescout.snapshot();
    $("#r-title").textContent = s.place || "your area";
    $("#r-sub").textContent = `within ${s.radius} km · ${s.sensor.toUpperCase()} · 7 days to ${window.firescout.fmt(s.end)}`;
  }
  function open() {
    if (!modal.hidden) return;
    lastFocus = document.activeElement; pinned = null; active = null; tip.hidden = true; lastKey = "";
    refreshTitle(); refreshList();
    modal.hidden = false; $("#render-x").focus({ preventScroll: true });
    if (!srcSet) {
      srcSet = true; loading.hidden = false;
      video.addEventListener("loadeddata", () => { loading.hidden = true; }, { once: true });
      video.addEventListener("error", () => { loading.hidden = false; loading.textContent = "the render couldn't load. check that media/fire-render.mp4 is there."; }, { once: true });
      video.src = "media/fire-render.mp4"; video.load();
    }
    if (reduce) { video.pause(); setPlayLabel(); }
    else video.play().then(setPlayLabel).catch(setPlayLabel);
    requestAnimationFrame(loop);
  }
  function close() {
    if (modal.hidden) return;
    modal.hidden = true; video.pause(); pinned = null; hide();
    lastFocus?.focus?.({ preventScroll: true });
  }
  function setPlayLabel() { const p = video.paused; playBtn.textContent = p ? "play" : "pause"; playBtn.setAttribute("aria-label", p ? "play the render" : "pause the render"); }
  playBtn.addEventListener("click", (e) => { e.stopPropagation(); video.paused ? video.play() : video.pause(); });
  video.addEventListener("play", setPlayLabel); video.addEventListener("pause", setPlayLabel);

  $("#render-x").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) { if (pinned) { pinned = null; hide(); } else close(); } });

  window.FireRender = { open, close };
})();
