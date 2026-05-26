from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.database import get_db
from app.models.satellite import Satellite
from app.models.telescope import Telescope
from app.models.pass_window import PassWindow
from app.services.orbital_service import compute_and_store_passes

router = APIRouter(prefix="/api/passes", tags=["passes"])


@router.post("/recalculate")
async def recalculate_passes(db: AsyncSession = Depends(get_db)):
    sat_result = await db.execute(select(Satellite).where(Satellite.active == True))
    satellites = sat_result.scalars().all()
    tel_result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = tel_result.scalars().all()

    computed = 0
    for sat in satellites:
        for tel in telescopes:
            try:
                windows = await compute_and_store_passes(db, sat, tel)
                computed += len(windows)
            except Exception:
                pass
    await db.commit()
    return {"status": "ok", "windows_computed": computed}


@router.get("")
async def get_passes(
    satellite_id: int | None = Query(None),
    telescope_id: int | None = Query(None),
    from_time: datetime | None = Query(None),
    to_time: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(PassWindow)
    if satellite_id:
        q = q.where(PassWindow.satellite_id == satellite_id)
    if telescope_id:
        q = q.where(PassWindow.telescope_id == telescope_id)
    if from_time:
        q = q.where(PassWindow.start_time >= from_time)
    if to_time:
        q = q.where(PassWindow.end_time <= to_time)
    q = q.order_by(PassWindow.start_time).limit(500)

    result = await db.execute(q)
    passes = result.scalars().all()
    return [
        {
            "id": p.id,
            "satellite_id": p.satellite_id,
            "telescope_id": p.telescope_id,
            "start_time": p.start_time.isoformat() if p.start_time else None,
            "end_time": p.end_time.isoformat() if p.end_time else None,
            "max_elevation_deg": p.max_elevation_deg,
            "duration_sec": p.duration_sec,
            "observable": p.observable,
            "reason": p.reason,
        }
        for p in passes
    ]
