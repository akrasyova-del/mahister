from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.telescope import Telescope
from app.services.weather_service import update_all_weather, get_latest_weather
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.post("/update")
async def trigger_weather_update(db: AsyncSession = Depends(get_db)):
    results = await update_all_weather(db)
    await ws_manager.send_event("weather_updated", {"telescopes_updated": len(results)})
    return {"status": "ok", "updated": len(results)}


@router.get("/telescopes")
async def get_weather_all(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Telescope).where(Telescope.active == True))
    telescopes = result.scalars().all()

    out = []
    for tel in telescopes:
        w = await get_latest_weather(db, tel.id)
        out.append({
            "telescope_id": tel.id,
            "telescope_code": tel.code,
            "telescope_name": tel.name,
            "weather": {
                "temperature": w.temperature if w else None,
                "cloud_cover": w.cloud_cover if w else None,
                "cloud_cover_low": w.cloud_cover_low if w else None,
                "cloud_cover_mid": w.cloud_cover_mid if w else None,
                "cloud_cover_high": w.cloud_cover_high if w else None,
                "precipitation": w.precipitation if w else None,
                "humidity": w.humidity if w else None,
                "wind_speed": w.wind_speed if w else None,
                "wind_gusts": w.wind_gusts if w else None,
                "visibility_km": w.visibility_km if w else None,
                "weather_code": w.weather_code if w else None,
                "source": w.source if w else None,
                "timestamp": w.timestamp.isoformat() if w and w.timestamp else None,
            } if w else None,
        })
    return out
