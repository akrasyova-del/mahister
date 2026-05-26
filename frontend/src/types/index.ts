export type TelescopeStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'WEATHER_BLOCKED'
  | 'PARTIAL'
  | 'MANUAL_MODE'
  | 'ERROR'

export type OrbitType = 'LEO' | 'MEO' | 'GEO' | 'HEO'

export type AssignmentStatus =
  | 'LOCAL_ASSIGNED'
  | 'TRANSFERRED'
  | 'WAITING_VISIBILITY'
  | 'NO_AVAILABLE_TELESCOPE'
  | 'TLE_MISSING'
  | 'WEATHER_BLOCKED'
  | 'MANUAL_ASSIGNED'

export type PriorityType = 'NORMAL' | 'TRANSFERRED'

export interface Weather {
  temperature: number | null
  cloud_cover: number | null
  cloud_cover_low: number | null
  cloud_cover_mid: number | null
  cloud_cover_high: number | null
  precipitation: number | null
  humidity: number | null
  wind_speed: number | null
  wind_gusts: number | null
  visibility_km: number | null
  weather_code: number | null
  source: string | null
  timestamp: string | null
}

export interface Telescope {
  id: number
  code: string
  name: string
  region: string
  latitude: number
  longitude: number
  altitude_m: number
  status: TelescopeStatus
  min_elevation_deg: number
  max_cloud_cover_percent: number
  max_low_cloud_cover_percent: number
  max_wind_speed_mps: number
  min_visibility_km: number
  active: boolean
  address?: string | null
  weather?: Weather
}

export interface TelescopeCard extends Telescope {
  local_satellites: number
  transferred_satellites: number
  no_visibility_satellites: number
  total_assigned: number
  last_tle_update: string | null
  last_weather_update: string | null
}

export interface Satellite {
  id: number
  name: string
  norad_id: number
  international_designator: string
  category: string
  orbit_type: OrbitType
  priority: number
  active: boolean
  home_telescope_id: number | null
  home_telescope_name: string | null
  assigned_telescope_id: number | null
  assigned_telescope_name: string | null
  tle_status: string
  tle_epoch: string | null
  tle_source: string | null
  tle_age_hours: number | null
  assignment_status: AssignmentStatus | null
  assignment_reason: string | null
  assignment_score: number | null
  priority_type: PriorityType | null
}

export interface Assignment {
  id: number
  satellite_id: number
  satellite_name: string
  norad_id: number
  category: string
  orbit_type: OrbitType
  priority: number
  home_telescope_id: number | null
  home_telescope_name: string | null
  assigned_telescope_id: number | null
  assigned_telescope_name: string | null
  status: AssignmentStatus
  priority_type: PriorityType
  reason: string
  score: number | null
  updated_at: string | null
  next_pass_start: string | null
  next_pass_end: string | null
  max_elevation_deg: number | null
}

export interface Event {
  id: number
  timestamp: string | null
  level: string
  event_type: string
  message: string
  object_type?: string
  object_id?: number
}

export interface DashboardState {
  timestamp: string
  total_satellites: number
  tle_missing: number
  transferred_total: number
  online_telescopes: number
  telescopes: TelescopeCard[]
  recent_events: Event[]
}

export interface PassWindow {
  id: number
  satellite_id: number
  telescope_id: number
  start_time: string | null
  end_time: string | null
  max_elevation_deg: number | null
  duration_sec: number | null
  observable: boolean
  reason: string | null
}
