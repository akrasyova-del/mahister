from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone
from app.database import get_db
from app.models.telescope import Telescope, TelescopeStatus
from app.models.satellite import Satellite
from app.models.assignment import Assignment, AssignmentStatus, PriorityType
from app.models.tle_record import TLERecord
from app.models.weather import WeatherSnapshot
from app.models.event_log import EventLog
from app.services.weather_service import get_latest_weather
from app.services.tle_service import _tle_age_hours

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/state")
async def get_dashboard_state(db: AsyncSession = Depends(get_db)):
    tel_result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = tel_result.scalars().all()

    sat_result = await db.execute(select(Satellite).where(Satellite.active == True))
    satellites = sat_result.scalars().all()
    total_satellites = len(satellites)

    assign_result = await db.execute(select(Assignment))
    assignments = assign_result.scalars().all()
    assign_map = {a.satellite_id: a for a in assignments}

    telescope_cards = []
    for tel in telescopes:
        weather = await get_latest_weather(db, tel.id)

        # Count assignments for this telescope
        local = sum(
            1 for a in assignments
            if a.assigned_telescope_id == tel.id and a.priority_type == PriorityType.NORMAL
        )
        transferred = sum(
            1 for a in assignments
            if a.assigned_telescope_id == tel.id and a.priority_type == PriorityType.TRANSFERRED
        )
        no_visibility = sum(
            1 for a in assignments
            if a.assigned_telescope_id == tel.id
            and a.status in (AssignmentStatus.WAITING_VISIBILITY, AssignmentStatus.NO_AVAILABLE_TELESCOPE)
        )

        # Latest TLE fetch for this telescope's satellites
        sat_ids = [s.id for s in satellites if s.home_telescope_id == tel.id]
        latest_tle_fetch = None
        if sat_ids:
            tle_r = await db.execute(
                select(func.max(TLERecord.fetched_at))
                .where(TLERecord.satellite_id.in_(sat_ids), TLERecord.is_active == True)
            )
            latest_tle_fetch = tle_r.scalar_one_or_none()

        telescope_cards.append({
            "id": tel.id,
            "code": tel.code,
            "name": tel.name,
            "region": tel.region,
            "latitude": tel.latitude,
            "longitude": tel.longitude,
            "status": tel.status,
            "local_satellites": local,
            "transferred_satellites": transferred,
            "no_visibility_satellites": no_visibility,
            "total_assigned": local + transferred,
            "last_tle_update": latest_tle_fetch.isoformat() if latest_tle_fetch else None,
            "last_weather_update": weather.timestamp.isoformat() if weather and weather.timestamp else None,
            "weather": {
                "cloud_cover": weather.cloud_cover,
                "precipitation": weather.precipitation,
                "wind_speed": weather.wind_speed,
                "visibility_km": weather.visibility_km,
                "temperature": weather.temperature,
                "weather_code": weather.weather_code,
            } if weather else None,
        })

    # Global stats
    tle_missing = sum(
        1 for a in assignments if a.status == AssignmentStatus.TLE_MISSING
    )
    transferred_total = sum(
        1 for a in assignments if a.priority_type == PriorityType.TRANSFERRED
    )

    # Recent events
    events_result = await db.execute(
        select(EventLog).order_by(EventLog.timestamp.desc()).limit(20)
    )
    events = events_result.scalars().all()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_satellites": total_satellites,
        "tle_missing": tle_missing,
        "transferred_total": transferred_total,
        "online_telescopes": sum(1 for t in telescopes if t.status == TelescopeStatus.ONLINE),
        "telescopes": telescope_cards,
        "recent_events": [
            {
                "id": e.id,
                "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                "level": e.level,
                "event_type": e.event_type,
                "message": e.message,
            }
            for e in events
        ],
    }
