"""Unit tests for the assignment engine scoring functions."""
import pytest
from unittest.mock import MagicMock
from app.services.assignment_engine import (
    _geometry_score,
    _weather_score,
    _time_window_score,
    _capability_score,
    _load_balance_score,
    compute_score,
    TRANSFER_BONUS,
)
from app.models.telescope import TelescopeStatus


def make_telescope(
    id=1,
    status=TelescopeStatus.ONLINE,
    min_elevation_deg=15.0,
    max_cloud_cover_percent=40.0,
    max_low_cloud_cover_percent=25.0,
    max_wind_speed_mps=12.0,
    min_visibility_km=10.0,
):
    tel = MagicMock()
    tel.id = id
    tel.status = status
    tel.min_elevation_deg = min_elevation_deg
    tel.max_cloud_cover_percent = max_cloud_cover_percent
    tel.max_low_cloud_cover_percent = max_low_cloud_cover_percent
    tel.max_wind_speed_mps = max_wind_speed_mps
    tel.min_visibility_km = min_visibility_km
    return tel


def make_weather(cloud=20.0, low_cloud=10.0, wind=5.0, precip=0.0, vis=15.0):
    w = MagicMock()
    w.cloud_cover = cloud
    w.cloud_cover_low = low_cloud
    w.wind_speed = wind
    w.precipitation = precip
    w.visibility_km = vis
    return w


def make_pass_window(max_elev=45.0, duration_sec=600.0):
    pw = MagicMock()
    pw.max_elevation_deg = max_elev
    pw.duration_sec = duration_sec
    return pw


# --- geometry_score ---

def test_geometry_score_below_min():
    assert _geometry_score(10.0, 15.0) == 0.0


def test_geometry_score_none():
    assert _geometry_score(None, 15.0) == 0.0


def test_geometry_score_max():
    assert _geometry_score(90.0, 15.0) == 1.0


def test_geometry_score_at_75():
    assert _geometry_score(75.0, 15.0) == 1.0


def test_geometry_score_mid():
    score = _geometry_score(45.0, 15.0)
    assert 0.0 < score < 1.0
    # (45-15)/(75-15) = 30/60 = 0.5
    assert abs(score - 0.5) < 0.01


# --- weather_score ---

def test_weather_score_good_conditions():
    tel = make_telescope()
    w = make_weather()
    score = _weather_score(w, tel)
    assert score > 0.5


def test_weather_score_precipitation_blocks():
    tel = make_telescope()
    w = make_weather(precip=1.0)
    assert _weather_score(w, tel) == 0.0


def test_weather_score_high_cloud_blocks():
    tel = make_telescope(max_cloud_cover_percent=40.0)
    w = make_weather(cloud=50.0)
    assert _weather_score(w, tel) == 0.0


def test_weather_score_high_wind_blocks():
    tel = make_telescope(max_wind_speed_mps=12.0)
    w = make_weather(wind=15.0)
    assert _weather_score(w, tel) == 0.0


def test_weather_score_low_visibility_blocks():
    tel = make_telescope(min_visibility_km=10.0)
    w = make_weather(vis=5.0)
    assert _weather_score(w, tel) == 0.0


def test_weather_score_none_returns_partial():
    tel = make_telescope()
    assert _weather_score(None, tel) == 0.5


# --- time_window_score ---

def test_time_window_score_none():
    assert _time_window_score(None) == 0.0


def test_time_window_score_short_pass():
    pw = make_pass_window(duration_sec=300.0)  # 5 min
    score = _time_window_score(pw)
    assert 0.0 < score < 1.0


def test_time_window_score_long_pass():
    pw = make_pass_window(duration_sec=1500.0)  # >20 min → 1.0
    assert _time_window_score(pw) == 1.0


def test_time_window_score_exact_20min():
    pw = make_pass_window(duration_sec=1200.0)
    assert _time_window_score(pw) == 1.0


# --- capability_score ---

def test_capability_online():
    tel = make_telescope(status=TelescopeStatus.ONLINE)
    assert _capability_score(tel) == 1.0


def test_capability_offline():
    tel = make_telescope(status=TelescopeStatus.OFFLINE)
    assert _capability_score(tel) == 0.0


def test_capability_partial():
    tel = make_telescope(status=TelescopeStatus.PARTIAL)
    assert _capability_score(tel) == 0.5


def test_capability_manual():
    tel = make_telescope(status=TelescopeStatus.MANUAL_MODE)
    assert _capability_score(tel) == 0.7


# --- load_balance_score ---

def test_load_balance_empty():
    assert _load_balance_score(1, {}, 0) == 1.0


def test_load_balance_equal():
    load = {1: 10, 2: 10, 3: 10, 4: 10}
    score = _load_balance_score(1, load, 40)
    assert score == 1.0


def test_load_balance_overloaded():
    load = {1: 30, 2: 10, 3: 10, 4: 10}
    score = _load_balance_score(1, load, 60)
    assert score < 1.0


def test_load_balance_underloaded():
    load = {1: 5, 2: 20, 3: 20, 4: 20}
    score = _load_balance_score(1, load, 65)
    assert score == 1.0


# --- Transfer bonus ---

def test_transfer_bonus_applied():
    tel = make_telescope()
    weather = make_weather()
    pw = make_pass_window()
    load = {1: 10}
    scored = compute_score(tel, weather, pw, load, 40, is_transferred=True)
    scored_no_bonus = compute_score(tel, weather, pw, load, 40, is_transferred=False)
    assert scored.score > scored_no_bonus.score
    assert scored.is_transfer_bonus is True


def test_score_ceiling():
    """Score should never exceed 1.5."""
    tel = make_telescope()
    weather = make_weather()
    pw = make_pass_window(max_elev=90.0, duration_sec=2000.0)
    scored = compute_score(tel, weather, pw, {1: 0}, 1, is_transferred=True)
    assert scored.score <= 1.5
