import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getDashboardState, triggerWeatherUpdate, triggerTleUpdate, recalculateAssignments } from '../services/api'
import { wsService } from '../services/websocket'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import type { DashboardState, TelescopeCard } from '../types'
import { format } from 'date-fns'

function WeatherIcon({ code }: { code: number | null }) {
  if (code === null) return <span>—</span>
  if (code === 0) return <span title="Ясно">☀️</span>
  if (code <= 3) return <span title="Хмарно">⛅</span>
  if (code <= 49) return <span title="Туман">🌫️</span>
  if (code <= 69) return <span title="Дощ">🌧️</span>
  if (code <= 79) return <span title="Сніг">❄️</span>
  if (code <= 99) return <span title="Гроза">⛈️</span>
  return <span>🌥️</span>
}

function TelescopeCard({ tel }: { tel: TelescopeCard }) {
  return (
    <Link
      to={`/telescopes/${tel.code}`}
      className="bg-gray-900 border border-gray-700 rounded-xl p-4 hover:border-blue-600 transition-colors block"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white text-sm">{tel.name}</h3>
          <p className="text-xs text-gray-400">{tel.region}</p>
        </div>
        <StatusBadge status={tel.status} type="telescope" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{tel.local_satellites}</div>
          <div className="text-xs text-gray-400">Власні</div>
        </div>
        <div className={`rounded-lg p-2 ${tel.transferred_satellites > 0 ? 'bg-amber-900/50' : 'bg-gray-800'}`}>
          <div className={`text-lg font-bold ${tel.transferred_satellites > 0 ? 'text-amber-400' : 'text-white'}`}>
            {tel.transferred_satellites}
          </div>
          <div className="text-xs text-gray-400">Перенаправлені</div>
        </div>
        <div className={`rounded-lg p-2 ${tel.no_visibility_satellites > 0 ? 'bg-red-900/30' : 'bg-gray-800'}`}>
          <div className={`text-lg font-bold ${tel.no_visibility_satellites > 0 ? 'text-red-400' : 'text-white'}`}>
            {tel.no_visibility_satellites}
          </div>
          <div className="text-xs text-gray-400">Без видим.</div>
        </div>
      </div>

      {tel.weather && (
        <div className="text-xs text-gray-400 flex items-center gap-3 flex-wrap">
          <span><WeatherIcon code={tel.weather.weather_code} /></span>
          {tel.weather.temperature != null && <span>🌡️ {tel.weather.temperature}°C</span>}
          {tel.weather.cloud_cover != null && <span>☁️ {tel.weather.cloud_cover}%</span>}
          {tel.weather.wind_speed != null && <span>💨 {tel.weather.wind_speed} м/с</span>}
        </div>
      )}

      <div className="mt-2 text-xs text-gray-600">
        {tel.last_weather_update && (
          <span>Погода: {format(new Date(tel.last_weather_update), 'HH:mm')}</span>
        )}
      </div>
    </Link>
  )
}

type DashboardAction = 'weather' | 'tle' | 'recalculate' | null

export function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null)
  const [activeAction, setActiveAction] = useState<DashboardAction>(null)
  const fetching = useRef(false)

  const load = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const data = await getDashboardState()
      setState(data)
    } catch {
      // backend unavailable — silently skip
    } finally {
      fetching.current = false
    }
  }, [])

  useEffect(() => {
    load()
    const unsub = wsService.onMessage((type) => {
      if (['weather_updated', 'tle_updated', 'assignments_updated', 'telescope_status_changed'].includes(type)) {
        load()
      }
    })
    const interval = setInterval(load, 30000)
    return () => { unsub(); clearInterval(interval) }
  }, [load])

  const handleWeatherUpdate = async () => {
    setActiveAction('weather')
    try {
      await triggerWeatherUpdate()
      await load()
    } finally {
      setActiveAction(null)
    }
  }

  const handleTleUpdate = async () => {
    setActiveAction('tle')
    try {
      await triggerTleUpdate()
      await load()
    } finally {
      setActiveAction(null)
    }
  }

  const handleRecalculate = async () => {
    setActiveAction('recalculate')
    try {
      await recalculateAssignments()
      await load()
    } finally {
      setActiveAction(null)
    }
  }

  if (!state) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Завантаження...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Панель управління</h1>
        <div className="flex gap-2">
          <button
            onClick={handleWeatherUpdate}
            disabled={activeAction !== null}
            className="px-3 py-1.5 bg-sky-800 hover:bg-sky-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {activeAction === 'weather' ? <Spinner /> : '🌤'} Оновити погоду
          </button>
          <button
            onClick={handleTleUpdate}
            disabled={activeAction !== null}
            className="px-3 py-1.5 bg-indigo-800 hover:bg-indigo-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {activeAction === 'tle' ? <Spinner /> : '📡'} Оновити TLE
          </button>
          <button
            onClick={handleRecalculate}
            disabled={activeAction !== null}
            className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {activeAction === 'recalculate' ? <Spinner /> : '⚡'} Перерахувати
          </button>
        </div>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Всього КА', value: state.total_satellites, color: 'text-white' },
          { label: 'Онлайн телескопів', value: state.online_telescopes, color: 'text-green-400' },
          { label: 'Перенаправлених КА', value: state.transferred_total, color: state.transferred_total > 0 ? 'text-amber-400' : 'text-white' },
          { label: 'TLE відсутній', value: state.tle_missing, color: state.tle_missing > 0 ? 'text-red-400' : 'text-white' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
            <div className={`text-3xl font-bold ${color}`}>{value}</div>
            <div className="text-sm text-gray-400 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Telescope cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-3">Телескопи</h2>
        <div className="grid grid-cols-2 gap-4">
          {state.telescopes.map(tel => (
            <TelescopeCard key={tel.id} tel={tel} />
          ))}
        </div>
      </div>

      {/* Event log */}
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-3">Останні події</h2>
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          {state.recent_events.length === 0 ? (
            <div className="p-4 text-center text-gray-500">Немає подій</div>
          ) : (
            <div className="divide-y divide-gray-800 max-h-80 overflow-y-auto">
              {state.recent_events.map(e => (
                <div key={e.id} className="px-4 py-2 flex items-start gap-3 text-sm">
                  <span className={`text-xs font-mono mt-0.5 ${
                    e.level === 'ERROR' ? 'text-red-400'
                    : e.level === 'WARNING' ? 'text-yellow-400'
                    : 'text-gray-500'
                  }`}>
                    {e.timestamp ? format(new Date(e.timestamp), 'HH:mm:ss') : '—'}
                  </span>
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    e.level === 'ERROR' ? 'bg-red-500'
                    : e.level === 'WARNING' ? 'bg-yellow-500'
                    : 'bg-green-500'
                  }`} />
                  <span className="text-gray-300">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
