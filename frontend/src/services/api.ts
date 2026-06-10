import axios from 'axios'
import type {
  Telescope,
  Satellite,
  Assignment,
  DashboardState,
  Event,
  PassWindow,
  CatalogEntry,
} from '../types'

const api = axios.create({ baseURL: '/api' })

// Telescopes
export const getTelescopes = () =>
  api.get<Telescope[]>('/telescopes').then(r => r.data)

export const getTelescope = (code: string) =>
  api.get<Telescope>(`/telescopes/${code}`).then(r => r.data)

export const updateTelescopeStatus = (code: string, status: string) =>
  api.patch<Telescope>(`/telescopes/${code}/status`, { status }).then(r => r.data)

export const updateTelescopeSettings = (code: string, settings: Record<string, unknown>) =>
  api.patch<Telescope>(`/telescopes/${code}/settings`, settings).then(r => r.data)

// Satellites
export const getSatellites = (params?: { category?: string; orbit_type?: string; include_untracked?: boolean }) =>
  api.get<Satellite[]>('/satellites', { params }).then(r => r.data)

export const getSatellite = (noradId: number) =>
  api.get<Satellite>(`/satellites/${noradId}`).then(r => r.data)

export const updateSatellitePriority = (noradId: number, priority: number) =>
  api.patch<{ norad_id: number; priority: number }>(`/satellites/${noradId}/priority`, { priority }).then(r => r.data)

export const updateSatelliteTracked = (noradId: number, tracked: boolean) =>
  api.patch<{ norad_id: number; tracked: boolean }>(`/satellites/${noradId}/tracked`, { tracked }).then(r => r.data)

export const updateSatelliteCategory = (noradId: number, category: string | null) =>
  api.patch<{ norad_id: number; category: string | null }>(`/satellites/${noradId}/category`, { category }).then(r => r.data)

// Catalog (Space-Track satcat)
export const getCatalog = (params?: { search?: string; hide_tracked?: boolean }) =>
  api.get<CatalogEntry[]>('/catalog', { params }).then(r => r.data)

export const syncCatalog = () =>
  api.post<{ status: string; synced: number; synced_at?: string }>('/catalog/sync').then(r => r.data)

export const importFromCatalog = (norad_ids: number[], category?: string | null) =>
  api.post<{ status: string; imported: number; reactivated: number }>('/catalog/import', { norad_ids, category }).then(r => r.data)

// TLE
export const triggerTleUpdate = () =>
  api.post<{ status: string; success: number; failed: number }>('/tle/update').then(r => r.data)

export const getTleStatus = () =>
  api.get<unknown[]>('/tle/status').then(r => r.data)

export const getTleLines = () =>
  api.get<{ satellite_id: number; norad_id: number; name: string; orbit_type: string; tle_line1: string; tle_line2: string }[]>('/tle/lines').then(r => r.data)

export const setManualTle = (satellite_id: number, tle_line1: string, tle_line2: string) =>
  api.post('/tle/manual', { satellite_id, tle_line1, tle_line2 }).then(r => r.data)

// Weather
export const triggerWeatherUpdate = () =>
  api.post<{ status: string; updated: number }>('/weather/update').then(r => r.data)

export const getWeatherAll = () =>
  api.get<unknown[]>('/weather/telescopes').then(r => r.data)

// Passes
export const recalculatePasses = () =>
  api.post('/passes/recalculate').then(r => r.data)

export const getPasses = (params?: {
  satellite_id?: number
  telescope_id?: number
  from_time?: string
  to_time?: string
}) => api.get<PassWindow[]>('/passes', { params }).then(r => r.data)

// Assignments
export const getAssignments = (params?: {
  telescope_id?: number
  status?: string
  category?: string
  transferred_only?: boolean
}) => api.get<Assignment[]>('/assignments/current', { params }).then(r => r.data)

export const recalculateAssignments = () =>
  api.post('/assignments/recalculate').then(r => r.data)

export const manualAssign = (satellite_id: number, telescope_id: number, reason?: string) =>
  api.post<Assignment>('/assignments/manual', { satellite_id, telescope_id, reason }).then(r => r.data)

// Dashboard
export const getDashboardState = () =>
  api.get<DashboardState>('/dashboard/state').then(r => r.data)

// Events
export const getEvents = (limit = 100) =>
  api.get<Event[]>('/events', { params: { limit } }).then(r => r.data)
