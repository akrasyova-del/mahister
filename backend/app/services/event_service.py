from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.models.event_log import EventLog, EventLevel, EventType


async def log_event(
    db: AsyncSession,
    event_type: EventType,
    message: str,
    level: EventLevel = EventLevel.INFO,
    object_type: str | None = None,
    object_id: int | None = None,
) -> EventLog:
    event = EventLog(
        timestamp=datetime.now(timezone.utc),
        level=level,
        event_type=event_type,
        message=message,
        object_type=object_type,
        object_id=object_id,
    )
    db.add(event)
    await db.flush()
    return event


async def get_recent_events(db: AsyncSession, limit: int = 100) -> list[EventLog]:
    result = await db.execute(
        select(EventLog).order_by(desc(EventLog.timestamp)).limit(limit)
    )
    return result.scalars().all()
