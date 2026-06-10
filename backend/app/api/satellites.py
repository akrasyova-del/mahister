from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.satellite import Satellite
from app.models.tle_record import TLERecord
from app.models.assignment import Assignment, AssignmentStatus, PriorityType
from app.models.telescope import Telescope
from app.models.pass_window import PassWindow
from app.services.tle_service import _tle_age_hours
from app.websocket.manager import ws_manager
from datetime import datetime, timezone

router = APIRouter(prefix="/api/satellites", tags=["satellites"])


def _tle_status(tle: TLERecord | None) -> str:
    if not tle:
        return "TLE_MISSING"
    if not tle.epoch:
        return "NO_EPOCH"
    age = _tle_age_hours(tle.epoch)
    if age > 168:
        return "STALE"
    if age > 48:
        return "AGING"
    return "FRESH"


async def _sat_dict(db: AsyncSession, sat: Satellite) -> dict:
    # Get TLE
    tle_result = await db.execute(
        select(TLERecord)
        .where(TLERecord.satellite_id == sat.id, TLERecord.is_active == True)
        .order_by(TLERecord.fetched_at.desc()).limit(1)
    )
    tle = tle_result.scalar_one_or_none()

    # Get assignment
    assign_result = await db.execute(
        select(Assignment).where(Assignment.satellite_id == sat.id)
    )
    assign = assign_result.scalar_one_or_none()

    # Get telescope names
    home_name, assigned_name = None, None
    if sat.home_telescope_id:
        r = await db.execute(select(Telescope).where(Telescope.id == sat.home_telescope_id))
        t = r.scalar_one_or_none()
        if t:
            home_name = t.name
    if sat.assigned_telescope_id and sat.assigned_telescope_id != sat.home_telescope_id:
        r = await db.execute(select(Telescope).where(Telescope.id == sat.assigned_telescope_id))
        t = r.scalar_one_or_none()
        if t:
            assigned_name = t.name
    else:
        assigned_name = home_name

    return {
        "id": sat.id,
        "name": sat.name,
        "norad_id": sat.norad_id,
        "international_designator": sat.international_designator,
        "category": sat.category,
        "orbit_type": sat.orbit_type,
        "priority": sat.priority,
        "active": sat.active,
        "home_telescope_id": sat.home_telescope_id,
        "home_telescope_name": home_name,
        "assigned_telescope_id": sat.assigned_telescope_id,
        "assigned_telescope_name": assigned_name,
        "tle_status": _tle_status(tle),
        "tle_epoch": tle.epoch.isoformat() if tle and tle.epoch else None,
        "tle_source": tle.source if tle else None,
        "tle_age_hours": round(_tle_age_hours(tle.epoch), 1) if tle and tle.epoch else None,
        "assignment_status": assign.status if assign else None,
        "assignment_reason": assign.reason if assign else None,
        "assignment_score": assign.score if assign else None,
        "priority_type": assign.priority_type if assign else None,
    }


@router.get("")
async def list_satellites(
    category: str | None = Query(None),
    orbit_type: str | None = Query(None),
    include_untracked: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    q = select(Satellite)
    if not include_untracked:
        q = q.where(Satellite.active == True)
    if category:
        q = q.where(Satellite.category == category)
    if orbit_type:
        q = q.where(Satellite.orbit_type == orbit_type)
    result = await db.execute(q)
    satellites = result.scalars().all()
    return [await _sat_dict(db, s) for s in satellites]


@router.get("/{norad_id}")
async def get_satellite(norad_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Satellite).where(Satellite.norad_id == norad_id))
    sat = result.scalar_one_or_none()
    if not sat:
        from fastapi import HTTPException
        raise HTTPException(404, f"Satellite NORAD {norad_id} not found")

    data = await _sat_dict(db, sat)

    # Add per-telescope current position and next passes
    tel_result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = tel_result.scalars().all()

    tle_result = await db.execute(
        select(TLERecord)
        .where(TLERecord.satellite_id == sat.id, TLERecord.is_active == True)
        .order_by(TLERecord.fetched_at.desc()).limit(1)
    )
    tle = tle_result.scalar_one_or_none()

    telescope_data = []
    for tel in telescopes:
        # Get next pass from DB
        pw_result = await db.execute(
            select(PassWindow)
            .where(
                PassWindow.satellite_id == sat.id,
                PassWindow.telescope_id == tel.id,
                PassWindow.end_time >= datetime.now(timezone.utc),
            )
            .order_by(PassWindow.start_time).limit(5)
        )
        passes = pw_result.scalars().all()
        telescope_data.append({
            "telescope_id": tel.id,
            "telescope_code": tel.code,
            "telescope_name": tel.name,
            "passes": [
                {
                    "start_time": p.start_time.isoformat() if p.start_time else None,
                    "end_time": p.end_time.isoformat() if p.end_time else None,
                    "max_elevation_deg": p.max_elevation_deg,
                    "duration_sec": p.duration_sec,
                    "observable": p.observable,
                }
                for p in passes
            ],
        })

    data["telescopes"] = telescope_data
    return data


class PriorityUpdate(BaseModel):
    priority: int


@router.patch("/{norad_id}/priority")
async def update_priority(norad_id: int, body: PriorityUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Satellite).where(Satellite.norad_id == norad_id))
    sat = result.scalar_one_or_none()
    if not sat:
        raise HTTPException(404, f"Satellite NORAD {norad_id} not found")
    if body.priority < 1:
        raise HTTPException(422, "Priority must be >= 1")
    sat.priority = body.priority
    await db.commit()
    return {"norad_id": norad_id, "priority": body.priority}


class TrackedUpdate(BaseModel):
    tracked: bool


@router.patch("/{norad_id}/tracked")
async def update_tracked(norad_id: int, body: TrackedUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Satellite).where(Satellite.norad_id == norad_id))
    sat = result.scalar_one_or_none()
    if not sat:
        raise HTTPException(404, f"Satellite NORAD {norad_id} not found")

    sat.active = body.tracked

    if not body.tracked:
        # Drop the satellite from the live distribution — recalculation will recreate
        # the assignment if tracking is re-enabled.
        await db.execute(delete(Assignment).where(Assignment.satellite_id == sat.id))
    else:
        existing = (
            await db.execute(select(Assignment).where(Assignment.satellite_id == sat.id))
        ).scalar_one_or_none()
        if not existing:
            db.add(Assignment(
                satellite_id=sat.id,
                home_telescope_id=sat.home_telescope_id,
                assigned_telescope_id=sat.home_telescope_id,
                status=AssignmentStatus.WAITING_VISIBILITY,
                priority_type=PriorityType.NORMAL,
                reason="Відстеження увімкнено, очікує перерахунку",
                score=0.0,
            ))

    await db.commit()
    await ws_manager.send_event("assignments_updated", {"norad_id": norad_id, "tracked": body.tracked})
    return {"norad_id": norad_id, "tracked": body.tracked}


class CategoryUpdate(BaseModel):
    category: str | None = None


@router.patch("/{norad_id}/category")
async def update_category(norad_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Satellite).where(Satellite.norad_id == norad_id))
    sat = result.scalar_one_or_none()
    if not sat:
        raise HTTPException(404, f"Satellite NORAD {norad_id} not found")

    sat.category = body.category.strip() if body.category and body.category.strip() else None
    await db.commit()
    return {"norad_id": norad_id, "category": sat.category}
