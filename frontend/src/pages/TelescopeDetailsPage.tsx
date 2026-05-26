import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTelescope, updateTelescopeStatus, recalculateAssignments, getAssignments, updateTelescopeSettings } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import { wsService } from '../services/websocket'
import type { Telescope, Assignment, TelescopeStatus } from '../types'
import { format } from 'date-fns'

export function TelescopeDetailsPage() {
  const { code } = useParams<{ code: string }>()
  const [telescope, setTelescope] = useState<Telescope | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [settings, setSettings] = useState<Record<string, number>>({})

  const load = async () => {
    if (!code) return
    const [tel, assigns] = await Promise.all([
      getTelescope(code),
      getAssignments(),
    ])
    setTelescope(tel)
    setAssignments(assigns)
    setSettings({
      latitude: tel.latitude,
      longitude: tel.longitude,
      altitude_m: tel.altitude_m,
      min_elevation_deg: tel.min_elevation_deg,
      max_cloud_cover_percent: tel.max_cloud_cover_percent,
      max_low_cloud_cover_percent: tel.max_low_cloud_cover_percent,
      max_wind_speed_mps: tel.max_wind_speed_mps,
      min_visibility_km: tel.min_visibility_km,
    })
  }

  useEffect(() => {
    load()
    const unsub = wsService.onMessage((type) => {
      if (['telescope_status_changed', 'assignments_updated', 'weather_updated'].includes(type)) load()
    })
    return unsub
  }, [code])

  const setStatus = async (status: TelescopeStatus) => {
    if (!code) return
    setLoading(true)
    await updateTelescopeStatus(code, status)
    await load()
    setLoading(false)
  }

  const saveSettings = async () => {
    if (!code) return
    setLoading(true)
    await updateTelescopeSettings(code, settings)
    setEditing(false)
    await load()
    setLoading(false)
  }

  const handleRecalculate = async () => {
    setLoading(true)
    await recalculateAssignments()
    await load()
    setLoading(false)
  }

  if (!telescope) return <div className="py-16 text-center text-gray-400">Завантаження...</div>

  const tid = telescope.id
  const observingNow = assignments.filter(a =>
    a.assigned_telescope_id === tid &&
    ['LOCAL_ASSIGNED', 'MANUAL_ASSIGNED'].includes(a.status) &&
    a.priority_type !== 'TRANSFERRED'
  )
  const receivedFromOthers = assignments.filter(a =>
    a.assigned_telescope_id === tid && a.priority_type === 'TRANSFERRED'
  )
  const homeNotObserved = assignments.filter(a =>
    a.home_telescope_id === tid &&
    a.assigned_telescope_id === tid &&
    !['LOCAL_ASSIGNED', 'MANUAL_ASSIGNED'].includes(a.status)
  )
  const transferredAway = assignments.filter(a =>
    a.home_telescope_id === tid && a.assigned_telescope_id !== tid
  )

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm">← Панель</Link>
        <h1 className="text-2xl font-bold text-white">{telescope.name}</h1>
        <StatusBadge status={telescope.status} type="telescope" />
      </div>

      {/* Status controls */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <h2 className="font-semibold text-gray-200 text-sm mb-3">Управління статусом</h2>
        <div className="flex gap-2 flex-wrap">
          {(['ONLINE', 'OFFLINE', 'MANUAL_MODE', 'ERROR'] as TelescopeStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={loading || telescope.status === s}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
                telescope.status === s
                  ? 'bg-blue-900 text-blue-200 border border-blue-600'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={handleRecalculate}
            disabled={loading}
            className="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            ⚡ Перерахувати розподіл
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Info + settings */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-200 text-sm">Параметри</h2>
            <button
              onClick={() => setEditing(!editing)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {editing ? 'Скасувати' : 'Редагувати'}
            </button>
          </div>
          {editing ? (
            <div className="space-y-2">
              {Object.entries(settings).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <label className="text-xs text-gray-400">{key}</label>
                  <input
                    type="number"
                    value={value}
                    step="0.0001"
                    onChange={e => setSettings(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white w-32"
                  />
                </div>
              ))}
              <button
                onClick={saveSettings}
                disabled={loading}
                className="w-full mt-2 px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white text-sm rounded-lg"
              >
                Зберегти
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {[
                ['Регіон', telescope.region],
                ['Координати', `${telescope.latitude.toFixed(4)}, ${telescope.longitude.toFixed(4)}`],
                ['Висота', `${telescope.altitude_m} м`],
                ['Мін. кут', `${telescope.min_elevation_deg}°`],
                ['Макс. хмарність', `${telescope.max_cloud_cover_percent}%`],
                ['Макс. низька хмарність', `${telescope.max_low_cloud_cover_percent}%`],
                ['Макс. вітер', `${telescope.max_wind_speed_mps} м/с`],
                ['Мін. видимість', `${telescope.min_visibility_km} км`],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between text-sm">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weather */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm">Погода</h2>
          {telescope.weather ? (
            <div className="space-y-2">
              {[
                ['Температура', `${telescope.weather.temperature ?? '—'}°C`],
                ['Хмарність', `${telescope.weather.cloud_cover ?? '—'}%`],
                ['Низька хмарність', `${telescope.weather.cloud_cover_low ?? '—'}%`],
                ['Середня хмарність', `${telescope.weather.cloud_cover_mid ?? '—'}%`],
                ['Висока хмарність', `${telescope.weather.cloud_cover_high ?? '—'}%`],
                ['Опади', `${telescope.weather.precipitation ?? '—'} мм`],
                ['Вологість', `${telescope.weather.humidity ?? '—'}%`],
                ['Вітер', `${telescope.weather.wind_speed ?? '—'} м/с`],
                ['Пориви', `${telescope.weather.wind_gusts ?? '—'} м/с`],
                ['Видимість', `${telescope.weather.visibility_km ?? '—'} км`],
                ['Джерело', telescope.weather.source ?? '—'],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between text-sm">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white">{String(value)}</span>
                </div>
              ))}
              {telescope.weather.timestamp && (
                <p className="text-xs text-gray-500 pt-1">
                  Оновлено: {format(new Date(telescope.weather.timestamp), 'dd.MM.yyyy HH:mm')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Дані погоди відсутні</p>
          )}
        </div>
      </div>

      {/* Satellite sections */}
      <div className="grid grid-cols-2 gap-4">
        {/* 1. Observing now (own) */}
        <div className="bg-green-900/15 border border-green-700/40 rounded-xl p-4">
          <h2 className="font-semibold text-green-400 text-sm mb-3">
            Спостерігаються зараз — {observingNow.length}
          </h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {observingNow.length === 0 && <p className="text-gray-600 text-xs">Немає</p>}
            {observingNow.map(a => (
              <Link
                key={a.id}
                to={`/satellites/${a.norad_id}`}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-sm text-gray-200 truncate">{a.satellite_name}</span>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{a.orbit_type}</span>
                  <StatusBadge status={a.status} type="assignment" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 2. Received from other telescopes */}
        <div className="bg-amber-900/15 border border-amber-700/40 rounded-xl p-4">
          <h2 className="font-semibold text-amber-400 text-sm mb-3">
            Прийнято від інших телескопів — {receivedFromOthers.length}
          </h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {receivedFromOthers.length === 0 && <p className="text-gray-600 text-xs">Немає</p>}
            {receivedFromOthers.map(a => (
              <Link
                key={a.id}
                to={`/satellites/${a.norad_id}`}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-sm text-gray-200 truncate">{a.satellite_name}</span>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{a.orbit_type}</span>
                  <span className="text-xs text-gray-500 truncate max-w-[90px]">{a.home_telescope_name}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 3. Home satellites not being observed */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h2 className="font-semibold text-gray-400 text-sm mb-3">
            Закріплені, не спостерігаються — {homeNotObserved.length}
          </h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {homeNotObserved.length === 0 && <p className="text-gray-600 text-xs">Немає</p>}
            {homeNotObserved.map(a => (
              <Link
                key={a.id}
                to={`/satellites/${a.norad_id}`}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-sm text-gray-300 truncate">{a.satellite_name}</span>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{a.orbit_type}</span>
                  <StatusBadge status={a.status} type="assignment" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 4. Transferred away to another telescope */}
        <div className="bg-purple-900/15 border border-purple-700/40 rounded-xl p-4">
          <h2 className="font-semibold text-purple-400 text-sm mb-3">
            Передано іншому телескопу — {transferredAway.length}
          </h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {transferredAway.length === 0 && <p className="text-gray-600 text-xs">Немає</p>}
            {transferredAway.map(a => (
              <Link
                key={a.id}
                to={`/satellites/${a.norad_id}`}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-sm text-gray-300 truncate">{a.satellite_name}</span>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{a.orbit_type}</span>
                  <span className="text-xs text-purple-300 truncate max-w-[100px]">→ {a.assigned_telescope_name}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
