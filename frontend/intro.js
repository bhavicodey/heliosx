"use strict";
/* firescout intro: name -> purpose -> quick tour.
   Also runs the inspo + tour popups. Independent of the map, so it works even if the map is slow to load. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "firescout.profile";

  const body = document.body, intro = $("#intro");
  body.classList.add("intro-on");

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };

  // ------------------------------------------------------------ drifting embers
  const EMBER = ["#f0502d", "#ff8a3d", "#ffb347", "#e5391f", "#ffd27a"];
  if (!reduce) {
    const box = $("#petals");
    for (let i = 0; i < 34; i++) {
      const s = document.createElement("span"), size = 3 + Math.random() * 7, c = EMBER[Math.floor(Math.random() * EMBER.length)];
      s.className = "petal";
      s.style.left = Math.random() * 100 + "%";
      s.style.width = s.style.height = size + "px";
      s.style.background = c; s.style.boxShadow = `0 0 ${size * 2}px ${c}`;
      s.style.setProperty("--dur", 9 + Math.random() * 13 + "s");
      s.style.setProperty("--delay", -Math.random() * 22 + "s");
      s.style.setProperty("--sway", (Math.random() - .5) * 140 + "px");
      s.style.setProperty("--o", (0.35 + Math.random() * 0.5).toFixed(2));
      box.append(s);
    }
  }

  // ember trail that follows the cursor while the intro is open
  let lastTrail = 0;
  function trail(e) {
    const now = performance.now();
    if (now - lastTrail < 50) return;
    lastTrail = now;
    const s = document.createElement("span");
    s.className = "sparkle-trail";
    s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
    document.body.append(s);
    setTimeout(() => s.remove(), 900);
  }
  if (!reduce) addEventListener("pointermove", trail);

  // ember burst from a point
  function burst(x, y) {
    if (reduce) return;
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("span"), size = 4 + Math.random() * 8;
      s.className = "burst";
      const a = (Math.PI * 2 * i) / 26 + Math.random() * .4, d = 80 + Math.random() * 190;
      s.style.left = x + "px"; s.style.top = y + "px";
      s.style.width = s.style.height = size + "px";
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d + "px");
      document.body.append(s);
      setTimeout(() => s.remove(), 1200);
    }
  }

  // ------------------------------------------------------------ steps
  const sSensor = $("#s-sensor"), sName = $("#s-name"), sWhy = $("#s-why");
  const nameIn = $("#w-name"), otherIn = $("#w-other"), otherWrap = $("#w-other-wrap"), goBtn = $("#w-go");

  function go(next, focusEl) {
    const from = $(".step.active", intro);
    const show = () => { next.classList.add("active"); (focusEl || next.querySelector("input"))?.focus({ preventScroll: true }); };
    if (!from) return show();
    from.classList.remove("active"); from.classList.add("leaving");
    setTimeout(() => { from.classList.remove("leaving"); show(); }, reduce ? 0 : 340);
  }

  const saved = load();
  if (saved?.name) nameIn.value = saved.name;
  if (saved?.sensor) { const input = $(`input[name=welcome-sensor][value="${saved.sensor}"]`); if (input) input.checked = true; }
  go(sSensor, $("input[name=welcome-sensor]:checked"));
  sSensor.addEventListener("submit", (e) => {
    e.preventDefault();
    const sensor = $("input[name=welcome-sensor]:checked").value;
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: sensor }));
    go(sName, nameIn);
  });
  $("#w-sensor-back").addEventListener("click", () => go(sSensor, $("input[name=welcome-sensor]:checked")));

  sName.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { nameIn.classList.remove("shake"); void nameIn.offsetWidth; nameIn.classList.add("shake"); nameIn.focus(); return; }
    $("#w-hello").textContent = n;
    go(sWhy, $("input[name=why]", sWhy));
  });
  $("#w-back").addEventListener("click", () => go(sName, nameIn));

  $$("input[name=why]").forEach((r) => r.addEventListener("change", () => {
    goBtn.disabled = false;
    const isOther = r.value === "other" && r.checked;
    otherWrap.classList.toggle("open", isOther);
    if (isOther) setTimeout(() => otherIn.focus({ preventScroll: true }), 250);
  }));

  sWhy.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pick = $("input[name=why]:checked");
    if (!pick) return;
    const profile = { sensor: $("input[name=welcome-sensor]:checked").value, name: nameIn.value.trim(), purpose: pick.value, other: pick.value === "other" ? otherIn.value.trim() : "" };
    save(profile);
    const r = goBtn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    await sleep(reduce ? 0 : 650);
    finish(profile, true);
  });

  // ------------------------------------------------------------ personalise + reveal
  function personalize(p) {
    $("#lede").textContent = `welcome, ${p.name}. click anywhere on the globe to read the area.`;
    $$("#presets button").forEach((b) => b.classList.toggle("pick", (b.dataset.for || "").split(" ").includes(p.purpose)));
  }

  async function finish(profile, showTour) {
    personalize(profile);
    removeEventListener("pointermove", trail);
    intro.classList.add("leaving");
    await sleep(reduce ? 0 : 700);
    body.classList.remove("intro-on");           // panels float in
    await sleep(reduce ? 0 : 500);
    intro.hidden = true;
    if (showTour) { await sleep(reduce ? 0 : 500); openModal($("#tour")); }
  }

  if (location.search.includes("skip")) {          // handy for testing: /?skip
    const p = saved?.name ? saved : { name: "friend", purpose: "curiosity", other: "" };
    $$(".step", intro).forEach((s) => s.classList.remove("active"));
    intro.hidden = true; body.classList.remove("intro-on"); personalize(p);
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: saved?.sensor || "modis" }));
  }

  // ------------------------------------------------------------ modals
  let lastFocus = null;
  function openModal(m) { lastFocus = document.activeElement; m.hidden = false; (m.querySelector(".cta, .x, input") || m).focus?.({ preventScroll: true }); }
  function closeModal(m) { m.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }

  const tour = $("#tour"), inspo = $("#inspo");
  $("#tour-go").addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); burst(r.left + r.width / 2, r.top); closeModal(tour); });
  $("#help-btn").addEventListener("click", () => openModal(tour));
  $("#inspo-btn").addEventListener("click", () => openModal(inspo));
  $("#inspo-x").addEventListener("click", () => closeModal(inspo));
  [tour, inspo].forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); }));
  addEventListener("keydown", (e) => { if (e.key === "Escape") { [tour, inspo].forEach((m) => { if (!m.hidden) closeModal(m); }); } });
})();