"""FireScout API + static frontend.  Run:  python run.py"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Optional

import ee
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import config, ee_client
from . import layers as L

log = logging.getLogger("firescout")
app = FastAPI(title="FireScout")

_cache: dict = {}


def cached(key, fn, ttl=config.CACHE_SECONDS):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def require_ee():
    try:
        ee_client.ensure()
    except ee_client.EENotReady as exc:
        raise HTTPException(503, str(exc)) from exc


def check_dates(start: str, end: str):
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e < s or (e - s).days > 40:
        raise HTTPException(400, "Date window must be between 1 and 40 days.")
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")


def safe(fn):
    """Run an Earth Engine call; return None instead of failing the whole request."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        log.warning("Earth Engine call failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    try:
        ee_client.ensure()
        return {"ok": True, "project": config.EE_PROJECT}
    except ee_client.EENotReady as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/meta")
def meta():
    return L.META


@app.get("/api/tiles/{layer}", dependencies=[Depends(require_ee)])
def tiles(
    layer: str,
    start: str,
    end: str,
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern="^(modis|viirs)$"),
):
    if layer not in L.VIS:
        raise HTTPException(404, "Unknown layer.")
    check_dates(start, end)
    if layer == "burn" and (lat is None or lon is None):
        raise HTTPException(400, "Click the globe to choose an area for burn scars.")

    key = ("tiles", layer, start, end,
           round(lat, 2) if layer == "burn" else None,
           round(lon, 2) if layer == "burn" else None,
           radius_km if layer == "burn" else None, sensor if layer == "fire" else None)

    def build():
        if layer == "so2":
            if L.so2_collection(start, end).size().getInfo() == 0:
                raise HTTPException(404, "No sulfur dioxide data for this window yet. Try an earlier date.")
            img = L.so2_tile_image(start, end)
        elif layer == "fire":
            if L.fire_collection(start, end, sensor).size().getInfo() == 0:
                raise HTTPException(404, "No fire data for this window yet. Try an earlier date.")
            img = L.fire_tile_image(start, end, sensor)
        else:
            region = ee.Geometry.Point([lon, lat]).buffer(radius_km * 1000)
            (_, _), (post_a, post_b) = L.burn_windows(end)
            if L.s2_collection(region, post_a, post_b).size().getInfo() == 0:
                raise HTTPException(404, "No clear Sentinel-2 images in the 30 days before this date.")
            img = L.burn_tile_image(region, end)
        try:
            return img.getMapId(L.VIS[layer])["tile_fetcher"].url_format
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return {"url": cached(key, build)}


@app.get("/api/fire_calendar", dependencies=[Depends(require_ee)])
def fire_calendar(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern="^(modis|viirs)$"),
):
    import calendar as cal
    first = date.fromisoformat(L.FIRE_DATASETS[sensor]["first"])
    if date(year, month, cal.monthrange(year, month)[1]) < first:
        raise HTTPException(400, f"{sensor.upper()} records start {first.isoformat()}.")
    if date(year, month, 1) > date.today():
        raise HTTPException(400, "This month is in the future.")
    def build():
        region = ee.Geometry.Point([lon, lat]).buffer(radius_km * 1000)
        return {"sensor": sensor, "year": year, "month": month,
                "days": L.fire_calendar(region, year, month, sensor)}
    return cached(("fire_calendar", sensor, year, month,
                   round(lat, 3), round(lon, 3), radius_km), build)


@app.get("/api/insights", dependencies=[Depends(require_ee)])
def insights(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern="^(modis|viirs)$"),
):
    check_dates(start, end)

    def build():
        region = ee.Geometry.Point([lon, lat]).buffer(radius_km * 1000)
        burn_region = ee.Geometry.Point([lon, lat]).buffer(min(radius_km, 150) * 1000)
        base_start, base_end = L.plus(start, -30), L.plus(start, -1)
        jobs = {
            "so2": lambda: L.so2_mean_du(region, start, end),
            "base": lambda: L.so2_mean_du(region, base_start, base_end),
            "fire": lambda: L.fire_pixel_count(region, start, end, sensor),
            "burn": lambda: L.burned_hectares(burn_region, end),
        }
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {k: pool.submit(safe, fn) for k, fn in jobs.items()}
            r = {k: f.result() for k, f in futures.items()}

        ratio = r["so2"] / r["base"] if r["so2"] is not None and r["base"] and r["base"] > 0 else None
        level, reason = classify(r["fire"], ratio)
        return {
            "fire_pixels": r["fire"], "so2_du": r["so2"], "so2_baseline_du": r["base"],
            "so2_ratio": ratio, "burned_ha": r["burn"],
            "signal": level, "signal_reason": reason, "sensor": sensor,
        }

    return cached(("ins", start, end, round(lat, 2), round(lon, 2), radius_km, sensor), build)


def classify(fire, ratio):
    fire = fire or 0
    if fire >= config.ALERT_MIN_FIRE_PIXELS and ratio and ratio >= config.ALERT_SO2_RATIO:
        return "alert", f"{fire} fire pixels and sulfur dioxide at {ratio:.1f} times the usual level."
    if fire >= config.WATCH_FIRE_PIXELS:
        return "watch", f"{fire} fire pixels in this area."
    if ratio and ratio >= config.WATCH_SO2_RATIO:
        return "watch", f"Sulfur dioxide at {ratio:.1f} times the usual level."
    return "none", "Nothing unusual in this window."


@app.get("/api/so2_series", dependencies=[Depends(require_ee)])
def so2_series(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    days: int = Query(30, ge=7, le=60),
):
    check_dates(L.plus(end, -6), end)

    def build():
        region = ee.Geometry.Point([lon, lat]).buffer(radius_km * 1000)
        try:
            return L.so2_daily_du(region, end, days)
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return cached(("series", end, round(lat, 2), round(lon, 2), radius_km, days), build)


# Serve the web app from the same server (no CORS, one command to run).
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
