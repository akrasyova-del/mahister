from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.database import get_db
from app.models.assignment import Assignment, AssignmentStatus, PriorityType
from app.models.satellite import Satellite
from app.models.telescope import Telescope
from app.models.pass_window import PassWindow
from app.services.assignment_engine import run_assignment
from app.services.event_service import log_event
from app.models.event_log import EventLevel, EventType
from app.websocket.manager import ws_manager
from pydantic import BaseModel

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


class ManualAssignInput(BaseModel):
    satellite_id: int
    telescope_id: int
    reason: str = "Manual assignment by operator"


async def _build_assignment_row(db: AsyncSession, assign: Assignment) -> dict:
    sat_r = await db.execute(select(Satellite).where(Satellite.id == assign.satellite_id))
    sat = sat_r.scalar_one_or_none()

    home_r = await db.execute(select(Telescope).where(Telescope.id == assign.home_telescope_id))
    home = home_r.scalar_one_or_none()

    assigned_r = await db.execute(select(Telescope).where(Telescope.id == assign.assigned_telescope_id))
    assigned = assigned_r.scalar_one_or_none()

    # Get current or next pass
    next_pass = None
    if sat and assigned:
        pw_r = await db.execute(
            select(PassWindow)
            .where(
                PassWindow.satellite_id == sat.id,
                PassWindow.telescope_id == assigned.id,
                PassWindow.end_time >= datetime.now(timezone.utc),
            )
            .order_by(PassWindow.start_time).limit(1)
        )
        next_pass = pw_r.scalar_one_or_none()

    return {
        "id": assign.id,
        "satellite_id": sat.id if sat else None,
        "satellite_name": sat.name if sat else None,
        "norad_id": sat.norad_id if sat else None,
        "category": sat.category if sat else None,
        "orbit_type": sat.orbit_type if sat else None,
        "priority": sat.priority if sat else None,
        "home_telescope_id": assign.home_telescope_id,
        "home_telescope_name": home.name if home else None,
        "assigned_telescope_id": assign.assigned_telescope_id,
        "assigned_telescope_name": assigned.name if assigned else None,
        "status": assign.status,
        "priority_type": assign.priority_type,
        "reason": assign.reason,
        "score": assign.score,
        "updated_at": assign.updated_at.isoformat() if assign.updated_at else None,
        "next_pass_start": next_pass.start_time.isoformat() if next_pass and next_pass.start_time else None,
        "next_pass_end": next_pass.end_time.isoformat() if next_pass and next_pass.end_time else None,
        "max_elevation_deg": next_pass.max_elevation_deg if next_pass else None,
    }


@router.get("/current")
async def get_current_assignments(
    telescope_id: int | None = Query(None),
    status: str | None = Query(None),
    category: str | None = Query(None),
    transferred_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    q = select(Assignment)
    if telescope_id:
        q = q.where(Assignment.assigned_telescope_id == telescope_id)
    if status:
        q = q.where(Assignment.status == status)
    if transferred_only:
        q = q.where(Assignment.priority_type == PriorityType.TRANSFERRED)

    result = await db.execute(q)
    assignments = result.scalars().all()

    rows = []
    for a in assignments:
        if category:
            sat_r = await db.execute(select(Satellite).where(Satellite.id == a.satellite_id))
            sat = sat_r.scalar_one_or_none()
            if not sat or sat.category != category:
                continue
        rows.append(await _build_assignment_row(db, a))

    # Sort: transferred first, then by score desc
    rows.sort(key=lambda r: (r["priority_type"] != "TRANSFERRED", -(r["score"] or 0)))
    return rows


@router.post("/recalculate")
async def recalculate_assignments(db: AsyncSession = Depends(get_db)):
    stats = await run_assignment(db)
    await ws_manager.send_event("assignments_updated", stats)
    return {"status": "ok", **stats}


@router.post("/manual")
async def manual_assign(body: ManualAssignInput, db: AsyncSession = Depends(get_db)):
    assign_r = await db.execute(
        select(Assignment).where(Assignment.satellite_id == body.satellite_id)
    )
    assign = assign_r.scalar_one_or_none()
    if not assign:
        raise HTTPException(404, "Assignment not found")

    tel_r = await db.execute(select(Telescope).where(Telescope.id == body.telescope_id))
    telescope = tel_r.scalar_one_or_none()
    if not telescope:
        raise HTTPException(404, "Telescope not found")

    assign.assigned_telescope_id = body.telescope_id
    assign.status = AssignmentStatus.MANUAL_ASSIGNED
    assign.reason = body.reason
    assign.updated_at = datetime.now(timezone.utc)

    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(Satellite)
        .where(Satellite.id == body.satellite_id)
        .values(assigned_telescope_id=body.telescope_id)
    )

    await log_event(
        db, EventType.MANUAL_REASSIGNMENT,
        f"Satellite {body.satellite_id} manually assigned to {telescope.name}",
        EventLevel.INFO, "satellite", body.satellite_id,
    )
    await db.commit()
    await ws_manager.send_event("assignment_manual", {"satellite_id": body.satellite_id, "telescope_id": body.telescope_id})
    return await _build_assignment_row(db, assign)
