import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSatellite } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import type { Satellite } from '../types'
import { format } from 'date-fns'

interface SatelliteDetail extends Satellite {
  telescopes?: Array<{
    telescope_id: number
    telescope_code: string
    telescope_name: string
    passes: Array<{
      start_time: string | null
      end_time: string | null
      max_elevation_deg: number | null
      duration_sec: number | null
      observable: boolean
    }>
  }>
}

export function SatelliteDetailsPage() {
  const { noradId } = useParams<{ noradId: string }>()
  const [satellite, setSatellite] = useState<SatelliteDetail | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!noradId) return
    getSatellite(parseInt(noradId))
      .then(s => setSatellite(s as SatelliteDetail))
      .catch(() => setNotFound(true))
  }, [noradId])

  if (notFound) return (
    <div className="text-center py-16 text-gray-400">
      <p className="text-2xl mb-2">КА не знайдено</p>
      <Link to="/satellites" className="text-blue-400 hover:underline">← Назад до каталогу</Link>
    </div>
  )

  if (!satellite) return <div className="py-16 text-center text-gray-400">Завантаження...</div>

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/satellites" className="text-gray-500 hover:text-gray-300 text-sm">← КА</Link>
        <h1 className="text-2xl font-bold text-white">{satellite.name}</h1>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wide">Ідентифікація</h2>
          {[
            ['NORAD ID', satellite.norad_id],
            ['Міжнародне позначення', satellite.international_designator],
            ['Категорія', satellite.category],
            ['Тип орбіти', satellite.orbit_type],
            ['Пріоритет', satellite.priority],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="text-white font-medium">{String(value)}</span>
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wide">Призначення</h2>
          {[
            ['Домашній телескоп', satellite.home_telescope_name || '—'],
            ['Поточний телескоп', satellite.assigned_telescope_name || '—'],
            ['Статус призначення', null],
            ['Тип пріоритету', satellite.priority_type || '—'],
            ['Причина', satellite.assignment_reason || '—'],
            ['Score', satellite.assignment_score != null ? satellite.assignment_score.toFixed(3) : '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm items-center">
              <span className="text-gray-400">{label}</span>
              {label === 'Статус призначення' && satellite.assignment_status ? (
                <StatusBadge status={satellite.assignment_status} type="assignment" />
              ) : (
                <span className="text-white text-right max-w-[200px] truncate">{String(value)}</span>
              )}
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wide">TLE</h2>
          {[
            ['Статус', satellite.tle_status],
            ['Джерело', satellite.tle_source || '—'],
            ['Вік (год)', satellite.tle_age_hours != null ? satellite.tle_age_hours.toFixed(1) : '—'],
            ['Епоха', satellite.tle_epoch
              ? format(new Date(satellite.tle_epoch), 'dd.MM.yyyy HH:mm:ss')
              : '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="text-white font-medium">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pass windows per telescope */}
      {satellite.telescopes && satellite.telescopes.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-200 mb-3">Вікна спостереження по телескопах</h2>
          <div className="grid grid-cols-2 gap-4">
            {satellite.telescopes.map(t => (
              <div key={t.telescope_id} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <Link
                    to={`/telescopes/${t.telescope_code}`}
                    className="font-semibold text-blue-400 hover:text-blue-300 text-sm"
                  >
                    {t.telescope_name}
                  </Link>
                  <span className="text-xs text-gray-500">{t.passes.length} вікон</span>
                </div>
                {t.passes.length === 0 ? (
                  <p className="text-xs text-gray-500">Немає вікон за 24–48 год</p>
                ) : (
                  <div className="space-y-2">
                    {t.passes.slice(0, 5).map((p, i) => (
                      <div key={i} className="text-xs bg-gray-800 rounded-lg p-2">
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-300">
                            {p.start_time ? format(new Date(p.start_time), 'dd.MM HH:mm') : '—'}
                          </span>
                          <span className={p.observable ? 'text-green-400' : 'text-red-400'}>
                            {p.observable ? '● Спостережуваний' : '○ Не спостережуваний'}
                          </span>
                        </div>
                        <div className="flex gap-3 text-gray-400">
                          {p.max_elevation_deg != null && <span>Кут: {p.max_elevation_deg.toFixed(1)}°</span>}
                          {p.duration_sec != null && <span>Тривал.: {Math.round(p.duration_sec / 60)} хв</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
