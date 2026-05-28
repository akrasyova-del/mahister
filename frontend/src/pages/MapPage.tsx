import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import * as satjs from 'satellite.js'
import { getTelescopes, getAssignments, getTleLines, triggerWeatherUpdate, updateTelescopeStatus } from '../services/api'
import { StatusBadge, TELESCOPE_STATUS_COLOR } from '../components/StatusBadge'
import type { Telescope, Assignment, TelescopeStatus } from '../types'
import { wsService } from '../services/websocket'
import 'leaflet/dist/leaflet.css'

const UKRAINE_CENTER: [number, number] = [49.0, 31.5]

const TRACKED_STATUSES = new Set(['LOCAL_ASSIGNED', 'TRANSFERRED', 'MANUAL_ASSIGNED'])

function makeObservatoryIcon(color: string): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 42" width="36" height="42">
    <path d="M3 22 A15 17 0 0 1 33 22 Z" fill="${color}" opacity="0.95"/>
    <rect x="16" y="6" width="4" height="16" fill="rgba(0,0,0,0.45)"/>
    <rect x="3" y="22" width="30" height="9" rx="1.5" fill="${color}" opacity="0.95"/>
    <rect x="14" y="24" width="8" height="7" fill="rgba(0,0,0,0.35)"/>
    <rect x="1" y="31" width="34" height="4" rx="2" fill="${color}"/>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [36, 42],
    iconAnchor: [18, 35],
    popupAnchor: [0, -35],
  })
}
const DEG = Math.PI / 180

interface SatMapPoint {
  satellite_id: number
  norad_id: number
  name: string
  category?: string
  orbit_type: string
  lat: number
  lng: number
  altKm: number
  tracked: boolean
  observable: boolean
  maxElevationDeg?: number
  observingTelescope?: string
  assignment?: Assignment
}

function calcSatState(tle1: string, tle2: string, date: Date) {
  try {
    const satrec = satjs.twoline2satrec(tle1, tle2)
    const pv = satjs.propagate(satrec, date)
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null
    const gmst = satjs.gstime(date)
    const geo = satjs.eciToGeodetic(pv.position as satjs.EciVec3<number>, gmst)
    const lat = satjs.degreesLat(geo.latitude)
    const lng = satjs.degreesLong(geo.longitude)
    const altKm = geo.height  // km above surface
    if (!isFinite(lat) || !isFinite(lng)) return null
    return { lat, lng, altKm, posEci: pv.position as satjs.EciVec3<number>, gmst }
  } catch {
    return null
  }
}

function getElevationDeg(
  posEci: satjs.EciVec3<number>,
  gmst: number,
  telLat: number,
  telLng: number,
  telAltM: number,
): number {
  try {
    const posEcf = satjs.eciToEcf(posEci, gmst)
    const observerGd = {
      latitude: telLat * DEG,
      longitude: telLng * DEG,
      height: telAltM / 1000,
    }
    const look = satjs.ecfToLookAngles(observerGd, posEcf)
    return look.elevation / DEG
  } catch {
    return -90
  }
}

function TelescopePopup({ tel, assignments }: { tel: Telescope; assignments: Assignment[] }) {
  const [changing, setChanging] = useState(false)
  const assigned = assignments.filter(a => a.assigned_telescope_id === tel.id)

  const setStatus = async (status: string) => {
    setChanging(true)
    await updateTelescopeStatus(tel.code, status)
    setChanging(false)
  }

  return (
    <div className="min-w-[240px]">
      <h3 className="font-bold text-white text-sm mb-0.5">{tel.name}</h3>
      <p className="text-xs text-gray-500 mb-0.5">{tel.region}</p>
      {tel.address && (
        <p className="text-xs text-gray-400 mb-2 leading-snug">{tel.address}</p>
      )}

      <div className="text-xs space-y-1 mb-3">
        <div className="flex justify-between">
          <span className="text-gray-500">Статус:</span>
          <StatusBadge status={tel.status} type="telescope" />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Координати:</span>
          <span className="font-mono">{tel.latitude.toFixed(4)}, {tel.longitude.toFixed(4)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Висота:</span>
          <span>{tel.altitude_m} м</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">КА (всього):</span>
          <span className="font-bold">{assigned.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Перенаправлених:</span>
          <span className={assigned.filter(a => a.priority_type === 'TRANSFERRED').length > 0 ? 'text-amber-600 font-bold' : ''}>
            {assigned.filter(a => a.priority_type === 'TRANSFERRED').length}
          </span>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {(['ONLINE', 'OFFLINE'] as TelescopeStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={changing || tel.status === s}
            className="px-2 py-1 text-xs rounded border disabled:opacity-40"
            style={{ borderColor: TELESCOPE_STATUS_COLOR[s], color: TELESCOPE_STATUS_COLOR[s] }}
          >
            {s === 'ONLINE' ? 'Увімк' : 'Вимк'}
          </button>
        ))}
      </div>

      {assigned.filter(a => a.priority_type === 'TRANSFERRED').length > 0 && (
        <div className="mt-2 text-xs">
          <p className="font-semibold text-amber-400 mb-1">Перенаправлені КА:</p>
          <ul className="space-y-0.5 max-h-24 overflow-y-auto">
            {assigned.filter(a => a.priority_type === 'TRANSFERRED').map(a => (
              <li key={a.id} className="text-gray-300 truncate">{a.satellite_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SatellitePopup({ sat }: { sat: SatMapPoint }) {
  return (
    <div className="min-w-[200px]">
      <h3 className="font-bold text-white text-sm mb-1 leading-snug">{sat.name}</h3>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">NORAD:</span>
          <span className="font-mono">{sat.norad_id}</span>
        </div>
        {sat.category && (
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Категорія:</span>
            <span className="text-right max-w-[130px]">{sat.category}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">Орбіта:</span>
          <span>{sat.orbit_type}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">Субсупутникова точка:</span>
          <span className="font-mono">{sat.lat.toFixed(1)}°, {sat.lng.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">Висота:</span>
          <span className="font-mono">{sat.altKm < 1000
            ? `${sat.altKm.toFixed(0)} км`
            : `${(sat.altKm / 1000).toFixed(1)} тис. км`}
          </span>
        </div>
        <div className="flex justify-between gap-3 pt-1 border-t border-gray-700 mt-1">
          <span className="text-gray-500">Кут піднесення:</span>
          <span className={sat.observable ? 'text-green-600 font-semibold' : 'text-gray-400'}>
            {sat.maxElevationDeg != null ? `${sat.maxElevationDeg.toFixed(1)}°` : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">Статус:</span>
          <span className={sat.tracked && sat.observable ? 'text-green-600 font-semibold' : 'text-gray-400'}>
            {sat.tracked && sat.observable
              ? `Спостерігається (${sat.observingTelescope?.split(' ')[0] ?? ''})`
              : 'Призначено, поза видимістю'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function MapPage() {
  const [telescopes, setTelescopes] = useState<Telescope[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [satPoints, setSatPoints] = useState<SatMapPoint[]>([])

  const loadSatellites = useCallback(async (asgns: Assignment[], tels: Telescope[]) => {
    const tles = await getTleLines()
    const now = new Date()
    const pts: SatMapPoint[] = []
    for (const tle of tles) {
      const state = calcSatState(tle.tle_line1, tle.tle_line2, now)
      if (!state) continue
      const assignment = asgns.find(a => a.satellite_id === tle.satellite_id)
      const isTracked = assignment ? TRACKED_STATUSES.has(assignment.status) : false

      // Observable = currently above horizon of the ASSIGNED telescope
      let observable = false
      let maxElevationDeg: number | undefined
      let observingTelescope: string | undefined
      if (isTracked && assignment?.assigned_telescope_id != null) {
        const assignedTel = tels.find(t => t.id === assignment.assigned_telescope_id)
        if (assignedTel && assignedTel.status !== 'OFFLINE' && assignedTel.status !== 'ERROR') {
          const elev = getElevationDeg(state.posEci, state.gmst, assignedTel.latitude, assignedTel.longitude, assignedTel.altitude_m)
          maxElevationDeg = elev
          if (elev >= assignedTel.min_elevation_deg) {
            observable = true
            observingTelescope = assignedTel.name
          }
        }
      }

      pts.push({
        satellite_id: tle.satellite_id,
        norad_id: tle.norad_id,
        name: tle.name,
        category: assignment?.category,
        orbit_type: tle.orbit_type,
        lat: state.lat,
        lng: state.lng,
        altKm: state.altKm ?? 0,
        tracked: isTracked,
        observable,
        maxElevationDeg,
        observingTelescope,
        assignment,
      })
    }
    setSatPoints(pts)
  }, [])

  const load = useCallback(async () => {
    const [tels, asgns] = await Promise.all([getTelescopes(), getAssignments()])
    setTelescopes(tels)
    setAssignments(asgns)
    await loadSatellites(asgns, tels)
  }, [loadSatellites])

  useEffect(() => {
    load()
    const unsub = wsService.onMessage((type) => {
      if (['weather_updated', 'telescope_status_changed', 'assignments_updated'].includes(type)) load()
    })
    // Refresh satellite positions every 60 seconds
    const posTimer = setInterval(() => {
      Promise.all([getAssignments(), getTelescopes()]).then(([asgns, tels]) => loadSatellites(asgns, tels))
    }, 60_000)
    return () => { unsub(); clearInterval(posTimer) }
  }, [load, loadSatellites])

  const observingCount = satPoints.filter(s => s.tracked && s.observable).length
  const assignedCount = satPoints.filter(s => !s.tracked || !s.observable).length

  function satColor(s: SatMapPoint) {
    if (s.tracked && s.observable) return '#22c55e'  // green — Спостерігається
    return '#4b5563'                                  // gray  — Призначено, поза видимістю
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Карта телескопів</h1>
        <button
          onClick={load}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 rounded-lg transition-colors"
        >
          Оновити
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap text-xs">
        <span className="text-gray-400 font-medium">Телескопи:</span>
        {(['ONLINE', 'OFFLINE', 'WEATHER_BLOCKED'] as const).map(status => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block border-2" style={{ backgroundColor: TELESCOPE_STATUS_COLOR[status], borderColor: TELESCOPE_STATUS_COLOR[status] }} />
            <span className="text-gray-400">{status === 'ONLINE' ? 'Онлайн' : status === 'OFFLINE' ? 'Офлайн' : 'Погода'}</span>
          </div>
        ))}
        <span className="w-px h-4 bg-gray-700" />
        <span className="text-gray-400 font-medium">КА:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-green-500" />
          <span className="text-gray-400">Спостерігається ({observingCount})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-gray-500" />
          <span className="text-gray-400">Призначено, поза видимістю ({assignedCount})</span>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-gray-700" style={{ height: '600px' }}>
        <MapContainer
          center={UKRAINE_CENTER}
          zoom={6}
          style={{ height: '100%', width: '100%', background: '#111827' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />

          {/* Satellite positions */}
          {satPoints.map(sat => {
            const color = satColor(sat)
            const observing = sat.tracked && sat.observable
            return (
              <CircleMarker
                key={sat.satellite_id}
                center={[sat.lat, sat.lng]}
                radius={observing ? 6 : sat.tracked ? 4 : 2}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: observing ? 0.9 : sat.tracked ? 0.5 : 0.2,
                  weight: observing ? 2 : 1,
                }}
              >
                <Popup>
                  <SatellitePopup sat={sat} />
                </Popup>
              </CircleMarker>
            )
          })}

          {/* Telescope markers (on top) */}
          {telescopes.map(tel => (
            <Marker
              key={tel.id}
              position={[tel.latitude, tel.longitude]}
              icon={makeObservatoryIcon(TELESCOPE_STATUS_COLOR[tel.status] || '#6b7280')}
            >
              <Popup>
                <TelescopePopup tel={tel} assignments={assignments} />
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
