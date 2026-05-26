"""Seed initial telescopes and satellites into the database."""
import json
import os
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.telescope import Telescope, TelescopeStatus
from app.models.satellite import Satellite, OrbitType
from app.models.assignment import Assignment, AssignmentStatus, PriorityType

TELESCOPES = [
    {
        "code": "KYIV_TELESCOPE",
        "name": "Київський оптичний засіб",
        "region": "Київська область",
        "address": "вул. Зоологічна 3, Голосіїв, Київ 03127",
        "latitude": 50.36306,
        "longitude": 30.49583,
        "altitude_m": 188.0,
        "status": TelescopeStatus.ONLINE,
        "min_elevation_deg": 15.0,
        "max_cloud_cover_percent": 40.0,
        "max_low_cloud_cover_percent": 25.0,
        "max_wind_speed_mps": 12.0,
        "min_visibility_km": 10.0,
        "active": True,
    },
    {
        "code": "ZAKARPATTIA_TELESCOPE",
        "name": "Закарпатський оптичний засіб",
        "region": "Закарпатська область",
        "address": "вул. Університетська 14, Ужгород 88000, Закарпатська обл.",
        "latitude": 48.6208,
        "longitude": 22.3060,
        "altitude_m": 112.0,
        "status": TelescopeStatus.ONLINE,
        "min_elevation_deg": 15.0,
        "max_cloud_cover_percent": 40.0,
        "max_low_cloud_cover_percent": 25.0,
        "max_wind_speed_mps": 12.0,
        "min_visibility_km": 10.0,
        "active": True,
    },
    {
        "code": "ZHYTOMYR_TELESCOPE",
        "name": "Житомирський оптичний засіб",
        "region": "Житомирська область",
        "address": "вул. Велика Бердичівська 17, Житомир 10008, Житомирська обл.",
        "latitude": 50.0200,
        "longitude": 29.0200,
        "altitude_m": 220.0,
        "status": TelescopeStatus.ONLINE,
        "min_elevation_deg": 15.0,
        "max_cloud_cover_percent": 40.0,
        "max_low_cloud_cover_percent": 25.0,
        "max_wind_speed_mps": 12.0,
        "min_visibility_km": 10.0,
        "active": True,
    },
    {
        "code": "ODESA_TELESCOPE",
        "name": "Одеський оптичний засіб",
        "region": "Одеська область",
        "address": "Паркова дорога 3, Одеса 65014, Одеська обл.",
        "latitude": 46.4767,
        "longitude": 30.7583,
        "altitude_m": 60.0,
        "status": TelescopeStatus.ONLINE,
        "min_elevation_deg": 15.0,
        "max_cloud_cover_percent": 40.0,
        "max_low_cloud_cover_percent": 25.0,
        "max_wind_speed_mps": 12.0,
        "min_visibility_km": 10.0,
        "active": True,
    },
]

# IDs 1–14 → KYIV, 15–28 → ZAKARPATTIA, 29–42 → ZHYTOMYR, 43–55 → ODESA
TELESCOPE_ASSIGNMENT = {
    "KYIV_TELESCOPE": list(range(1, 15)),
    "ZAKARPATTIA_TELESCOPE": list(range(15, 29)),
    "ZHYTOMYR_TELESCOPE": list(range(29, 43)),
    "ODESA_TELESCOPE": list(range(43, 56)),
}


async def seed_telescopes(db: AsyncSession) -> dict[str, int]:
    """Upsert telescopes. Handles VOLYN→ZAKARPATTIA rename. Returns code→id map."""
    # Handle rename: only rename VOLYN if ZAKARPATTIA does not yet exist
    volyn = (await db.execute(select(Telescope).where(Telescope.code == "VOLYN_TELESCOPE"))).scalar_one_or_none()
    if volyn:
        zakarpattia_exists = (await db.execute(
            select(Telescope).where(Telescope.code == "ZAKARPATTIA_TELESCOPE")
        )).scalar_one_or_none()
        if zakarpattia_exists:
            # Both records exist (partial migration): delete the stale ZAKARPATTIA duplicate,
            # then rename VOLYN so the upsert loop updates it with fresh data.
            await db.delete(zakarpattia_exists)
            await db.flush()
        volyn.code = "ZAKARPATTIA_TELESCOPE"
        await db.flush()

    code_to_id = {}
    for tdata in TELESCOPES:
        existing = (await db.execute(select(Telescope).where(Telescope.code == tdata["code"]))).scalar_one_or_none()
        if existing:
            for k, v in tdata.items():
                setattr(existing, k, v)
            code_to_id[tdata["code"]] = existing.id
        else:
            tel = Telescope(**tdata)
            db.add(tel)
            await db.flush()
            code_to_id[tdata["code"]] = tel.id
    await db.commit()
    return code_to_id


async def seed_satellites(db: AsyncSession, telescope_id_map: dict[str, int]):
    """Insert satellites from JSON if not present, with home_telescope_id."""
    data_path = Path(__file__).parent.parent.parent.parent / "data" / "satellites.json"
    if not data_path.exists():
        # Try relative path for different working directories
        alt_path = Path("data/satellites.json")
        if alt_path.exists():
            data_path = alt_path
        else:
            print(f"WARNING: satellites.json not found at {data_path}")
            return

    with open(data_path, "r", encoding="utf-8") as f:
        satellites_data = json.load(f)

    # Build reverse map: satellite_id → telescope code
    sat_to_telescope = {}
    for code, sat_ids in TELESCOPE_ASSIGNMENT.items():
        for sid in sat_ids:
            sat_to_telescope[sid] = code

    for sdata in satellites_data:
        result = await db.execute(select(Satellite).where(Satellite.norad_id == sdata["norad_id"]))
        existing = result.scalar_one_or_none()
        if existing:
            continue

        tel_code = sat_to_telescope.get(sdata["id"])
        home_tel_id = telescope_id_map.get(tel_code) if tel_code else None

        sat = Satellite(
            category=sdata["category"],
            international_designator=sdata["international_designator"],
            norad_id=sdata["norad_id"],
            name=sdata["name"],
            orbit_type=OrbitType(sdata["orbit_type"]),
            priority=sdata["priority"],
            active=sdata["active"],
            home_telescope_id=home_tel_id,
            assigned_telescope_id=home_tel_id,
        )
        db.add(sat)

    await db.flush()

    # Create initial assignments for satellites that don't have one
    sat_result = await db.execute(select(Satellite).where(Satellite.active == True))
    for sat in sat_result.scalars().all():
        assign_result = await db.execute(
            select(Assignment).where(Assignment.satellite_id == sat.id)
        )
        existing_assign = assign_result.scalar_one_or_none()
        if not existing_assign:
            db.add(Assignment(
                satellite_id=sat.id,
                home_telescope_id=sat.home_telescope_id,
                assigned_telescope_id=sat.home_telescope_id,
                status=AssignmentStatus.LOCAL_ASSIGNED,
                priority_type=PriorityType.NORMAL,
                reason="Initial assignment",
                score=0.5,
            ))
        elif existing_assign.status == AssignmentStatus.TLE_MISSING and sat.home_telescope_id:
            # Reset stale TLE_MISSING so run_assignment can try again
            existing_assign.assigned_telescope_id = sat.home_telescope_id
            existing_assign.status = AssignmentStatus.LOCAL_ASSIGNED
            existing_assign.reason = "Reset from TLE_MISSING on startup"

    await db.commit()


async def run_seed(db: AsyncSession):
    telescope_map = await seed_telescopes(db)
    await seed_satellites(db, telescope_map)
