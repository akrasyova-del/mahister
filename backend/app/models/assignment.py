from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum as SAEnum
from sqlalchemy.sql import func
from app.database import Base
import enum


class AssignmentStatus(str, enum.Enum):
    LOCAL_ASSIGNED = "LOCAL_ASSIGNED"
    TRANSFERRED = "TRANSFERRED"
    WAITING_VISIBILITY = "WAITING_VISIBILITY"
    NO_AVAILABLE_TELESCOPE = "NO_AVAILABLE_TELESCOPE"
    TLE_MISSING = "TLE_MISSING"
    WEATHER_BLOCKED = "WEATHER_BLOCKED"
    MANUAL_ASSIGNED = "MANUAL_ASSIGNED"


class PriorityType(str, enum.Enum):
    NORMAL = "NORMAL"
    TRANSFERRED = "TRANSFERRED"


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    satellite_id = Column(Integer, ForeignKey("satellites.id"), nullable=False, unique=True, index=True)
    home_telescope_id = Column(Integer, ForeignKey("telescopes.id"))
    assigned_telescope_id = Column(Integer, ForeignKey("telescopes.id"), nullable=True)
    status = Column(SAEnum(AssignmentStatus), default=AssignmentStatus.LOCAL_ASSIGNED)
    priority_type = Column(SAEnum(PriorityType), default=PriorityType.NORMAL)
    reason = Column(String(500))
    score = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PriorityTransfer(Base):
    __tablename__ = "priority_transfers"

    id = Column(Integer, primary_key=True, index=True)
    satellite_id = Column(Integer, ForeignKey("satellites.id"), nullable=False, index=True)
    from_telescope_id = Column(Integer, ForeignKey("telescopes.id"))
    to_telescope_id = Column(Integer, ForeignKey("telescopes.id"))
    reason = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    active = Column(Integer, default=1)
