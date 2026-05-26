from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.satellite import Satellite
from app.models.tle_record import TLERecord
from app.services.tle_service import update_all_tles, store_manual_tle, _tle_age_hours
from app.websocket.manager import ws_manager
from pydantic import BaseModel

router = APIRouter(prefix="/api/tle", tags=["tle"])


class ManualTLEInput(BaseModel):
    satellite_id: int
    tle_line1: str
    tle_line2: str


@router.post("/update")
async def trigger_tle_update(db: AsyncSession = Depends(get_db)):
    stats = await update_all_tles(db)
    await ws_manager.send_event("tle_updated", stats)
    return {"status": "ok", **stats}


@router.get("/status")
async def tle_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Satellite).where(Satellite.active == True))
    satellites = result.scalars().all()

    status_list = []
    for sat in satellites:
        tle_result = await db.execute(
            select(TLERecord)
            .where(TLERecord.satellite_id == sat.id, TLERecord.is_active == True)
            .order_by(TLERecord.fetched_at.desc()).limit(1)
        )
        tle = tle_result.scalar_one_or_none()
        status_list.append({
            "satellite_id": sat.id,
            "norad_id": sat.norad_id,
            "name": sat.name,
            "has_tle": tle is not None,
            "source": tle.source if tle else None,
            "epoch": tle.epoch.isoformat() if tle and tle.epoch else None,
            "age_hours": round(_tle_age_hours(tle.epoch), 1) if tle and tle.epoch else None,
            "fetched_at": tle.fetched_at.isoformat() if tle and tle.fetched_at else None,
        })
    return status_list


@router.get("/lines")
async def tle_lines(db: AsyncSession = Depends(get_db)):
    """Return active TLE line pairs for all active satellites (used by 3D globe)."""
    result = await db.execute(
        select(Satellite, TLERecord)
        .join(TLERecord, TLERecord.satellite_id == Satellite.id)
        .where(Satellite.active == True, TLERecord.is_active == True)
    )
    return [
        {
            "satellite_id": sat.id,
            "norad_id": sat.norad_id,
            "name": sat.name,
            "orbit_type": sat.orbit_type.value,
            "tle_line1": tle.tle_line1,
            "tle_line2": tle.tle_line2,
        }
        for sat, tle in result.all()
    ]


@router.post("/manual")
async def set_manual_tle(body: ManualTLEInput, db: AsyncSession = Depends(get_db)):
    record = await store_manual_tle(db, body.satellite_id, body.tle_line1, body.tle_line2)
    return {
        "satellite_id": record.satellite_id,
        "norad_id": record.norad_id,
        "source": record.source,
        "epoch": record.epoch.isoformat() if record.epoch else None,
    }
