from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.catalog_entry import CatalogEntry
from app.models.satellite import Satellite
from app.models.assignment import Assignment, AssignmentStatus, PriorityType
from app.services.catalog_service import sync_catalog, classify_orbit
from app.services.tle_service import fetch_and_store_tle
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


def _entry_dict(entry: CatalogEntry, tracked: bool) -> dict:
    return {
        "norad_id": entry.norad_id,
        "name": entry.name,
        "international_designator": entry.international_designator,
        "country": entry.country,
        "object_type": entry.object_type,
        "launch_date": entry.launch_date,
        "period_min": entry.period_min,
        "apogee_km": entry.apogee_km,
        "perigee_km": entry.perigee_km,
        "inclination_deg": entry.inclination_deg,
        "orbit_type": classify_orbit(entry.period_min, entry.apogee_km, entry.perigee_km).value,
        "last_synced_at": entry.last_synced_at.isoformat() if entry.last_synced_at else None,
        "tracked": tracked,
    }


@router.post("/sync")
async def trigger_catalog_sync(db: AsyncSession = Depends(get_db)):
    stats = await sync_catalog(db)
    await ws_manager.send_event("catalog_synced", stats)
    return stats


@router.get("")
async def list_catalog(
    search: str | None = Query(None),
    hide_tracked: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    entries_result = await db.execute(select(CatalogEntry).order_by(CatalogEntry.norad_id))
    entries = entries_result.scalars().all()

    tracked_ids = set(
        (await db.execute(select(Satellite.norad_id))).scalars().all()
    )

    out = []
    for entry in entries:
        tracked = entry.norad_id in tracked_ids
        if hide_tracked and tracked:
            continue
        if search:
            s = search.lower()
            if s not in entry.name.lower() and s not in str(entry.norad_id):
                continue
        out.append(_entry_dict(entry, tracked))
    return out


class ImportRequest(BaseModel):
    norad_ids: list[int]
    category: str | None = None


@router.post("/import")
async def import_from_catalog(body: ImportRequest, db: AsyncSession = Depends(get_db)):
    entries_result = await db.execute(
        select(CatalogEntry).where(CatalogEntry.norad_id.in_(body.norad_ids))
    )
    entries = {e.norad_id: e for e in entries_result.scalars().all()}

    imported, reactivated = 0, 0
    for norad_id in body.norad_ids:
        entry = entries.get(norad_id)
        if not entry:
            continue

        existing = (
            await db.execute(select(Satellite).where(Satellite.norad_id == norad_id))
        ).scalar_one_or_none()

        if existing:
            existing.active = True
            sat = existing
            reactivated += 1
        else:
            sat = Satellite(
                norad_id=norad_id,
                name=entry.name,
                international_designator=entry.international_designator,
                category=body.category,
                orbit_type=classify_orbit(entry.period_min, entry.apogee_km, entry.perigee_km),
                priority=1,
                active=True,
                home_telescope_id=None,
                assigned_telescope_id=None,
            )
            db.add(sat)
            await db.flush()
            imported += 1

        assignment = (
            await db.execute(select(Assignment).where(Assignment.satellite_id == sat.id))
        ).scalar_one_or_none()
        if not assignment:
            db.add(Assignment(
                satellite_id=sat.id,
                home_telescope_id=None,
                assigned_telescope_id=None,
                status=AssignmentStatus.WAITING_VISIBILITY,
                priority_type=PriorityType.NORMAL,
                reason="Щойно додано з каталогу Space-Track, очікує перерахунку",
                score=0.0,
            ))

        await db.flush()
        try:
            await fetch_and_store_tle(db, sat)
        except Exception:
            pass

    await db.commit()
    await ws_manager.send_event("catalog_imported", {"imported": imported, "reactivated": reactivated})
    return {"status": "ok", "imported": imported, "reactivated": reactivated}
