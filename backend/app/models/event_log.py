from sqlalchemy import Column, Integer, String, DateTime, Enum as SAEnum
from sqlalchemy.sql import func
from app.database import Base
import enum


class EventLevel(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class EventType(str, enum.Enum):
    SYSTEM_START = "SYSTEM_START"
    TLE_UPDATED = "TLE_UPDATED"
    TLE_ERROR = "TLE_ERROR"
    WEATHER_UPDATED = "WEATHER_UPDATED"
    WEATHER_DEGRADED = "WEATHER_DEGRADED"
    TELESCOPE_STATUS_CHANGED = "TELESCOPE_STATUS_CHANGED"
    TELESCOPE_RECOVERED = "TELESCOPE_RECOVERED"
    AUTO_REASSIGNMENT = "AUTO_REASSIGNMENT"
    MANUAL_REASSIGNMENT = "MANUAL_REASSIGNMENT"
    NO_TELESCOPE_AVAILABLE = "NO_TELESCOPE_AVAILABLE"


class EventLog(Base):
    __tablename__ = "event_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    level = Column(SAEnum(EventLevel), default=EventLevel.INFO)
    event_type = Column(SAEnum(EventType))
    message = Column(String(1000))
    object_type = Column(String(50))  # telescope, satellite, assignment
    object_id = Column(Integer)
