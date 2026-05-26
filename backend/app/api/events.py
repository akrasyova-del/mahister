from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.event_service import get_recent_events

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
async def list_events(limit: int = Query(100, le=500), db: AsyncSession = Depends(get_db)):
    events = await get_recent_events(db, limit)
    return [
        {
            "id": e.id,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "level": e.level,
            "event_type": e.event_type,
            "message": e.message,
            "object_type": e.object_type,
            "object_id": e.object_id,
        }
        for e in events
    ]
