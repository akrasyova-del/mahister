"""
Catalog Service — browses the full Space-Track satellite catalog (satcat)
to let the user pick additional Russian payloads for tracking.
"""
import json
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.catalog_entry import CatalogEntry
from app.models.satellite import OrbitType
from app.models.event_log import EventLevel, EventType
from app.services.event_service import log_event
from app.services.tle_service import _spacetrack_login


SATCAT_URL = (
    "https://www.space-track.org/basicspacedata/query/class/satcat"
    "/COUNTRY/RUS,CIS/OBJECT_TYPE/PAYLOAD/DECAY/null-val/format/json"
)


def classify_orbit(period_min: float | None, apogee_km: float | None, perigee_km: float | None) -> OrbitType:
    """Heuristic orbit classification from satcat orbital parameters."""
    if apogee_km is not None and perigee_km is not None and (apogee_km - perigee_km) > 5000:
        return OrbitType.HEO
    if period_min is None:
        return OrbitType.LEO
    if period_min < 200:
        return OrbitType.LEO
    if period_min < 1100:
        return OrbitType.MEO
    return OrbitType.GEO


def _to_float(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


async def sync_catalog(db: AsyncSession) -> dict:
    """Fetch the Russian payload catalog from Space-Track and cache it locally."""
    client = await _spacetrack_login()
    if not client:
        await log_event(
            db, EventType.TLE_ERROR,
            "Каталог Space-Track: не вдалося авторизуватись",
            EventLevel.WARNING,
        )
        return {"status": "error", "reason": "spacetrack_unavailable", "synced": 0}

    try:
        resp = await client.get(SATCAT_URL, timeout=60.0)
    finally:
        await client.aclose()

    if resp.status_code != 200:
        await log_event(
            db, EventType.TLE_ERROR,
            f"Каталог Space-Track: HTTP {resp.status_code}",
            EventLevel.WARNING,
        )
        return {"status": "error", "reason": f"http_{resp.status_code}", "synced": 0}

    try:
        rows = json.loads(resp.text)
    except json.JSONDecodeError:
        return {"status": "error", "reason": "invalid_json", "synced": 0}

    now = datetime.now(timezone.utc)
    synced = 0
    for row in rows:
        norad_id = int(row.get("NORAD_CAT_ID"))
        existing = (
            await db.execute(select(CatalogEntry).where(CatalogEntry.norad_id == norad_id))
        ).scalar_one_or_none()

        fields = dict(
            name=row.get("OBJECT_NAME") or f"NORAD {norad_id}",
            international_designator=row.get("INTLDES"),
            country=row.get("COUNTRY"),
            object_type=row.get("OBJECT_TYPE"),
            launch_date=row.get("LAUNCH"),
            period_min=_to_float(row.get("PERIOD")),
            apogee_km=_to_float(row.get("APOGEE")),
            perigee_km=_to_float(row.get("PERIGEE")),
            inclination_deg=_to_float(row.get("INCLINATION")),
            last_synced_at=now,
        )

        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(CatalogEntry(norad_id=norad_id, **fields))
        synced += 1

    await log_event(
        db, EventType.TLE_UPDATED,
        f"Каталог Space-Track синхронізовано: {synced} об'єктів",
        EventLevel.INFO,
    )
    await db.commit()
    return {"status": "ok", "synced": synced, "synced_at": now.isoformat()}
