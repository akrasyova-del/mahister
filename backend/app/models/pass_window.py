from sqlalchemy import Column, Integer, Float, Boolean, ForeignKey, DateTime, String
from sqlalchemy.sql import func
from app.database import Base


class PassWindow(Base):
    __tablename__ = "pass_windows"

    id = Column(Integer, primary_key=True, index=True)
    satellite_id = Column(Integer, ForeignKey("satellites.id"), nullable=False, index=True)
    telescope_id = Column(Integer, ForeignKey("telescopes.id"), nullable=False, index=True)
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    max_elevation_deg = Column(Float)
    max_elevation_time = Column(DateTime(timezone=True))
    azimuth_start = Column(Float)
    azimuth_end = Column(Float)
    duration_sec = Column(Float)
    observable = Column(Boolean, default=False)
    reason = Column(String(200))
    computed_at = Column(DateTime(timezone=True), server_default=func.now())
