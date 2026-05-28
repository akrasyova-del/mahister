"""
Assignment Engine — distributes satellites across telescopes using a weighted score.

Score breakdown (all components 0–1):
  geometry_score         0.30  — quality of orbital geometry (max elevation)
  weather_score          0.25  — current observing conditions
  time_window_score      0.20  — duration of next pass window
  telescope_capability   0.15  — telescope operational state
  load_balance_score     0.10  — prefer less-loaded telescopes

Transferred satellites receive a +0.25 bonus to ensure they are prioritized.
"""
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.telescope import Telescope, TelescopeStatus
from app.models.satellite import Satellite
from app.models.tle_record import TLERecord
from app.models.pass_window import PassWindow
from app.models.weather import WeatherSnapshot
from app.models.assignment import Assignment, AssignmentStatus, PriorityType, PriorityTransfer
from app.models.event_log import EventLevel, EventType
from app.services.event_service import log_event
from app.services.tle_service import get_active_tle, _tle_age_hours, max_tle_age_for_orbit
from app.services.orbital_service import compute_and_store_passes, get_next_pass
from app.services.weather_service import get_latest_weather


UNAVAILABLE_STATUSES = {
    TelescopeStatus.OFFLINE,
    TelescopeStatus.WEATHER_BLOCKED,
    TelescopeStatus.ERROR,
}

# Weights
W_GEOMETRY = 0.30
W_WEATHER = 0.25
W_TIME_WINDOW = 0.20
W_CAPABILITY = 0.15
W_LOAD = 0.10
TRANSFER_BONUS = 0.25

# Score threshold — only reassign if new telescope score is significantly better
REASSIGN_THRESHOLD = 0.15


@dataclass
class ScoredTelescope:
    telescope: Telescope
    score: float
    geometry: float = 0.0
    weather: float = 0.0
    time_window: float = 0.0
    capability: float = 0.0
    load_balance: float = 0.0
    is_transfer_bonus: bool = False


def _geometry_score(max_elev: float | None, min_elev: float) -> float:
    if max_elev is None or max_elev < min_elev:
        return 0.0
    if max_elev >= 75:
        return 1.0
    return (max_elev - min_elev) / (75 - min_elev)


def _weather_score(weather: WeatherSnapshot | None, telescope: Telescope) -> float:
    if weather is None:
        return 0.5  # unknown — give partial score

    cloud = weather.cloud_cover or 0
    low_cloud = weather.cloud_cover_low or 0
    wind = weather.wind_speed or 0
    precip = weather.precipitation or 0
    vis = weather.visibility_km or 20

    if precip > 0:
        return 0.0
    if cloud > telescope.max_cloud_cover_percent:
        return 0.0
    if low_cloud > telescope.max_low_cloud_cover_percent:
        return 0.0
    if wind > telescope.max_wind_speed_mps:
        return 0.0
    if vis < telescope.min_visibility_km:
        return 0.0

    cloud_score = 1 - (cloud / telescope.max_cloud_cover_percent)
    wind_score = 1 - (wind / telescope.max_wind_speed_mps)
    return round((cloud_score + wind_score) / 2, 3)


def _time_window_score(pass_window: PassWindow | None) -> float:
    if pass_window is None or pass_window.duration_sec is None:
        return 0.0
    # 10-min pass → score ~0.5; 20+ min → 1.0
    score = min(pass_window.duration_sec / 1200.0, 1.0)
    return round(score, 3)


def _capability_score(telescope: Telescope) -> float:
    if telescope.status == TelescopeStatus.ONLINE:
        return 1.0
    if telescope.status == TelescopeStatus.PARTIAL:
        return 0.5
    if telescope.status == TelescopeStatus.MANUAL_MODE:
        return 0.7
    return 0.0


def _load_balance_score(telescope_id: int, load_map: dict[int, int], total_sats: int) -> float:
    if total_sats == 0:
        return 1.0
    current_load = load_map.get(telescope_id, 0)
    avg_load = total_sats / max(len(load_map), 1)
    if current_load <= avg_load:
        return 1.0
    return max(0.0, 1 - (current_load - avg_load) / avg_load)


def compute_score(
    telescope: Telescope,
    weather: WeatherSnapshot | None,
    pass_window: PassWindow | None,
    load_map: dict[int, int],
    total_sats: int,
    is_transferred: bool,
) -> ScoredTelescope:
    max_elev = pass_window.max_elevation_deg if pass_window else None
    geom = _geometry_score(max_elev, telescope.min_elevation_deg)
    wthr = _weather_score(weather, telescope)
    time_w = _time_window_score(pass_window)
    cap = _capability_score(telescope)
    load = _load_balance_score(telescope.id, load_map, total_sats)

    raw = (
        W_GEOMETRY * geom
        + W_WEATHER * wthr
        + W_TIME_WINDOW * time_w
        + W_CAPABILITY * cap
        + W_LOAD * load
    )
    bonus = TRANSFER_BONUS if is_transferred else 0.0
    total = min(raw + bonus, 1.5)  # cap at 1.5 to avoid explosion

    return ScoredTelescope(
        telescope=telescope,
        score=round(total, 4),
        geometry=geom,
        weather=wthr,
        time_window=time_w,
        capability=cap,
        load_balance=load,
        is_transfer_bonus=is_transferred,
    )


async def _get_load_map(db: AsyncSession, telescope_ids: list[int]) -> dict[int, int]:
    """Return count of satellites currently assigned to each telescope."""
    from sqlalchemy import func
    result = await db.execute(
        select(Assignment.assigned_telescope_id, func.count(Assignment.id))
        .where(Assignment.assigned_telescope_id.in_(telescope_ids))
        .group_by(Assignment.assigned_telescope_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def _is_tle_valid(db: AsyncSession, satellite: Satellite) -> bool:
    tle = await get_active_tle(db, satellite.id)
    if not tle:
        return False
    if not tle.epoch:
        return True
    age = _tle_age_hours(tle.epoch)
    return age <= max_tle_age_for_orbit(satellite.orbit_type) * 2


async def run_assignment(db: AsyncSession) -> dict:
    """
    Main assignment algorithm.

    Steps:
    1. Load all active telescopes and satellites.
    2. Identify unavailable telescopes → their satellites go to transfer queue.
    3. For each satellite, score all available telescopes.
    4. Assign to best telescope; prefer keeping current if score not significantly worse.
    5. Persist assignments and log events.
    """
    # Load telescopes
    tel_result = await db.execute(select(Telescope).where(Telescope.active == True))
    all_telescopes: list[Telescope] = tel_result.scalars().all()

    available_telescopes = [t for t in all_telescopes if t.status not in UNAVAILABLE_STATUSES]
    unavailable_ids = {t.id for t in all_telescopes if t.status in UNAVAILABLE_STATUSES}

    # Load satellites
    sat_result = await db.execute(select(Satellite).where(Satellite.active == True))
    satellites: list[Satellite] = sat_result.scalars().all()

    # Load existing assignments
    assign_result = await db.execute(select(Assignment))
    existing: dict[int, Assignment] = {a.satellite_id: a for a in assign_result.scalars().all()}

    # Compute pass windows for all pairs (expensive but necessary)
    for sat in satellites:
        for tel in available_telescopes:
            try:
                await compute_and_store_passes(db, sat, tel)
            except Exception:
                pass

    # Build load map
    tel_ids = [t.id for t in available_telescopes]
    load_map = await _get_load_map(db, tel_ids)
    total_sats = len(satellites)

    # Weather map
    weather_map: dict[int, WeatherSnapshot | None] = {}
    for tel in available_telescopes:
        weather_map[tel.id] = await get_latest_weather(db, tel.id)

    stats = {"assigned": 0, "transferred": 0, "no_telescope": 0, "tle_missing": 0}
    changed_sats = []

    for sat in satellites:
        existing_assignment = existing.get(sat.id)
        home_tel_id = sat.home_telescope_id

        tle_ok = await _is_tle_valid(db, sat)
        if not tle_ok:
            status = AssignmentStatus.TLE_MISSING
            await _upsert_assignment(db, existing_assignment, sat, None, status, PriorityType.NORMAL, "TLE відсутній або застарів", 0.0)
            stats["tle_missing"] += 1
            continue

        if not available_telescopes:
            status = AssignmentStatus.NO_AVAILABLE_TELESCOPE
            await _upsert_assignment(db, existing_assignment, sat, None, status, PriorityType.NORMAL, "Немає доступних телескопів", 0.0)
            stats["no_telescope"] += 1
            continue

        # Determine if satellite is being transferred (home telescope unavailable)
        is_transferred = home_tel_id in unavailable_ids

        # Score all available telescopes
        scored: list[ScoredTelescope] = []
        for tel in available_telescopes:
            next_pass = await get_next_pass(db, sat.id, tel.id)
            weather = weather_map.get(tel.id)
            s = compute_score(tel, weather, next_pass, load_map, total_sats, is_transferred)
            scored.append(s)

        if not scored:
            stats["no_telescope"] += 1
            continue

        scored.sort(key=lambda x: x.score, reverse=True)
        best = scored[0]

        # Re-homing: satellite was TRANSFERRED but home telescope is back online → skip stability
        is_rehoming = (
            existing_assignment is not None and
            existing_assignment.status == AssignmentStatus.TRANSFERRED and
            not is_transferred
        )

        # Stability: keep current telescope if score difference is small (skip when re-homing)
        current_tel_id = existing_assignment.assigned_telescope_id if existing_assignment else None
        if current_tel_id and current_tel_id not in unavailable_ids and not is_rehoming:
            current_scored = next((s for s in scored if s.telescope.id == current_tel_id), None)
            if current_scored and (best.score - current_scored.score) < REASSIGN_THRESHOLD:
                best = current_scored

        # Update load map
        load_map[best.telescope.id] = load_map.get(best.telescope.id, 0) + 1

        if is_transferred:
            status = AssignmentStatus.TRANSFERRED
            priority_type = PriorityType.TRANSFERRED
            reason = f"Домашній телескоп недоступний; кращий варіант: {best.telescope.name}"
            stats["transferred"] += 1
            changed_sats.append((sat, existing_assignment, best.telescope))
        else:
            status = AssignmentStatus.LOCAL_ASSIGNED
            priority_type = PriorityType.NORMAL
            reason = f"Призначено до: {best.telescope.name}"
            stats["assigned"] += 1

        await _upsert_assignment(
            db, existing_assignment, sat, best.telescope.id,
            status, priority_type, reason, best.score,
        )

        # Update satellite record
        await db.execute(
            update(Satellite)
            .where(Satellite.id == sat.id)
            .values(assigned_telescope_id=best.telescope.id)
        )

    # Log transfers
    for sat, old_assign, new_tel in changed_sats:
        old_tel_id = old_assign.assigned_telescope_id if old_assign else sat.home_telescope_id
        if old_tel_id != new_tel.id:
            db.add(PriorityTransfer(
                satellite_id=sat.id,
                from_telescope_id=old_tel_id,
                to_telescope_id=new_tel.id,
                reason="Домашній телескоп недоступний",
                active=1,
            ))
            await log_event(
                db, EventType.AUTO_REASSIGNMENT,
                f"{sat.name} reassigned to {new_tel.name}",
                EventLevel.INFO, "satellite", sat.id,
            )

    await db.commit()
    return stats


async def _upsert_assignment(
    db: AsyncSession,
    existing: Assignment | None,
    satellite: Satellite,
    telescope_id: int | None,
    status: AssignmentStatus,
    priority_type: PriorityType,
    reason: str,
    score: float,
):
    now = datetime.now(timezone.utc)
    if existing:
        existing.assigned_telescope_id = telescope_id
        existing.status = status
        existing.priority_type = priority_type
        existing.reason = reason
        existing.score = score
        existing.updated_at = now
    else:
        assignment = Assignment(
            satellite_id=satellite.id,
            home_telescope_id=satellite.home_telescope_id,
            assigned_telescope_id=telescope_id,
            status=status,
            priority_type=priority_type,
            reason=reason,
            score=score,
            created_at=now,
            updated_at=now,
        )
        db.add(assignment)
