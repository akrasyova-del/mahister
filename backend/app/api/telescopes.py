from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.telescope import Telescope, TelescopeStatus
from app.models.event_log import EventLevel, EventType
from app.services.event_service import log_event
from app.services.weather_service import get_latest_weather
from app.websocket.manager import ws_manager
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/telescopes", tags=["telescopes"])


class StatusUpdate(BaseModel):
    status: TelescopeStatus


class SettingsUpdate(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    min_elevation_deg: Optional[float] = None
    max_cloud_cover_percent: Optional[float] = None
    max_low_cloud_cover_percent: Optional[float] = None
    max_wind_speed_mps: Optional[float] = None
    min_visibility_km: Optional[float] = None


def _telescope_dict(tel: Telescope) -> dict:
    return {
        "id": tel.id,
        "code": tel.code,
        "name": tel.name,
        "region": tel.region,
        "latitude": tel.latitude,
        "longitude": tel.longitude,
        "altitude_m": tel.altitude_m,
        "status": tel.status,
        "min_elevation_deg": tel.min_elevation_deg,
        "max_cloud_cover_percent": tel.max_cloud_cover_percent,
        "max_low_cloud_cover_percent": tel.max_low_cloud_cover_percent,
        "max_wind_speed_mps": tel.max_wind_speed_mps,
        "min_visibility_km": tel.min_visibility_km,
        "active": tel.active,
    }


@router.get("")
async def list_telescopes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = result.scalars().all()
    return [_telescope_dict(t) for t in telescopes]


@router.get("/{code}")
async def get_telescope(code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Telescope).where(Telescope.code == code))
    tel = result.scalar_one_or_none()
    if not tel:
        raise HTTPException(404, f"Telescope {code} not found")

    weather = await get_latest_weather(db, tel.id)
    data = _telescope_dict(tel)
    if weather:
        data["weather"] = {
            "temperature": weather.temperature,
            "cloud_cover": weather.cloud_cover,
            "cloud_cover_low": weather.cloud_cover_low,
            "cloud_cover_mid": weather.cloud_cover_mid,
            "cloud_cover_high": weather.cloud_cover_high,
            "precipitation": weather.precipitation,
            "humidity": weather.humidity,
            "wind_speed": weather.wind_speed,
            "wind_gusts": weather.wind_gusts,
            "visibility_km": weather.visibility_km,
            "weather_code": weather.weather_code,
            "source": weather.source,
            "timestamp": weather.timestamp.isoformat() if weather.timestamp else None,
        }
    return data


@router.patch("/{code}/status")
async def update_status(code: str, body: StatusUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Telescope).where(Telescope.code == code))
    tel = result.scalar_one_or_none()
    if not tel:
        raise HTTPException(404, f"Telescope {code} not found")

    old_status = tel.status
    tel.status = body.status
    await log_event(
        db, EventType.TELESCOPE_STATUS_CHANGED,
        f"{tel.name}: {old_status} → {body.status} (manual)",
        EventLevel.INFO, "telescope", tel.id,
    )
    await db.commit()
    await ws_manager.send_event("telescope_status_changed", {"code": code, "status": body.status})
    return _telescope_dict(tel)


@router.patch("/{code}/settings")
async def update_settings(code: str, body: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Telescope).where(Telescope.code == code))
    tel = result.scalar_one_or_none()
    if not tel:
        raise HTTPException(404, f"Telescope {code} not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tel, field, value)
    await db.commit()
    return _telescope_dict(tel)
