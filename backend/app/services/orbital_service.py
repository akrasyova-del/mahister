"""
Orbital Service — computes pass windows and current position using skyfield.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from skyfield.api import Topos, load, EarthSatellite, wgs84
from skyfield.timelib import Time
import numpy as np

from app.models.satellite import Satellite, OrbitType
from app.models.telescope import Telescope
from app.models.tle_record import TLERecord
from app.models.pass_window import PassWindow
from app.services.tle_service import get_active_tle, _tle_age_hours, max_tle_age_for_orbit

ts = load.timescale()


def _build_earth_satellite(tle: TLERecord) -> EarthSatellite | None:
    try:
        return EarthSatellite(tle.tle_line1, tle.tle_line2, ts=ts)
    except Exception:
        return None


def _telescope_topos(telescope: Telescope):
    return wgs84.latlon(
        telescope.latitude,
        telescope.longitude,
        elevation_m=telescope.altitude_m or 0,
    )


def get_current_position(
    satellite: EarthSatellite,
    telescope: Telescope,
    t: Time,
) -> dict:
    """Return current alt/az/range from a telescope to a satellite."""
    loc = _telescope_topos(telescope)
    diff = satellite - loc
    topocentric = diff.at(t)
    alt, az, distance = topocentric.altaz()
    return {
        "elevation_deg": round(alt.degrees, 2),
        "azimuth_deg": round(az.degrees, 2),
        "range_km": round(distance.km, 1),
        "above_horizon": alt.degrees > 0,
    }


def compute_pass_windows(
    satellite: EarthSatellite,
    telescope: Telescope,
    hours_ahead: int = 24,
    min_elevation_deg: float = 15.0,
) -> list[dict]:
    """
    Compute observation windows for a LEO/HEO satellite over the next N hours.
    Returns list of pass dicts.
    """
    loc = _telescope_topos(telescope)
    now = datetime.now(timezone.utc)
    t0 = ts.from_datetime(now)
    t1 = ts.from_datetime(now + timedelta(hours=hours_ahead))

    try:
        times, events = satellite.find_events(loc, t0, t1, altitude_degrees=min_elevation_deg)
    except Exception:
        return []

    passes = []
    # If the satellite is already above the threshold at t0, seed a current pass
    try:
        diff = satellite - loc
        topocentric = diff.at(t0)
        alt, _, _ = topocentric.altaz()
        current_pass: dict = {"start": now} if alt.degrees >= min_elevation_deg else {}
    except Exception:
        current_pass = {}

    for ti, event in zip(times, events):
        if event == 0:  # rise
            current_pass = {"start": ti.utc_datetime()}
        elif event == 1:  # max elevation
            diff = satellite - loc
            topocentric = diff.at(ti)
            alt, az, _ = topocentric.altaz()
            current_pass["max_elevation_deg"] = round(alt.degrees, 2)
            current_pass["max_elevation_time"] = ti.utc_datetime()
            current_pass["azimuth_at_max"] = round(az.degrees, 2)
        elif event == 2:  # set
            if "start" in current_pass:
                current_pass["end"] = ti.utc_datetime()
                duration = (current_pass["end"] - current_pass["start"]).total_seconds()
                current_pass["duration_sec"] = round(duration, 1)
                passes.append(dict(current_pass))
                current_pass = {}

    return passes


def compute_geo_position(
    satellite: EarthSatellite,
    telescope: Telescope,
) -> dict:
    """For GEO satellites, return current position (nearly static)."""
    t = ts.from_datetime(datetime.now(timezone.utc))
    return get_current_position(satellite, telescope, t)


def compute_meo_grid(
    satellite: EarthSatellite,
    telescope: Telescope,
    hours_ahead: int = 48,
    step_minutes: int = 15,
) -> list[dict]:
    """For MEO satellites, sample position on a time grid."""
    now = datetime.now(timezone.utc)
    points = []
    loc = _telescope_topos(telescope)
    for i in range(0, hours_ahead * 60, step_minutes):
        t = ts.from_datetime(now + timedelta(minutes=i))
        diff = satellite - loc
        topocentric = diff.at(t)
        alt, az, dist = topocentric.altaz()
        if alt.degrees >= telescope.min_elevation_deg:
            points.append({
                "time": (now + timedelta(minutes=i)).isoformat(),
                "elevation_deg": round(alt.degrees, 2),
                "azimuth_deg": round(az.degrees, 2),
                "range_km": round(dist.km, 1),
            })
    return points


async def compute_and_store_passes(
    db: AsyncSession,
    satellite: Satellite,
    telescope: Telescope,
) -> list[PassWindow]:
    """Compute pass windows and persist to DB."""
    tle = await get_active_tle(db, satellite.id)
    if not tle:
        return []

    if tle.epoch:
        age_h = _tle_age_hours(tle.epoch)
        max_age = max_tle_age_for_orbit(satellite.orbit_type)
        if age_h > max_age * 2:
            return []

    earth_sat = _build_earth_satellite(tle)
    if not earth_sat:
        return []

    # Remove stale pass windows
    await db.execute(
        delete(PassWindow).where(
            PassWindow.satellite_id == satellite.id,
            PassWindow.telescope_id == telescope.id,
        )
    )

    hours = 24 if satellite.orbit_type in (OrbitType.LEO, OrbitType.HEO) else 48
    if satellite.orbit_type == OrbitType.GEO:
        pos = compute_geo_position(earth_sat, telescope)
        pw = PassWindow(
            satellite_id=satellite.id,
            telescope_id=telescope.id,
            start_time=datetime.now(timezone.utc),
            end_time=datetime.now(timezone.utc) + timedelta(hours=24),
            max_elevation_deg=pos["elevation_deg"],
            azimuth_start=pos["azimuth_deg"],
            azimuth_end=pos["azimuth_deg"],
            duration_sec=86400,
            observable=pos["elevation_deg"] >= telescope.min_elevation_deg,
            reason="GEO — continuous visibility" if pos["elevation_deg"] >= telescope.min_elevation_deg else "Below horizon",
        )
        db.add(pw)
        return [pw]

    if satellite.orbit_type == OrbitType.MEO:
        grid = compute_meo_grid(earth_sat, telescope, hours_ahead=hours)
        windows = []
        if grid:
            # Merge consecutive grid points into windows
            start_point = grid[0]
            prev_point = grid[0]
            for point in grid[1:]:
                gap_min = (
                    datetime.fromisoformat(point["time"]) - datetime.fromisoformat(prev_point["time"])
                ).total_seconds() / 60
                if gap_min > 30:
                    segment = [p for p in grid if start_point["time"] <= p["time"] <= prev_point["time"]]
                    pw = PassWindow(
                        satellite_id=satellite.id,
                        telescope_id=telescope.id,
                        start_time=datetime.fromisoformat(start_point["time"]).replace(tzinfo=timezone.utc),
                        end_time=datetime.fromisoformat(prev_point["time"]).replace(tzinfo=timezone.utc),
                        max_elevation_deg=max(p["elevation_deg"] for p in segment) if segment else None,
                        observable=True,
                        reason="MEO visibility window",
                    )
                    db.add(pw)
                    windows.append(pw)
                    start_point = point
                prev_point = point
            # Always save the final accumulated window (the only window for long-duration passes)
            if start_point:
                segment = [p for p in grid if start_point["time"] <= p["time"] <= prev_point["time"]]
                t_start = datetime.fromisoformat(start_point["time"]).replace(tzinfo=timezone.utc)
                t_end = datetime.fromisoformat(prev_point["time"]).replace(tzinfo=timezone.utc)
                pw = PassWindow(
                    satellite_id=satellite.id,
                    telescope_id=telescope.id,
                    start_time=t_start,
                    end_time=t_end,
                    max_elevation_deg=max(p["elevation_deg"] for p in segment) if segment else None,
                    duration_sec=(t_end - t_start).total_seconds(),
                    observable=True,
                    reason="MEO visibility window",
                )
                db.add(pw)
                windows.append(pw)
        return windows

    # LEO / HEO
    raw_passes = compute_pass_windows(earth_sat, telescope, hours_ahead=hours, min_elevation_deg=telescope.min_elevation_deg)
    windows = []
    for p in raw_passes:
        pw = PassWindow(
            satellite_id=satellite.id,
            telescope_id=telescope.id,
            start_time=p["start"].replace(tzinfo=timezone.utc) if p["start"].tzinfo is None else p["start"],
            end_time=p["end"].replace(tzinfo=timezone.utc) if p["end"].tzinfo is None else p["end"],
            max_elevation_deg=p.get("max_elevation_deg"),
            max_elevation_time=p.get("max_elevation_time"),
            azimuth_start=p.get("azimuth_at_max"),
            duration_sec=p.get("duration_sec"),
            observable=True,
            reason="Visible pass",
        )
        db.add(pw)
        windows.append(pw)
    return windows


async def get_next_pass(
    db: AsyncSession,
    satellite_id: int,
    telescope_id: int,
) -> PassWindow | None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PassWindow)
        .where(
            PassWindow.satellite_id == satellite_id,
            PassWindow.telescope_id == telescope_id,
            PassWindow.end_time >= now,  # includes currently-active passes (start_time may be in the past)
        )
        .order_by(PassWindow.start_time)
        .limit(1)
    )
    return result.scalar_one_or_none()
