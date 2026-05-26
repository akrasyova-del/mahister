import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Globe from 'react-globe.gl'
import * as satjs from 'satellite.js'
import { getTelescopes, getAssignments, getTleLines } from '../services/api'
import type { Telescope, Assignment } from '../types'

interface TleLine {
  satellite_id: number
  norad_id: number
  name: string
  orbit_type: string
  tle_line1: string
  tle_line2: string
}

interface SatPoint {
  id: number
  name: string
  norad_id: number
  orbit_type: string
  lat: number
  lng: number
  alt: number
  observable: boolean
  assignment?: Assignment
}

interface ArcData {
  startLat: number; startLng: number
  endLat: number; endLng: number
  altitude: number
  color: string[]
  stroke: number
}

interface PathData {
  points: number[][]
  color: () => string
}

const ORBIT_COLOR: Record<string, string> = {
  LEO: '#60a5fa',
  MEO: '#34d399',
  GEO: '#fbbf24',
  HEO: '#f87171',
}

const ORBIT_LABEL: Record<string, string> = {
  LEO: 'НОО',
  MEO: 'СОО',
  GEO: 'ГСО',
  HEO: 'ВЕО',
}

const TEL_STATUS_COLOR: Record<string, string> = {
  ONLINE: '#22c55e',
  WEATHER_BLOCKED: '#eab308',
  OFFLINE: '#ef4444',
  ERROR: '#ef4444',
  PARTIAL: '#f97316',
  MANUAL_MODE: '#3b82f6',
}

const DEG = Math.PI / 180
const TRACKED_STATUSES = new Set(['LOCAL_ASSIGNED', 'TRANSFERRED', 'MANUAL_ASSIGNED'])

function calcPosition(tle1: string, tle2: string, date: Date) {
  try {
    const satrec = satjs.twoline2satrec(tle1, tle2)
    const pv = satjs.propagate(satrec, date)
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null
    const gmst = satjs.gstime(date)
    const geo = satjs.eciToGeodetic(pv.position as satjs.EciVec3<number>, gmst)
    const lat = satjs.degreesLat(geo.latitude)
    const lng = satjs.degreesLong(geo.longitude)
    if (!isFinite(lat) || !isFinite(lng)) return null
    const altKm = Math.max(geo.height, 100)
    const displayAlt = Math.sqrt(altKm / 42164) * 0.9
    return { lat, lng, alt: Math.max(0.02, displayAlt), posEci: pv.position as satjs.EciVec3<number>, gmst }
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
    const look = satjs.ecfToLookAngles(
      { latitude: telLat * DEG, longitude: telLng * DEG, height: telAltM / 1000 },
      posEcf,
    )
    return look.elevation / DEG
  } catch {
    return -90
  }
}

function calcGroundTrack(tle1: string, tle2: string, date: Date): number[][] {
  try {
    const satrec = satjs.twoline2satrec(tle1, tle2)
    const periodMs = (2 * Math.PI / satrec.no) * 60 * 1000
    const points: number[][] = []
    const N = 120
    for (let i = 0; i <= N; i++) {
      const t = new Date(date.getTime() - periodMs / 2 + (i / N) * periodMs)
      const pv = satjs.propagate(satrec, t)
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue
      const gmst = satjs.gstime(t)
      const geo = satjs.eciToGeodetic(pv.position as satjs.EciVec3<number>, gmst)
      points.push([satjs.degreesLat(geo.latitude), satjs.degreesLong(geo.longitude), 0.002])
    }
    return points
  } catch {
    return []
  }
}

export function Globe3DPage() {
  const globeRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })
  const [telescopes, setTelescopes] = useState<Telescope[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [tleLines, setTleLines] = useState<TleLine[]>([])
  const [satPoints, setSatPoints] = useState<SatPoint[]>([])
  const [selectedSat, setSelectedSat] = useState<SatPoint | null>(null)
  const [timeOffset, setTimeOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  // Keep refs for interval callback
  const tleLinesRef = useRef<TleLine[]>([])
  const assignmentsRef = useRef<Assignment[]>([])
  const telescopesRef = useRef<Telescope[]>([])
  useEffect(() => { tleLinesRef.current = tleLines }, [tleLines])
  useEffect(() => { assignmentsRef.current = assignments }, [assignments])
  useEffect(() => { telescopesRef.current = telescopes }, [telescopes])

  // Responsive resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const e = entries[0]
      if (e) setDims({ w: e.contentRect.width, h: e.contentRect.height })
    })
    obs.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => obs.disconnect()
  }, [])

  // Center on Ukraine once globe is ready
  useEffect(() => {
    if (!loading && globeRef.current) {
      globeRef.current.pointOfView({ lat: 49, lng: 32, altitude: 2.5 }, 1500)
    }
  }, [loading])

  // Load static data once
  useEffect(() => {
    Promise.all([getTelescopes(), getAssignments(), getTleLines()])
      .then(([tels, asgns, tles]) => {
        setTelescopes(tels)
        setAssignments(asgns)
        setTleLines(tles)
        tleLinesRef.current = tles
        assignmentsRef.current = asgns
      })
      .finally(() => setLoading(false))
  }, [])

  // Recalculate satellite positions and observability
  const updatePositions = useCallback(() => {
    const date = new Date(Date.now() + timeOffset * 3600 * 1000)
    const pts: SatPoint[] = []
    for (const tle of tleLinesRef.current) {
      const pos = calcPosition(tle.tle_line1, tle.tle_line2, date)
      if (!pos) continue
      const assignment = assignmentsRef.current.find(a => a.satellite_id === tle.satellite_id)

      let observable = false
      if (assignment && TRACKED_STATUSES.has(assignment.status) && assignment.assigned_telescope_id != null) {
        const tel = telescopesRef.current.find(t => t.id === assignment.assigned_telescope_id)
        if (tel && tel.status !== 'OFFLINE' && tel.status !== 'ERROR') {
          const elev = getElevationDeg(pos.posEci, pos.gmst, tel.latitude, tel.longitude, tel.altitude_m)
          observable = elev >= tel.min_elevation_deg
        }
      }

      pts.push({ id: tle.satellite_id, name: tle.name, norad_id: tle.norad_id, orbit_type: tle.orbit_type, lat: pos.lat, lng: pos.lng, alt: pos.alt, observable, assignment })
    }
    setSatPoints(pts)
  }, [timeOffset])

  useEffect(() => {
    if (!tleLines.length) return
    updatePositions()
    const id = setInterval(updatePositions, 5000)
    return () => clearInterval(id)
  }, [updatePositions, tleLines])

  const ARC_ALTITUDE: Record<string, number> = { LEO: 0.3, MEO: 0.5, GEO: 0.7, HEO: 0.45 }

  // Arcs: only for satellites currently observable from their assigned telescope
  const arcs = useMemo<ArcData[]>(() => {
    return satPoints.flatMap(s => {
      if (!s.observable || !s.assignment || !TRACKED_STATUSES.has(s.assignment.status)) return []
      const tel = telescopes.find(t => t.id === s.assignment!.assigned_telescope_id)
      if (!tel) return []
      const sel = selectedSat?.id === s.id
      return [{
        startLat: tel.latitude, startLng: tel.longitude,
        endLat: s.lat, endLng: s.lng,
        altitude: ARC_ALTITUDE[s.orbit_type] ?? 0.3,
        color: [
          ORBIT_COLOR[s.orbit_type] + (sel ? 'ee' : '55'),
          ORBIT_COLOR[s.orbit_type] + (sel ? 'aa' : '22'),
        ],
        stroke: sel ? 1.5 : 0.5,
      }]
    })
  }, [satPoints, telescopes, selectedSat])

  // Ground track for selected satellite
  const groundTracks = useMemo<PathData[]>(() => {
    if (!selectedSat) return []
    const tle = tleLines.find(t => t.satellite_id === selectedSat.id)
    if (!tle) return []
    const date = new Date(Date.now() + timeOffset * 3600 * 1000)
    const pts = calcGroundTrack(tle.tle_line1, tle.tle_line2, date)
    if (!pts.length) return []
    const orbitColor = ORBIT_COLOR[selectedSat.orbit_type]
    return [{ points: pts, color: () => orbitColor }]
  }, [selectedSat, tleLines, timeOffset])

  // Telescope rings
  const telRings = useMemo(() =>
    telescopes.map(t => ({
      lat: t.latitude, lng: t.longitude,
      maxR: 4,
      propagationSpeed: 2,
      repeatPeriod: 1500,
      color: () => TEL_STATUS_COLOR[t.status] ?? '#ffffff',
    }))
  , [telescopes])

  // Telescope HTML labels (supports Cyrillic)
  const telHtmlLabels = useMemo(() =>
    telescopes.map(t => ({
      lat: t.latitude,
      lng: t.longitude,
      alt: 0.025,
      name: t.name.replace(' оптичний засіб', ''),
      color: TEL_STATUS_COLOR[t.status] ?? '#ffffff',
    }))
  , [telescopes])

  const currentDate = useMemo(() => {
    const d = new Date(Date.now() + timeOffset * 3600 * 1000)
    return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }, [timeOffset])

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-5">
          <h1 className="text-base font-bold text-white">3D Глобус</h1>
          <div className="flex items-center gap-3 text-xs">
            {Object.entries(ORBIT_COLOR).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="text-gray-400">{ORBIT_LABEL[type]}</span>
              </span>
            ))}
            <span className="w-px h-3 bg-gray-700" />
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-gray-400">Телескоп</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-px" style={{ background: 'linear-gradient(90deg, #60a5fa, transparent)' }} />
              <span className="text-gray-400">Призначення</span>
            </span>
          </div>
        </div>
        <span className="text-xs text-gray-500">{satPoints.length} КА · {currentDate}</span>
      </div>

      {/* Globe + info panel */}
      <div className="flex flex-1 min-h-0">
        <div ref={containerRef} className="flex-1 relative bg-black overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60">
              <span className="text-gray-300 text-sm">Завантаження даних...</span>
            </div>
          )}
          <Globe
            ref={globeRef}
            width={dims.w}
            height={dims.h}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            atmosphereColor="#3b82f6"
            atmosphereAltitude={0.18}
            // Satellite points
            pointsData={satPoints}
            pointLat="lat"
            pointLng="lng"
            pointAltitude="alt"
            pointColor={(d: object) => {
              const s = d as SatPoint
              return selectedSat?.id === s.id ? '#ffffff' : ORBIT_COLOR[s.orbit_type] ?? '#60a5fa'
            }}
            pointRadius={(d: object) => (d as SatPoint).id === selectedSat?.id ? 0.55 : 0.28}
            pointLabel={(d: object) => {
              const s = d as SatPoint
              return `<div style="background:#111827;color:#f9fafb;padding:5px 9px;border-radius:6px;font-size:12px;border:1px solid #374151;pointer-events:none;max-width:220px">
                <div style="font-weight:600;margin-bottom:2px">${s.name}</div>
                <div style="color:#9ca3af;font-size:11px">NORAD ${s.norad_id} · ${s.orbit_type}</div>
                ${s.assignment ? `<div style="color:#93c5fd;font-size:11px;margin-top:2px">→ ${s.assignment.assigned_telescope_name ?? '—'}</div>` : ''}
              </div>`
            }}
            onPointClick={(d: object) => {
              const s = d as SatPoint
              setSelectedSat(prev => prev?.id === s.id ? null : s)
            }}
            // Arcs (assignments)
            arcsData={arcs}
            arcStartLat="startLat"
            arcStartLng="startLng"
            arcEndLat="endLat"
            arcEndLng="endLng"
            arcAltitude="altitude"
            arcColor="color"
            arcStroke="stroke"
            arcDashLength={0.35}
            arcDashGap={0.2}
            arcDashAnimateTime={2500}
            // Ground track
            pathsData={groundTracks}
            pathPoints="points"
            pathPointLat={(p: object) => (p as number[])[0]}
            pathPointLng={(p: object) => (p as number[])[1]}
            pathPointAlt={(p: object) => (p as number[])[2]}
            pathColor="color"
            pathStroke={1.5}
            pathDashLength={0.04}
            pathDashGap={0.02}
            pathDashAnimateTime={10000}
            // Telescope rings
            ringsData={telRings}
            ringLat="lat"
            ringLng="lng"
            ringMaxRadius="maxR"
            ringPropagationSpeed="propagationSpeed"
            ringRepeatPeriod="repeatPeriod"
            ringColor="color"
            // Telescope HTML labels (renders Cyrillic correctly)
            htmlElementsData={telHtmlLabels}
            htmlLat="lat"
            htmlLng="lng"
            htmlAltitude="alt"
            htmlElement={(d: object) => {
              const t = d as { name: string; color: string }
              const el = document.createElement('div')
              el.textContent = t.name
              el.style.cssText = [
                `color:${t.color}`,
                'font-size:11px',
                'font-weight:700',
                'font-family:system-ui,sans-serif',
                'text-shadow:0 0 4px #000,0 0 8px #000,0 1px 2px #000',
                'pointer-events:none',
                'white-space:nowrap',
                'letter-spacing:0.3px',
              ].join(';')
              return el
            }}
          />
        </div>

        {/* Info panel */}
        <div className="w-60 bg-gray-900 border-l border-gray-700 flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {selectedSat ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Вибраний КА</span>
                  <button
                    onClick={() => setSelectedSat(null)}
                    className="text-gray-600 hover:text-gray-300 text-sm leading-none"
                  >✕</button>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-semibold text-white leading-snug">{selectedSat.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">NORAD {selectedSat.norad_id}</div>
                  </div>
                  <span
                    className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      background: ORBIT_COLOR[selectedSat.orbit_type] + '22',
                      color: ORBIT_COLOR[selectedSat.orbit_type],
                      border: `1px solid ${ORBIT_COLOR[selectedSat.orbit_type]}44`,
                    }}
                  >
                    {selectedSat.orbit_type} · {ORBIT_LABEL[selectedSat.orbit_type]}
                  </span>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs pt-1">
                    <span className="text-gray-500">Широта</span>
                    <span className="text-white text-right">{selectedSat.lat.toFixed(2)}°</span>
                    <span className="text-gray-500">Довгота</span>
                    <span className="text-white text-right">{selectedSat.lng.toFixed(2)}°</span>
                  </div>
                  {selectedSat.assignment && (
                    <div className="pt-2 border-t border-gray-800 space-y-1 text-xs">
                      <div className="text-gray-500">Призначений телескоп</div>
                      <div className="text-blue-300">{selectedSat.assignment.assigned_telescope_name ?? '—'}</div>
                      <div className={selectedSat.observable ? 'text-green-400' : 'text-gray-500'}>
                        {selectedSat.observable ? '● Спостерігається' : '○ Призначено, поза видимістю'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">🛰️</div>
                <div className="text-xs text-gray-500">Натисніть на точку<br />для деталей КА</div>
              </div>
            )}
          </div>

          {/* Telescope list */}
          <div className="border-t border-gray-700 p-3 space-y-2 shrink-0">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Телескопи</div>
            {telescopes.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: TEL_STATUS_COLOR[t.status] ?? '#6b7280' }}
                />
                <span className="text-gray-300 truncate flex-1">
                  {t.name.replace(' оптичний засіб', '')}
                </span>
                <span className="text-gray-500 shrink-0">
                  {t.status === 'ONLINE' ? 'Онл' : t.status === 'WEATHER_BLOCKED' ? 'Пог' : 'Офл'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Time slider */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-gray-900 border-t border-gray-700">
        <span className="text-xs text-gray-500 w-14 text-right shrink-0">−24 год</span>
        <input
          type="range"
          min={-24}
          max={24}
          step={0.25}
          value={timeOffset}
          onChange={e => setTimeOffset(Number(e.target.value))}
          className="flex-1 accent-blue-500 cursor-pointer"
        />
        <span className="text-xs text-gray-500 w-14 shrink-0">+24 год</span>
        <span className="text-xs font-mono text-blue-400 w-20 text-center shrink-0">
          {timeOffset === 0 ? 'Зараз' : `${timeOffset > 0 ? '+' : ''}${timeOffset.toFixed(2)} год`}
        </span>
        <button
          onClick={() => setTimeOffset(0)}
          className="text-xs text-gray-500 hover:text-gray-200 transition-colors shrink-0"
          title="Скинути до поточного часу"
        >↺</button>
      </div>
    </div>
  )
}
