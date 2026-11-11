import ee

from . import config

_ready = False


class EENotReady(RuntimeError):
    """Raised with a human-readable message when Earth Engine can't start."""


def ensure() -> None:
    global _ready
    if _ready:
        return
    if not config.EE_PROJECT or config.EE_PROJECT == "your-gcp-project-id":
        raise EENotReady("Set EE_PROJECT in the .env file to your Google Cloud project ID, then restart.")
    try:
        if config.EE_SERVICE_ACCOUNT and config.EE_KEY_FILE:
            creds = ee.ServiceAccountCredentials(config.EE_SERVICE_ACCOUNT, config.EE_KEY_FILE)
            ee.Initialize(creds, project=config.EE_PROJECT)
        else:
            ee.Initialize(project=config.EE_PROJECT)
    except Exception as exc:  # noqa: BLE001
        raise EENotReady(
            f"Earth Engine could not start ({exc}). Run `earthengine authenticate` in the terminal, "
            "and check that your project is registered for Earth Engine."
        ) from exc
    _ready = True
