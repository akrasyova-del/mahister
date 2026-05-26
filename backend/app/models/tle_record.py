from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.sql import func
from app.database import Base


class TLERecord(Base):
    __tablename__ = "tle_records"

    id = Column(Integer, primary_key=True, index=True)
    satellite_id = Column(Integer, ForeignKey("satellites.id"), nullable=False)
    norad_id = Column(Integer, index=True)
    tle_line1 = Column(String(70))
    tle_line2 = Column(String(70))
    epoch = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(50))  # celestrak, spacetrack, mock, manual
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
