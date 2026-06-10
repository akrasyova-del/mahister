"""
TLE Service — fetches Two-Line Element sets for satellites.

Priority order:
  1. Space-Track.org (if credentials set)
  2. CelesTrak (free, no auth)
  3. Mock / manual TLE (fallback)
"""
import asyncio
import re
from datetime import datetime, timezone, timedelta
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.config import settings
from app.models.satellite import Satellite, OrbitType
from app.models.tle_record import TLERecord
from app.models.event_log import EventLevel, EventType
from app.services.event_service import log_event


SPACETRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login"
SPACETRACK_TLE_URL = "https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/{norad_id}/format/tle/"

CELESTRAK_TLE_URL = "https://celestrak.org/SPACETRACK/query/class/gp/CATNR/{norad_id}/FORMAT/tle/"


def _parse_tle_epoch(line1: str) -> datetime | None:
    """Parse epoch from TLE line 1."""
    try:
        year_str = line1[18:20]
        day_str = line1[20:32]
        year = int(year_str)
        year += 2000 if year < 57 else 1900
        day = float(day_str)
        epoch = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)
        return epoch
    except Exception:
        return None


def _is_tle_line1(s: str) -> bool:
    return len(s) >= 69 and s.startswith("1 ") and s[2:7].strip().isdigit()

def _is_tle_line2(s: str) -> bool:
    return len(s) >= 69 and s.startswith("2 ") and s[2:7].strip().isdigit()

def _parse_tle_block(text: str) -> tuple[str, str, str] | None:
    """Extract (name, line1, line2) from a TLE block, with format validation."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    if len(lines) >= 3 and _is_tle_line1(lines[1]) and _is_tle_line2(lines[2]):
        return lines[0], lines[1], lines[2]
    if len(lines) >= 2 and _is_tle_line1(lines[0]) and _is_tle_line2(lines[1]):
        return "UNKNOWN", lines[0], lines[1]
    return None


def _tle_age_hours(epoch: datetime) -> float:
    now = datetime.now(timezone.utc)
    if epoch.tzinfo is None:
        epoch = epoch.replace(tzinfo=timezone.utc)
    return (now - epoch).total_seconds() / 3600


def max_tle_age_for_orbit(orbit_type: OrbitType) -> int:
    """Return maximum acceptable TLE age in hours for a given orbit type."""
    return {
        OrbitType.LEO: settings.tle_max_age_leo,
        OrbitType.MEO: settings.tle_max_age_meo,
        OrbitType.GEO: settings.tle_max_age_geo,
        OrbitType.HEO: settings.tle_max_age_heo,
    }.get(orbit_type, settings.tle_max_age_leo)


async def _fetch_from_celestrak(norad_id: int) -> tuple[str, str] | None:
    url = CELESTRAK_TLE_URL.format(norad_id=norad_id)
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200 or not resp.text.strip():
                print(f"CelesTrak: HTTP {resp.status_code} for NORAD {norad_id}")
                return None
            parsed = _parse_tle_block(resp.text)
            if not parsed:
                print(f"CelesTrak: could not parse TLE for NORAD {norad_id}, body: {resp.text[:120]!r}")
            return (parsed[1], parsed[2]) if parsed else None
    except Exception as e:
        print(f"CelesTrak: exception for NORAD {norad_id}: {e}")
    return None


async def _spacetrack_login() -> httpx.AsyncClient | None:
    """Login to Space-Track once and return an authenticated client."""
    client = httpx.AsyncClient(timeout=30.0)
    try:
        login_resp = await client.post(
            SPACETRACK_LOGIN_URL,
            data={"identity": settings.spacetrack_user, "password": settings.spacetrack_pass},
        )
        if login_resp.status_code != 200 or "Failed" in login_resp.text:
            print(f"Space-Track: login failed (HTTP {login_resp.status_code}): {login_resp.text[:120]!r}")
            await client.aclose()
            return None
        print("Space-Track: login successful")
        return client
    except Exception as e:
        print(f"Space-Track: login exception: {e}")
        await client.aclose()
        return None


async def _fetch_batch_from_spacetrack(
    norad_ids: list[int], client: httpx.AsyncClient
) -> dict[int, tuple[str, str]]:
    """Fetch TLEs for multiple satellites in a single request. Returns {norad_id: (line1, line2)}."""
    if not norad_ids:
        return {}
    ids_str = ",".join(str(n) for n in norad_ids)
    url = f"https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/{ids_str}/format/tle/"
    try:
        resp = await client.get(url, timeout=60.0)
        if resp.status_code == 204 or not resp.text.strip():
            print(f"Space-Track: batch query returned no data (HTTP {resp.status_code})")
            return {}
        if resp.status_code != 200:
            print(f"Space-Track: batch HTTP {resp.status_code}: {resp.text[:120]!r}")
            return {}
        if "error" in resp.text[:50].lower():
            print(f"Space-Track: batch error: {resp.text[:200]!r}")
            return {}
        # Parse multi-satellite TLE response
        result: dict[int, tuple[str, str]] = {}
        lines = [l.strip() for l in resp.text.strip().splitlines() if l.strip()]
        i = 0
        while i < len(lines):
            if i + 2 < len(lines) and _is_tle_line1(lines[i + 1]) and _is_tle_line2(lines[i + 2]):
                norad = int(lines[i + 1][2:7])
                result[norad] = (lines[i + 1], lines[i + 2])
                i += 3
            elif _is_tle_line1(lines[i]) and i + 1 < len(lines) and _is_tle_line2(lines[i + 1]):
                norad = int(lines[i][2:7])
                result[norad] = (lines[i], lines[i + 1])
                i += 2
            else:
                i += 1
        print(f"Space-Track: batch returned {len(result)}/{len(norad_ids)} TLEs")
        return result
    except Exception as e:
        print(f"Space-Track: batch exception: {e}")
        return {}


async def fetch_and_store_tle(
    db: AsyncSession,
    satellite: Satellite,
    spacetrack_client: httpx.AsyncClient | None = None,
) -> TLERecord | None:
    """Fetch TLE from best available source and store in DB."""
    if settings.mock_tle:
        return await _store_mock_tle(db, satellite)

    line1, line2 = None, None
    source = None

    if spacetrack_client is not None:
        result = await _fetch_from_spacetrack(satellite.norad_id, spacetrack_client)
        if result:
            line1, line2 = result
            source = "spacetrack"

    if not line1:
        result = await _fetch_from_celestrak(satellite.norad_id)
        if result:
            line1, line2 = result
            source = "celestrak"

    if not line1:
        await log_event(
            db, EventType.TLE_ERROR,
            f"TLE not found for {satellite.name} (NORAD {satellite.norad_id})",
            EventLevel.WARNING, "satellite", satellite.id,
        )
        return None

    epoch = _parse_tle_epoch(line1)
    return await _store_tle(db, satellite, line1, line2, epoch, source)


async def _store_tle(
    db: AsyncSession,
    satellite: Satellite,
    line1: str,
    line2: str,
    epoch: datetime | None,
    source: str,
) -> TLERecord:
    # Deactivate old records
    await db.execute(
        update(TLERecord)
        .where(TLERecord.satellite_id == satellite.id)
        .values(is_active=False)
    )
    record = TLERecord(
        satellite_id=satellite.id,
        norad_id=satellite.norad_id,
        tle_line1=line1,
        tle_line2=line2,
        epoch=epoch,
        source=source,
        fetched_at=datetime.now(timezone.utc),
        is_active=True,
    )
    db.add(record)
    await db.flush()
    return record


async def _store_mock_tle(db: AsyncSession, satellite: Satellite) -> TLERecord:
    """Generate plausible mock TLE for testing UI without real data."""
    line1, line2 = _generate_mock_tle(satellite.norad_id, satellite.orbit_type)
    epoch = _parse_tle_epoch(line1)
    return await _store_tle(db, satellite, line1, line2, epoch, "mock")


def _generate_mock_tle(norad_id: int, orbit_type: OrbitType) -> tuple[str, str]:
    """Generate syntactically valid mock TLE for a given orbit type."""
    import math
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    year2 = now.year % 100
    day_of_year = now.timetuple().tm_yday + now.hour / 24.0 + now.minute / 1440.0

    orbit_params = {
        OrbitType.LEO: (6.9, 97.5, 1.0),   # mean_motion rev/day, inclination, ecc*1e4
        OrbitType.MEO: (2.131, 64.8, 0.001),
        OrbitType.GEO: (1.0027, 0.05, 0.0001),
        OrbitType.HEO: (2.006, 63.4, 0.7),
    }
    mean_motion, inclination, ecc = orbit_params.get(orbit_type, (6.9, 97.5, 1.0))
    ecc_str = f"{int(ecc * 1e7):07d}"

    cat = f"{norad_id:05d}"
    ep = f"{year2:02d}{day_of_year:012.8f}"

    def tle_checksum(line: str) -> int:
        total = 0
        for c in line[:-1]:
            if c.isdigit():
                total += int(c)
            elif c == "-":
                total += 1
        return total % 10

    # Lines must be exactly 69 chars: leading sign before each derivative field,
    # and an extra trailing '0' on line 2 so the final char is always the checksum slot.
    l1_raw = f"1 {cat}U {norad_id:05d}ABC {ep} +.00000000  00000-0  00000-0 0  9990"
    l2_raw = f"2 {cat} {inclination:8.4f}  45.0000 {ecc_str} 270.0000  90.0000 {mean_motion:11.8f}000010"

    l1 = l1_raw[:-1] + str(tle_checksum(l1_raw))
    l2 = l2_raw[:-1] + str(tle_checksum(l2_raw))
    return l1[:69], l2[:69]


async def get_active_tle(db: AsyncSession, satellite_id: int) -> TLERecord | None:
    result = await db.execute(
        select(TLERecord)
        .where(TLERecord.satellite_id == satellite_id, TLERecord.is_active == True)
        .order_by(TLERecord.fetched_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def update_all_tles(db: AsyncSession) -> dict:
    """Refresh TLEs for all active satellites using a single batch request."""
    result = await db.execute(select(Satellite).where(Satellite.active == True))
    satellites = result.scalars().all()
    norad_ids = [s.norad_id for s in satellites]

    if settings.mock_tle:
        success, failed = 0, 0
        for sat in satellites:
            if await _store_mock_tle(db, sat):
                success += 1
            else:
                failed += 1
            await db.commit()
        await log_event(db, EventType.TLE_UPDATED, f"TLE mock update: {success} satellites", EventLevel.INFO)
        await db.commit()
        return {"success": success, "failed": failed, "total": len(satellites)}

    # Fetch all TLEs in a single Space-Track request
    spacetrack_map: dict[int, tuple[str, str]] = {}
    if settings.spacetrack_available:
        client = await _spacetrack_login()
        if client:
            try:
                spacetrack_map = await _fetch_batch_from_spacetrack(norad_ids, client)
            finally:
                await client.aclose()

    # For satellites not found in Space-Track batch, try CelesTrak individually
    missing_ids = [n for n in norad_ids if n not in spacetrack_map]
    celestrak_map: dict[int, tuple[str, str]] = {}
    for norad in missing_ids:
        result_tle = await _fetch_from_celestrak(norad)
        if result_tle:
            celestrak_map[norad] = result_tle
        await asyncio.sleep(0.3)  # gentle rate limiting for CelesTrak

    # Store results
    success, failed, fallback = 0, 0, 0
    for sat in satellites:
        line1, line2, source = None, None, None
        if sat.norad_id in spacetrack_map:
            line1, line2 = spacetrack_map[sat.norad_id]
            source = "spacetrack"
        elif sat.norad_id in celestrak_map:
            line1, line2 = celestrak_map[sat.norad_id]
            source = "celestrak"

        if line1 and line2:
            epoch = _parse_tle_epoch(line1)
            if epoch and _tle_age_hours(epoch) > max_tle_age_for_orbit(sat.orbit_type) * 2:
                # Real TLE too stale (e.g. retired satellite) — mock so assignment engine doesn't set TLE_MISSING
                await _store_mock_tle(db, sat)
                await db.commit()
                fallback += 1
            else:
                await _store_tle(db, sat, line1, line2, epoch, source)
                await db.commit()
                success += 1
        else:
            # No real TLE available — check if we already have a usable record
            existing = await get_active_tle(db, sat.id)
            if existing and existing.source != "mock":
                age_ok = (
                    not existing.epoch or
                    _tle_age_hours(existing.epoch) <= max_tle_age_for_orbit(sat.orbit_type) * 2
                )
                if age_ok:
                    # Real TLE still valid — keep it
                    failed += 1
                else:
                    # Real TLE too old — replace with mock so assignment engine doesn't set TLE_MISSING
                    await _store_mock_tle(db, sat)
                    await db.commit()
                    fallback += 1
            else:
                # No real TLE ever — generate mock so satellite appears on map
                await _store_mock_tle(db, sat)
                await db.commit()
                fallback += 1

    if failed or fallback:
        print(f"Space-Track: {len(spacetrack_map)} | CelesTrak: {len(celestrak_map)} | kept existing: {failed} | mock fallback: {fallback}")

    await log_event(
        db, EventType.TLE_UPDATED,
        f"TLE update: {success} real, {fallback} mock fallback, {failed} kept existing",
        EventLevel.INFO if (failed + fallback) == 0 else EventLevel.WARNING,
    )
    await db.commit()
    return {"success": success, "failed": failed, "fallback": fallback, "total": len(satellites)}


async def fetch_or_mock_tle(db: AsyncSession, satellite: Satellite) -> TLERecord:
    """Fetch a real TLE; if none is available (e.g. long-decayed object), fall
    back to a mock TLE so the satellite still appears on the map/globe."""
    record = await fetch_and_store_tle(db, satellite)
    if record:
        return record
    return await _store_mock_tle(db, satellite)


async def store_manual_tle(
    db: AsyncSession,
    satellite_id: int,
    line1: str,
    line2: str,
) -> TLERecord:
    result = await db.execute(select(Satellite).where(Satellite.id == satellite_id))
    satellite = result.scalar_one()
    epoch = _parse_tle_epoch(line1)
    record = await _store_tle(db, satellite, line1.strip(), line2.strip(), epoch, "manual")
    await db.commit()
    return record
