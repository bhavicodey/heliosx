"use strict";

if (typeof maplibregl === "undefined") {
  const b = document.getElementById("setup");
  b.hidden = false;
  b.textContent = "the map couldn't load. check your internet connection and refresh the page";
  throw new Error("maplibre-gl failed to load");
}

// ---------------------------------------------------------------- constants
const DAY = 86400000;
const FIRST = { modis: Date.UTC(2000, 10, 1), viirs: Date.UTC(2012, 0, 19) };
let MIN_DATE = FIRST.modis; // fire archives precede the Sentinel-5P record (2018)
const LATEST = (() => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - 3 * DAY; })();
const ORDER = ["so2", "burn", "fire"];             // bottom -> top
const LABEL = { so2: "sulfur dioxide", fire: "active fires", burn: "burn scars" };
const WATCH_KEY = "firescout.watch";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmt = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampDate = (ms) => Math.min(LATEST, Math.max(MIN_DATE, ms));
const wrapLng = (l) => ((l + 540) % 360) - 180;
const place = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

const state = {
  end: LATEST,
  sensor: (() => { try { return JSON.parse(localStorage.getItem("firescout.profile") || "null")?.sensor === "viirs" ? "viirs" : "modis"; } catch { return "modis"; } })(),
  calendarMonth: null,
  calendarToken: 0,
  pin: null,
  radius: 150,
  layers: { so2: { on: true, opacity: 0.7 }, fire: { on: true, opacity: 1 }, burn: { on: false, opacity: 0.9 } },
  tokens: { so2: 0, fire: 0, burn: 0, read: 0 },
  playing: false,
  spinning: !reduceMotion,
  watch: [],
  levels: {},
  readout: { ins: null, series: [], loading: false },   // latest numbers for the pinned area (the fire render reads these)
};

// ---------------------------------------------------------------- api + ui helpers
let pending = 0;
async function api(path, params = {}) {
  pending++; document.body.classList.add("loading");
  try {
    const res = await fetch(`/api/${path}?${new URLSearchParams(params)}`);
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : msg; } catch { /* keep statusText */ }
      throw new Error(msg);
    }
    return await res.json();
  } finally {
    if (--pending === 0) document.body.classList.remove("loading");
  }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 5200);
}
function setStatus(name, text, kind = "") {
  const el = $(`.layer[data-layer="${name}"] .status`); el.textContent = text; el.dataset.kind = kind;
}

// ---------------------------------------------------------------- bridge to the fire render (render.js)
function notifyReadout() { window.dispatchEvent(new CustomEvent("firescout:readout")); }
window.firescout = {
  fmt, iso, DAY, drawSpark: (rows, cv) => drawSpark(rows, cv),
  snapshot: () => ({
    pin: state.pin, radius: state.radius, end: state.end, sensor: state.sensor,
    place: state.pin ? place(state.pin.lat, state.pin.lon) : "",
    ins: state.readout.ins, series: state.readout.series, loading: state.readout.loading,
  }),
};
const RENDER_SEEN = "firescout.renderSeen";
const renderSeen = () => { try { return localStorage.getItem(RENDER_SEEN) === "1"; } catch { return true; } };
function openRender() {
  if (!state.pin || !window.FireRender) return;
  try { localStorage.setItem(RENDER_SEEN, "1"); } catch { /* storage blocked */ }
  window.FireRender.open();
}
// is a point inside the dashed area of interest around the pin?
function insideArea(lat, lon) {
  if (!state.pin) return false;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat - state.pin.lat) * rad, dLon = (lon - state.pin.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(state.pin.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) <= state.radius;
}

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [-100, 28], zoom: innerWidth < 820 ? 0.9 : 1.6,
  attributionControl: { compact: true },
});
map.on("style.load", () => {
  map.setProjection({ type: "globe" });
  try { map.setSky({ "sky-color": "#4f8fd6", "horizon-color": "#bcd9f2", "fog-color": "#dbe9f6", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] }); } catch { /* older builds */ }
  tintBasemap();
});

// Earth palette: calm sea blue + soft sage land. Both are light and low-saturation so the data colors
// (fire red, sulfur purple, burn brown) are the only strong colors on the map.
const EARTH = {
  land: "#e3e8d2", green: "#d3e1bd", forest: "#c2d6a8", ice: "#f1f6fa", sea: "#a3cbe6", river: "#8fbbdc",
  building: "#d8dccb", road: "#f7f4ea", border: "#7f8da3", label: "#2b3647", seaLabel: "#356791", halo: "rgba(255,255,255,.85)",
};
function tintBasemap() {
  const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch { /* layer doesn't have it */ } };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === "background") set(id, "background-color", EARTH.land);
    else if (l.type === "fill") {
      if (/water/.test(id)) set(id, "fill-color", EARTH.sea);
      else if (/glacier|ice|snow/.test(id)) set(id, "fill-color", EARTH.ice);
      else if (/wood|forest/.test(id)) set(id, "fill-color", EARTH.forest);
      else if (/park|landcover|grass|nature|reserve|farm/.test(id)) set(id, "fill-color", EARTH.green);
      else if (/building/.test(id)) set(id, "fill-color", EARTH.building);
    } else if (l.type === "line") {
      if (/boundary|admin/.test(id)) set(id, "line-color", EARTH.border);
      else if (/waterway/.test(id)) set(id, "line-color", EARTH.river);
      else if (/highway|road|street|tunnel|bridge|motorway|path|rail/.test(id)) set(id, "line-color", EARTH.road);
    } else if (l.type === "symbol") {
      const sea = /water|ocean|sea|marine/.test(id);
      set(id, "text-color", sea ? EARTH.seaLabel : EARTH.label); set(id, "text-halo-color", EARTH.halo);
    }
  }
}

const pinEl = document.createElement("div");
pinEl.className = "pin"; pinEl.innerHTML = "<span></span>";
const marker = new maplibregl.Marker({ element: pinEl });

function circle(lat, lon, km, n = 96) {
  const R = 6371, d = km / R, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180, pts = [];
  for (let i = 0; i <= n; i++) {
    const b = 2 * Math.PI * i / n;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    pts.push([l2 * 180 / Math.PI, p2 * 180 / Math.PI]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] } };
}

function beforeIdFor(name) {
  for (const n of ORDER.slice(ORDER.indexOf(name) + 1)) if (map.getLayer("L-" + n)) return "L-" + n;
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id || "area-fill";
}
function removeRaster(name) {
  if (map.getLayer("L-" + name)) map.removeLayer("L-" + name);
  if (map.getSource("S-" + name)) map.removeSource("S-" + name);
}
function setRaster(name, url) {
  removeRaster(name);
  map.addSource("S-" + name, { type: "raster", tiles: [url], tileSize: 256, maxzoom: 12 });
  map.addLayer({
    id: "L-" + name, type: "raster", source: "S-" + name,
    paint: { "raster-opacity": state.layers[name].opacity, "raster-resampling": name === "so2" ? "linear" : "nearest" },
  }, beforeIdFor(name));
}

// ---------------------------------------------------------------- layers
const windowNote = (name) => name === "burn"
  ? `30 days to ${fmt(state.end)}, within ${Math.min(state.radius, 150)} km of the pin`
  : `7 days to ${fmt(state.end)}`;

function tileParams() {
  const p = { start: iso(state.end - 6 * DAY), end: iso(state.end), radius_km: state.radius, sensor: state.sensor };
  if (state.pin) { p.lat = state.pin.lat; p.lon = state.pin.lon; }
  return p;
}

async function loadLayer(name) {
  const token = ++state.tokens[name];
  if (!state.layers[name].on) { removeRaster(name); setStatus(name, ""); return; }
  if (name === "burn" && !state.pin) { removeRaster(name); setStatus(name, "Click the globe to choose an area first."); return; }
  setStatus(name, "loading…");
  try {
    const { url } = await api(`tiles/${name}`, tileParams());
    if (token !== state.tokens[name]) return;
    setRaster(name, url); setStatus(name, windowNote(name));
  } catch (err) {
    if (token !== state.tokens[name]) return;
    removeRaster(name); setStatus(name, err.message, "warn");
  }
}

async function refreshAll() {
  updateTimelineText();
  await Promise.all([...ORDER.map(loadLayer), state.pin ? analyze() : null]);
}
let refreshTimer;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 300); };

// ---------------------------------------------------------------- pin + readout
function setPin(lat, lon, { refresh = true } = {}) {
  state.pin = { lat, lon };
  marker.setLngLat([lon, lat]).addTo(map);
  map.getSource("area")?.setData(circle(lat, lon, state.radius));
  $("#place").textContent = place(lat, lon);
  $("#place-sub").textContent = `Within ${state.radius} km`;
  $("#watch-add").disabled = false;
  $("#render-open").disabled = false;
  state.readout = { ins: null, series: [], loading: false }; notifyReadout();
  if (refresh) refreshAll();
  loadCalendar();
}

async function analyze() {
  if (!state.pin) return;
  const token = ++state.tokens.read, { lat, lon } = state.pin;
  $("#readout").classList.add("busy");
  state.readout.loading = true; notifyReadout();
  const base = { lat, lon, radius_km: state.radius, end: iso(state.end), sensor: state.sensor };
  const [ins, ser] = await Promise.allSettled([
    api("insights", { ...base, start: iso(state.end - 6 * DAY) }),
    api("so2_series", { ...base, days: 30 }),
  ]);
  if (token !== state.tokens.read) return;
  $("#readout").classList.remove("busy");
  if (ins.status === "fulfilled") renderInsights(ins.value); else { renderInsights(null); toast(ins.reason.message); }
  drawSpark(ser.status === "fulfilled" ? ser.value : []);
  state.readout = { ins: ins.status === "fulfilled" ? ins.value : null, series: ser.status === "fulfilled" ? ser.value : [], loading: false };
  notifyReadout();
  $("#spark-cap").textContent = `Daily sulfur dioxide in Dobson units, 30 days to ${fmt(state.end)}`;
  $("#place-sub").textContent = `Within ${state.radius} km, 7 days to ${fmt(state.end)}`;
}

function renderInsights(r) {
  const sig = $("#signal");
  if (!r) { sig.dataset.level = "none"; sig.classList.remove("seen"); sig.textContent = "No reading for this window."; return; }
  $("#v-fire").textContent = r.fire_pixels == null ? "No data" : r.fire_pixels.toLocaleString();
  $("#v-so2").firstChild.textContent = r.so2_du == null ? "No data" : `${r.so2_du.toFixed(2)} DU`;
  $("#n-so2").textContent = r.so2_ratio == null ? "" : `${r.so2_ratio.toFixed(1)} times the 30-day normal`;
  $("#v-burn").textContent = r.burned_ha == null ? "No data" : `${Math.round(r.burned_ha).toLocaleString()} ha`;
  sig.dataset.level = r.signal; sig.classList.add("seen"); sig.textContent = r.signal_reason;
}

function drawSpark(rows, cv = $("#spark")) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const vals = rows.map((r) => r.v), ok = vals.filter((v) => v != null);
  const css = getComputedStyle(document.documentElement), col = css.getPropertyValue("--so2").trim(), mut = css.getPropertyValue("--muted").trim();
  if (ok.length < 2) { g.fillStyle = mut; g.font = "13px sans-serif"; g.fillText("not enough clear-sky days to chart.", 4, h / 2); return; }
  const lo = Math.min(0, ...ok), hi = Math.max(...ok) * 1.15 || 1;
  const x = (i) => 4 + i * (w - 8) / (rows.length - 1), y = (v) => h - 6 - (v - lo) / (hi - lo) * (h - 14);
  g.strokeStyle = mut; g.globalAlpha = .35; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(4, y(0)); g.lineTo(w - 4, y(0)); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1; g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = "round";
  let open = false; g.beginPath();
  vals.forEach((v, i) => { if (v == null) { open = false; return; } open ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); open = true; });
  g.stroke();
  const last = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
  g.fillStyle = col; g.beginPath(); g.arc(x(last), y(vals[last]), 3.5, 0, 7); g.fill();
}

// ---------------------------------------------------------------- timeline
const slider = $("#slider"), dateInput = $("#date");
function configureDateLimits() { slider.max = Math.round((LATEST - MIN_DATE) / DAY); dateInput.min = iso(MIN_DATE); dateInput.max = iso(LATEST); }
configureDateLimits();

function updateTimelineText() {
  slider.value = Math.round((state.end - MIN_DATE) / DAY);
  dateInput.value = iso(state.end);
  $("#window-note").textContent = `Sulfur dioxide and fires: 7 days to ${fmt(state.end)}. Burn scars: 30 days to ${fmt(state.end)}.`;
}
function setDate(ms, { refresh = true } = {}) {
  state.end = clampDate(ms); updateTimelineText();
  if (refresh) scheduleRefresh();
  if (state.pin) { const current = new Date(state.end); const ym = `${current.getUTCFullYear()}-${String(current.getUTCMonth()+1).padStart(2,"0")}`; if (ym !== state.calendarMonth) loadCalendar(); }
}
slider.addEventListener("input", () => { state.end = clampDate(MIN_DATE + slider.value * DAY); dateInput.value = iso(state.end); });
slider.addEventListener("change", () => setDate(MIN_DATE + slider.value * DAY));
dateInput.addEventListener("change", () => dateInput.value && setDate(Date.parse(dateInput.value)));

async function togglePlay() {
  const btn = $("#play");
  if (state.playing) { state.playing = false; btn.textContent = "play"; return; }
  state.playing = true; btn.textContent = "pause";
  if (state.end + 3 * DAY > LATEST) setDate(LATEST - 30 * DAY, { refresh: false });
  while (state.playing && state.end + 3 * DAY <= LATEST) {
    setDate(state.end + 3 * DAY, { refresh: false });
    await refreshAll(); await sleep(500);
  }
  state.playing = false; btn.textContent = "play";
}
$("#play").addEventListener("click", togglePlay);

// ---------------------------------------------------------------- controls
$$(".layer").forEach((row) => {
  const name = row.dataset.layer;
  $("input[type=checkbox]", row).addEventListener("change", (e) => { state.layers[name].on = e.target.checked; loadLayer(name); });
  $(".opacity", row).addEventListener("input", (e) => {
    state.layers[name].opacity = +e.target.value;
    if (map.getLayer("L-" + name)) map.setPaintProperty("L-" + name, "raster-opacity", +e.target.value);
  });
});
function setLayerOn(name, on) { state.layers[name].on = on; $(`.layer[data-layer="${name}"] input[type=checkbox]`).checked = on; }

$("#radius").addEventListener("input", (e) => { state.radius = +e.target.value; $("#radius-val").textContent = `${state.radius} km`; });
$("#radius").addEventListener("change", () => { if (state.pin) setPin(state.pin.lat, state.pin.lon); });

$$(".presets button").forEach((b) => b.addEventListener("click", () => {
  stopSpin();
  const lat = +b.dataset.lat, lon = +b.dataset.lon;
  state.radius = +b.dataset.radius; $("#radius").value = state.radius; $("#radius-val").textContent = `${state.radius} km`;
  setLayerOn("so2", true); setLayerOn("fire", true); setLayerOn("burn", b.dataset.burn === "1");
  setDate(Date.parse(b.dataset.date), { refresh: false });
  setPin(lat, lon, { refresh: false });
  map.flyTo({ center: [lon, lat], zoom: +b.dataset.zoom, duration: reduceMotion ? 0 : 2400 });
  refreshAll();
}));

// click inside the dashed area -> open the fire render; click anywhere else -> (re)drop the pin
map.on("click", (e) => {
  stopSpin();
  const lat = e.lngLat.lat, lon = wrapLng(e.lngLat.lng);
  if (state.pin && insideArea(lat, lon)) { openRender(); return; }
  setPin(lat, lon);
  if (!renderSeen()) toast("pinned. now click inside the dashed area to open the fire render.");
});
map.on("mousemove", (e) => {
  const over = !!state.pin && insideArea(e.lngLat.lat, wrapLng(e.lngLat.lng));
  map.getCanvas().style.cursor = over ? "pointer" : "";
  if (map.getLayer("area-fill")) map.setPaintProperty("area-fill", "fill-opacity", over ? 0.16 : 0.06);
});
$("#render-open").addEventListener("click", openRender);

$$(".panel-toggle").forEach((btn) => btn.addEventListener("click", () => {
  const p = btn.closest(".panel"); const c = p.classList.toggle("collapsed"); btn.setAttribute("aria-expanded", String(!c));
}));
if (innerWidth < 820) $$(".panel-toggle").forEach((b) => b.click());

// ---------------------------------------------------------------- globe spin (stops at first touch)
function spin() {
  if (!state.spinning || map.getZoom() > 3) return;
  const c = map.getCenter(); c.lng += 8;
  map.easeTo({ center: c, duration: 1000, easing: (t) => t });
}
function stopSpin() { state.spinning = false; $("#spin")?.setAttribute("aria-pressed", "false"); hideHint(); }
["mousedown", "touchstart", "wheel", "keydown"].forEach((ev) => map.getCanvas().addEventListener(ev, stopSpin, { passive: true }));
const hideHint = () => $("#hint")?.classList.add("gone");
map.on("moveend", spin);

// ---------------------------------------------------------------- map toolbar
const HOME = { center: [-100, 28], zoom: innerWidth < 820 ? 0.9 : 1.6, bearing: 0, pitch: 0 };
const ease = reduceMotion ? 0 : 600;
$("#spin").setAttribute("aria-pressed", String(state.spinning));
$("#zoom-in").addEventListener("click", () => { stopSpin(); map.zoomIn({ duration: ease }); });
$("#zoom-out").addEventListener("click", () => { stopSpin(); map.zoomOut({ duration: ease }); });
$("#compass").addEventListener("click", () => { stopSpin(); map.resetNorthPitch({ duration: ease }); });
$("#home").addEventListener("click", () => { stopSpin(); map.flyTo({ ...HOME, duration: reduceMotion ? 0 : 1600 }); });
$("#spin").addEventListener("click", () => {
  state.spinning = !state.spinning;
  $("#spin").setAttribute("aria-pressed", String(state.spinning));
  if (state.spinning) { if (map.getZoom() > 3) map.flyTo({ ...HOME, duration: reduceMotion ? 0 : 1600 }); else spin(); }
});
let flat = false;
$("#proj").addEventListener("click", () => {
  flat = !flat; stopSpin();
  map.setProjection({ type: flat ? "mercator" : "globe" });
  const b = $("#proj");
  b.setAttribute("aria-label", flat ? "switch to globe" : "switch to flat map"); b.dataset.tip = flat ? "globe" : "flat map";
  b.setAttribute("aria-pressed", String(flat));
});
map.on("rotate", () => { const c = $("#compass svg"); if (c) c.style.transform = `rotate(${-map.getBearing()}deg)`; });
map.on("dragstart", hideHint); map.on("click", hideHint);
setTimeout(hideHint, 25000);

// step the date one day at a time
$("#prev-day").addEventListener("click", () => setDate(state.end - DAY));
$("#next-day").addEventListener("click", () => setDate(state.end + DAY));

// ---------------------------------------------------------------- watchlist
function loadWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch { return []; } }
function saveWatch() { try { localStorage.setItem(WATCH_KEY, JSON.stringify(state.watch)); } catch { /* storage blocked */ } }

function renderWatch() {
  const ul = $("#watchlist"); ul.replaceChildren();
  state.watch.forEach((w, i) => {
    const li = document.createElement("li");
    const dot = document.createElement("span"); dot.className = "dot"; dot.dataset.level = state.levels[w.id] || ""; dot.title = "Status for the chosen date";
    const go = document.createElement("button"); go.className = "go"; go.type = "button"; go.textContent = w.name;
    go.addEventListener("click", () => {
      stopSpin(); state.radius = w.radius; $("#radius").value = w.radius; $("#radius-val").textContent = `${w.radius} km`;
      setPin(w.lat, w.lon); map.flyTo({ center: [w.lon, w.lat], zoom: 6, duration: reduceMotion ? 0 : 1800 });
    });
    const rm = document.createElement("button"); rm.className = "rm"; rm.type = "button"; rm.textContent = "remove"; rm.setAttribute("aria-label", `Remove ${w.name}`);
    rm.addEventListener("click", () => { state.watch.splice(i, 1); saveWatch(); renderWatch(); });
    li.append(dot, go, rm); ul.append(li);
  });
  $("#watch-empty").hidden = state.watch.length > 0;
  $("#watch-check").hidden = state.watch.length === 0;
}

function askName(def) {
  return new Promise((resolve) => {
    const m = $("#namer"), input = $("#namer-input"), form = $("#namer-form"), cancel = $("#namer-cancel");
    input.value = def; m.hidden = false; input.focus(); input.select();
    const ac = new AbortController();
    const done = (v) => { ac.abort(); m.hidden = true; resolve(v); };
    form.addEventListener("submit", (e) => { e.preventDefault(); done(input.value.trim()); }, { signal: ac.signal });
    cancel.addEventListener("click", () => done(""), { signal: ac.signal });
    m.addEventListener("click", (e) => { if (e.target === m) done(""); }, { signal: ac.signal });
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") done(""); }, { signal: ac.signal });
  });
}

$("#watch-add").addEventListener("click", async () => {
  if (!state.pin) return;
  const name = await askName(place(state.pin.lat, state.pin.lon));
  if (!name) return;
  state.watch.push({ id: String(Date.now()), name, lat: state.pin.lat, lon: state.pin.lon, radius: state.radius });
  saveWatch(); renderWatch();
});

$("#watch-check").addEventListener("click", async () => {
  const btn = $("#watch-check"); btn.disabled = true; btn.textContent = "checking…";
  await Promise.all(state.watch.map(async (w) => {
    try {
      const r = await api("insights", { start: iso(state.end - 6 * DAY), end: iso(state.end), lat: w.lat, lon: w.lon, radius_km: w.radius, sensor: state.sensor });
      state.levels[w.id] = r.signal;
      if (r.signal === "alert") toast(`${w.name}: ${r.signal_reason}`);
    } catch (err) { toast(`${w.name}: ${err.message}`); }
  }));
  renderWatch(); btn.disabled = false; btn.textContent = "check all for this date";
});


// ---------------------------------------------------------------- selected satellite and daily burning calendar
const SENSOR_DETAILS = {
  modis: "MODIS FIRMS · active-fire record from Nov 2000 · ~1 km pixels",
  viirs: "VIIRS VNP14A1 · daily fire-mask composite from Jan 2012 · 1 km grid",
};
function selectSensor(sensor) {
  if (!FIRST[sensor]) return;
  state.sensor = sensor;
  MIN_DATE = FIRST[sensor];
  configureDateLimits();
  state.end = clampDate(state.end);
  $$(".sensor-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sensor === sensor)));
  $("#sensor-detail").textContent = SENSOR_DETAILS[sensor];
  $("#fire-source-caption").textContent = sensor === "modis" ? "MODIS FIRMS hotspots" : "VIIRS VNP14A1 fire-mask detections";
  $("#v-fire").textContent = "–";
  updateTimelineText();
  loadCalendar();
  loadLayer("fire");
  if (state.pin) analyze();
}
$$(".sensor-switch button").forEach((b) => b.addEventListener("click", () => selectSensor(b.dataset.sensor)));
window.addEventListener("firescout:sensor", (e) => selectSensor(e.detail));

function calendarMonthParts() {
  const d = new Date(state.end);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}
function showCalendar(days, year, month) {
  const box = $("#fire-calendar"); box.replaceChildren();
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  for (let i = 0; i < offset; i++) { const blank = document.createElement("span"); blank.className = "cal-blank"; box.append(blank); }
  const maximum = Math.max(1, ...days.map(d => d.count || 0));
  for (const d of days) {
    const btn = document.createElement("button"); btn.type = "button";
    const day = Number(d.date.slice(-2)); btn.className = "cal-day";
    btn.textContent = day;
    const hasData = d.count !== null && d.count !== undefined;
    btn.dataset.intensity = !hasData ? "missing" : !d.count ? "0" : String(Math.min(4, Math.max(1, Math.ceil(4 * d.count / maximum))));
    btn.title = `${d.date}: ${hasData ? d.count.toLocaleString() + " detected fire pixels" : "No observation available"}`;
    btn.setAttribute("aria-label", btn.title);
    btn.classList.toggle("chosen", d.date === iso(state.end));
    btn.disabled = Date.parse(d.date) < FIRST[state.sensor] || Date.parse(d.date) > LATEST;
    btn.addEventListener("click", () => setDate(Date.parse(d.date)));
    box.append(btn);
  }
}
async function loadCalendar() {
  const token = ++state.calendarToken;
  const [year, month] = calendarMonthParts();
  const ym = `${year}-${String(month).padStart(2,"0")}`;
  state.calendarMonth = ym;
  $("#cal-title").textContent = new Date(Date.UTC(year, month-1, 1)).toLocaleDateString("en-US", {month:"long", year:"numeric", timeZone:"UTC"});
  const cal = $("#fire-calendar");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const empty = Array.from({length: daysInMonth}, (_, i) => ({date:`${ym}-${String(i+1).padStart(2,"0")}`, count:null}));
  showCalendar(empty, year, month);
  if (!state.pin) { $("#calendar-note").textContent = "drop a pin or choose a preset to see daily activity."; return; }
  $("#calendar-note").textContent = `loading ${state.sensor.toUpperCase()} daily detections…`;
  try {
    const r = await api("fire_calendar", {year, month, sensor:state.sensor, lat:state.pin.lat, lon:state.pin.lon, radius_km:state.radius});
    if (token !== state.calendarToken) return;
    showCalendar(r.days, year, month);
    const active = r.days.filter(d => d.count > 0).length;
    const observed = r.days.filter(d => d.count !== null).length;
    $("#calendar-note").textContent = `${active} days with detections · ${observed} days with data · ${state.sensor.toUpperCase()}`;
  } catch (err) { if (token === state.calendarToken) $("#calendar-note").textContent = err.message; }
}
function moveCalendar(delta) {
  const [year, month] = calendarMonthParts();
  const target = Date.UTC(year, month - 1 + delta, Math.min(new Date(state.end).getUTCDate(), 28));
  if (target < MIN_DATE || target > LATEST) return;
  setDate(target);
}
$("#cal-prev").addEventListener("click", () => moveCalendar(-1));
$("#cal-next").addEventListener("click", () => moveCalendar(1));

// ---------------------------------------------------------------- boot
async function boot() {
  state.watch = loadWatch(); renderWatch(); selectSensor(state.sensor);

  try {
    const meta = await api("meta");
    for (const [name, m] of Object.entries(meta)) {
      const row = $(`.layer[data-layer="${name}"]`);
      $(".bar", row).style.background = `linear-gradient(90deg, ${m.palette.join(", ")})`;
      $(".lo", row).textContent = m.legend_min; $(".hi", row).textContent = m.legend_max;
    }
  } catch { /* legends are cosmetic */ }

  await new Promise((r) => (map.loaded() ? r() : map.once("load", r)));
  map.addSource("area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#161a26", "fill-opacity": 0.06 } });
  map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#161a26", "line-opacity": .9, "line-width": 1.6, "line-dasharray": [2, 2] } });
  spin();

  const h = await api("health").catch((e) => ({ ok: false, error: e.message }));
  if (!h.ok) {
    const s = $("#setup"); s.hidden = false;
    s.textContent = `Earth Engine is not connected yet. ${h.error}`;
    return;
  }
  refreshAll();
}
boot();