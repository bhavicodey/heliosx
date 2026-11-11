"""Quick Earth Engine connection test:  python check_ee.py"""
import sys
import ee
from backend import ee_client, layers as L

try:
    ee_client.ensure()
except ee_client.EENotReady as exc:
    print("FAILED:", exc)
    sys.exit(1)

print("Earth Engine connected.\n")
checks = {
    "Sentinel-5P SO2 images (Jan 2025)": L.so2_collection("2025-01-01", "2025-01-31"),
    "FIRMS fire images (Jan 2025)": L.fire_collection("2025-01-01", "2025-01-31"),
    "Sentinel-2 images over LA (Jan 2025)": L.s2_collection(
        ee.Geometry.Point([-118.5, 34.1]).buffer(30000), "2025-01-01", "2025-01-31"),
}
for name, col in checks.items():
    print(f"  {name}: {col.size().getInfo()}")
print("\nAll good. Run:  python run.py")
