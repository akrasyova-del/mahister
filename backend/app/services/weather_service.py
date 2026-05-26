import random
from datetime import datetime, timezone
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.config import settings
from app.models.telescope import Telescope, TelescopeStatus
from app.models.weather import WeatherSnapshot
from app.models.event_log import EventLevel, EventType
from app.services.event_service import log_event


OPEN_METEO_PARAMS = (
    "temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,"
    "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,"
    "wind_speed_10m,wind_gusts_10m,weather_code"
)


def _mock_weather(telescope: Telescope) -> dict:
    """Generate plausible mock weather data for a telescope location."""
    return {
        "temperature": round(random.uniform(5.0, 25.0), 1),
        "cloud_cover": round(random.uniform(0, 60), 1),
        "cloud_cover_low": round(random.uniform(0, 30), 1),
        "cloud_cover_mid": round(random.uniform(0, 20), 1),
        "cloud_cover_high": round(random.uniform(0, 20), 1),
        "precipitation": 0.0,
        "rain": 0.0,
        "snowfall": 0.0,
        "humidity": round(random.uniform(40, 80), 1),
        "wind_speed": round(random.uniform(1, 10), 1),
        "wind_gusts": round(random.uniform(2, 15), 1),
        "visibility_km": round(random.uniform(8, 25), 1),
        "weather_code": 0,
        "source": "mock",
    }


async def fetch_weather_for_telescope(telescope: Telescope) -> dict | None:
    """Fetch current weather from Open-Meteo or return mock data."""
    if settings.mock_weather:
        return _mock_weather(telescope)

    url = f"{settings.open_meteo_base_url}/forecast"
    params = {
        "latitude": telescope.latitude,
        "longitude": telescope.longitude,
        "current": OPEN_METEO_PARAMS,
        "wind_speed_unit": "ms",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            current = data.get("current", {})
            # Estimate visibility from weather_code: no API field available in free tier
            visibility_km = _estimate_visibility(
                current.get("weather_code", 0),
                current.get("cloud_cover_low", 0),
            )
            return {
                "temperature": current.get("temperature_2m"),
                "cloud_cover": current.get("cloud_cover"),
                "cloud_cover_low": current.get("cloud_cover_low"),
                "cloud_cover_mid": current.get("cloud_cover_mid"),
                "cloud_cover_high": current.get("cloud_cover_high"),
                "precipitation": current.get("precipitation", 0),
                "rain": current.get("rain", 0),
                "snowfall": current.get("snowfall", 0),
                "humidity": current.get("relative_humidity_2m"),
                "wind_speed": current.get("wind_speed_10m"),
                "wind_gusts": current.get("wind_gusts_10m"),
                "visibility_km": visibility_km,
                "weather_code": current.get("weather_code"),
                "source": "open-meteo",
            }
    except Exception as e:
        print(f"Open-Meteo: fetch failed for {telescope.name}: {e}")
        return None


def _estimate_visibility(weather_code: int, low_cloud: float) -> float:
    """Rough visibility estimate based on WMO weather code."""
    if weather_code in range(40, 50):  # fog
        return 0.5
    if weather_code in range(50, 70):  # drizzle/rain
        return 5.0
    if weather_code in range(70, 80):  # snow
        return 3.0
    if weather_code in range(80, 100):  # showers/thunderstorm
        return 4.0
    if low_cloud and low_cloud > 80:
        return 8.0
    return 20.0


def _determine_telescope_status(
    telescope: Telescope,
    weather: dict,
    current_status: TelescopeStatus,
) -> TelescopeStatus:
    """Decide if telescope should be WEATHER_BLOCKED based on conditions."""
    # Manual or error statuses are not overridden automatically
    if current_status in (TelescopeStatus.MANUAL_MODE, TelescopeStatus.OFFLINE, TelescopeStatus.ERROR):
        return current_status

    blocked = (
        weather.get("cloud_cover", 0) > telescope.max_cloud_cover_percent
        or weather.get("cloud_cover_low", 0) > telescope.max_low_cloud_cover_percent
        or weather.get("wind_speed", 0) > telescope.max_wind_speed_mps
        or (weather.get("visibility_km") or 20) < telescope.min_visibility_km
        or weather.get("precipitation", 0) > 0
    )
    if blocked:
        return TelescopeStatus.WEATHER_BLOCKED
    return TelescopeStatus.ONLINE


async def update_all_weather(db: AsyncSession) -> list[dict]:
    """Fetch and store weather for all active telescopes."""
    result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = result.scalars().all()

    updated = []
    for telescope in telescopes:
        data = await fetch_weather_for_telescope(telescope)
        if data is None:
            await log_event(
                db, EventType.WEATHER_UPDATED,
                f"Weather fetch failed for {telescope.name}, using mock",
                EventLevel.WARNING, "telescope", telescope.id,
            )
            data = _mock_weather(telescope)

        snapshot = WeatherSnapshot(
            telescope_id=telescope.id,
            timestamp=datetime.now(timezone.utc),
            **{k: v for k, v in data.items() if k != "source"},
            source=data.get("source", "open-meteo"),
        )
        db.add(snapshot)

        prev_status = telescope.status
        new_status = _determine_telescope_status(telescope, data, telescope.status)
        if new_status != prev_status:
            telescope.status = new_status
            level = EventLevel.WARNING if new_status == TelescopeStatus.WEATHER_BLOCKED else EventLevel.INFO
            await log_event(
                db, EventType.TELESCOPE_STATUS_CHANGED,
                f"{telescope.name}: {prev_status} → {new_status} (weather)",
                level, "telescope", telescope.id,
            )

        updated.append({"telescope_id": telescope.id, "code": telescope.code, "data": data})

    await db.commit()
    return updated


async def get_latest_weather(db: AsyncSession, telescope_id: int) -> WeatherSnapshot | None:
    result = await db.execute(
        select(WeatherSnapshot)
        .where(WeatherSnapshot.telescope_id == telescope_id)
        .order_by(desc(WeatherSnapshot.timestamp))
        .limit(1)
    )
    return result.scalar_one_or_none()
