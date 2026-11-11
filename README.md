# firescout ♡

MODIS and VIIRS hotspot activity, a daily burning-activity calendar, sulfur dioxide and burn scars on an interactive globe, powered by Google Earth Engine.

## run it (the easy way)

1. **unzip** the folder anywhere.
2. **double-click the starter**
   - windows: `start.bat`
   - mac: `start.command` (first time: right-click → open)
   - linux: `./start.sh`
3. the first time, it asks for your **google cloud project id** (the one registered for earth engine at
   https://code.earthengine.google.com/register) and opens a google sign-in page once. that's it.
4. your browser opens firescout automatically. choose **MODIS or VIIRS**, answer the welcome questions and explore ♡

> prefer to set it up yourself? copy `.env.example` to `.env`, put your project id after `EE_PROJECT=`, and the starter will skip the question.

you need **python 3.10+** installed (https://www.python.org/downloads/ , tick "add python to PATH" on windows). everything else is automatic.

## what's inside

| layer | earth engine data | what it shows |
|---|---|---|
| sulfur dioxide | `COPERNICUS/S5P/OFFL/L3_SO2` (and `NRTI` for the last 10 days) | so2 column density, 7-day median, cloud-masked |
| active fires — MODIS | `FIRMS` (NASA MODIS; 1 km) | long-running historical hotspot record since 2000 |
| active fires — VIIRS | `NASA/VIIRS/002/VNP14A1` (daily 1 km VIIRS product) | detections from 2012, using FireMask classes 7–9 |
| burning activity calendar | the selected active-fire product | daily detection pixel counts and activity days for a pinned area |
| burn scars | `COPERNICUS/S2_SR_HARMONIZED` | dnbr burn severity, 30 days after vs. a pre-fire baseline |

click the globe to get a readout: fire pixels, so2 compared with that area's own 30-day normal, burned hectares and a 30-day so2 chart.
when fires and raised so2 show up together, the readout says so.

## things to try

- click **los angeles fires, jan 2025** under *try a place*.
- turn on **burn scars** after dropping a pin.
- press **play** to step through time three days at a time.
- pin a place, choose **watch this place**, then **check all for this date**.
- the **? how it works** button replays the quick tour any time.

## project layout

```
firescout/
├── start.bat / start.command / start.sh   one-click starters
├── run.py                 first-run setup + starts the server
├── check_ee.py            tests your earth engine connection
├── .env.example           copy to .env (run.py does this for you)
├── backend/
│   ├── config.py          thresholds, paths, env vars
│   ├── ee_client.py       earth engine start-up
│   ├── layers.py          all earth engine logic + layer colors (VIS)
│   └── main.py            fastapi endpoints + serves the frontend
└── frontend/
    ├── index.html         the app + intro questions + popups
    ├── intro.js           name → purpose → quick tour
    ├── app.js             map, layers, readout, timeline, watchlist
    └── style.css          the white / pink / red theme (colors are the variables at the top)
```

## tuning

- alert rules: `backend/config.py` (`ALERT_SO2_RATIO`, `WATCH_FIRE_PIXELS`, ...).
- map layer colors: `VIS` in `backend/layers.py` (legends update themselves).
- app colors: the `:root` variables at the top of `frontend/style.css`.
- the intro questions: `frontend/index.html` (look for `id="intro"`).
- "burned" threshold: dnbr above 0.27 in `burned_hectares()`.

## troubleshooting

| problem | fix |
|---|---|
| "set EE_PROJECT" banner | open `.env`, set your project id, restart. |
| "earth engine could not start" | run `start` again to redo the google sign-in; make sure the project is registered for earth engine and the earth engine api is enabled. |
| "no ... data for this window yet" | satellite data lags a few days. move the date earlier. |
| burn scars layer empty | pin an area first. sentinel-2 needs clear-sky images in the 30 days before the date. |
| slow first load | earth engine computes on demand. results are cached for an hour. |
| blank map | the page loads the map, fonts and tiles from the internet. check your connection. |

## notes on the science

- fire pixels are roughly 1 km modis hotspots, not individual fires.
- sulfur dioxide also comes from volcanoes and industry, so a spike next to fires means "co-occurring", not "caused by".
- so2 is shown in dobson units (1 du = 4.46e-4 mol/m²).
- dnbr is masked to land that was green before the fire (pre-fire nbr above 0.1) to cut false positives from water and bare ground.

## New: fire render with hover readings

Drop a pin, then **click inside the dashed area of interest** (or press **open fire render** in the readout panel, or click the pin itself). A fire render opens; hover or tap parts of it to read the satellite data for that area:

| hover this | shows |
|---|---|
| flame tips | **heat intensity**: a relative level (none / low / moderate / high) worked out from the fire pixel count |
| wall of flames | **fire pixels**: detections for the selected sensor (MODIS or VIIRS) |
| scorched ground | **burned area**: hectares from the Sentinel-2 dNBR burn scar |
| smoke above the fire | **smoke**: sulfur dioxide in DU and how it compares with the area's 30-day normal |
| surrounding glow | **air quality**: the alert / watch signal plus the 30-day sulfur dioxide chart |

Notes:
- clicking *outside* the dashed area still drops a new pin. inside it opens the render.
- the render is an illustration, not a simulation. the numbers are the same readings as the right-hand panel.
- heat intensity is derived from the fire pixel count (thresholds in `heatLevel()` in `render.js`). no temperature is measured yet.
- hover zones follow the fire as the camera moves, using `media/fire-track.json`. if you swap the video, regenerate that file (or delete it and the zones fall back to a fixed box).
- to change the render, replace `media/fire-render.mp4` and `media/fire-render-poster.jpg`.

## New: MODIS / VIIRS and daily calendar

When the application opens, choose one of **two satellite options**: **MODIS** (longer history, starting November 2000) or **VIIRS** (daily VNP14A1 series starting January 2012). You can change the choice at any time in the left panel. The map, area hotspot readout, watched-place checks and daily calendar all use the same selected sensor.

**To see the calendar:** drop a pin or select a suggested place. Use the arrows beside the month to go backward or forward. Colored dates represent daily active-fire detection pixels within the selected radius; click a date to change the main timeline. Gray hatched dates indicate missing observations or data not yet released.

**Scientific limitations:** This version is a *sensor-selectable* historical calendar, not a validated merged or statistically cross-calibrated MODIS–VIIRS product. MODIS FIRMS and the VIIRS VNP14A1 composite have different detection sensitivity and sampling. Daily pixel totals across sensors should **not** be directly compared, added, or interpreted as number of unique fires, prescribed burns, burned hectares, or emissions. Color levels are relative to the maximum of the **displayed month**, not directly comparable across months. The selected VIIRS Earth Engine dataset is a **1 km daily composite**; it is **not** the 375 m VIIRS FIRMS product. Formal harmonization would require calibration against overlapping years, consistent quality masks, and validation. NASA's underlying VIIRS 375 m FIRMS product is a possible future enhancement.

Dataset references:
- https://developers.google.com/earth-engine/datasets/catalog/FIRMS
- https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP14A1

Google Earth Engine credentials are required for satellite queries; an offline or unauthenticated ZIP cannot display live detections. The ZIP intentionally excludes your `.env`, `.venv`, Git history, caches, and other local-only files. Copy `.env.example` to `.env` and set a Google Earth Engine project or follow the built-in launcher.
"# heliosx" 
