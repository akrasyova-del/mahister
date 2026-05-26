import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSatellites } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import type { Satellite } from '../types'

const ACTIVE_STATUSES = new Set(['LOCAL_ASSIGNED', 'TRANSFERRED', 'MANUAL_ASSIGNED'])

const TLE_STATUS_COLORS: Record<string, string> = {
  FRESH: 'text-green-400',
  AGING: 'text-yellow-400',
  STALE: 'text-red-400',
  TLE_MISSING: 'text-gray-500',
  NO_EPOCH: 'text-gray-400',
}

export function SatellitesPage() {
  const [satellites, setSatellites] = useState<Satellite[]>([])
  const [search, setSearch] = useState('')
  const [filterOrbit, setFilterOrbit] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  useEffect(() => {
    getSatellites().then(setSatellites)
  }, [])

  const categories = [...new Set(satellites.map(s => s.category))]

  const filtered = satellites.filter(s => {
    if (filterOrbit && s.orbit_type !== filterOrbit) return false
    if (filterCategory && s.category !== filterCategory) return false
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !String(s.norad_id).includes(search)) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Каталог КА <span className="text-gray-500 font-normal text-lg">({satellites.length})</span></h1>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Пошук за назвою або NORAD ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 w-64"
        />
        <select
          value={filterOrbit}
          onChange={e => setFilterOrbit(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі орбіти</option>
          {['LEO', 'MEO', 'GEO', 'HEO'].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі категорії</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-gray-500 self-center">{filtered.length} КА</span>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Назва</th>
                <th className="px-3 py-2 text-left">NORAD ID</th>
                <th className="px-3 py-2 text-left">Позначення</th>
                <th className="px-3 py-2 text-left">Категорія</th>
                <th className="px-3 py-2 text-left">Орбіта</th>
                <th className="px-3 py-2 text-left">Статус TLE</th>
                <th className="px-3 py-2 text-left">Вік TLE</th>
                <th className="px-3 py-2 text-left">Закріплений за</th>
                <th className="px-3 py-2 text-left">Спостерігає</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Деталі</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-3 py-2 font-medium text-white max-w-[200px] truncate">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-gray-300">{s.norad_id}</td>
                  <td className="px-3 py-2 font-mono text-gray-400 text-xs">{s.international_designator}</td>
                  <td className="px-3 py-2 text-gray-300 text-xs max-w-[140px] truncate">{s.category}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">{s.orbit_type}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium ${TLE_STATUS_COLORS[s.tle_status] || 'text-gray-400'}`}>
                      {s.tle_status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">
                    {s.tle_age_hours != null ? `${s.tle_age_hours.toFixed(1)} год` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{s.home_telescope_name || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.assignment_status && ACTIVE_STATUSES.has(s.assignment_status)
                      ? <span className="text-green-400 font-medium">{s.assigned_telescope_name || '—'}</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {s.assignment_status && (
                      <StatusBadge status={s.assignment_status} type="assignment" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/satellites/${s.norad_id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs underline"
                    >
                      →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-500">КА не знайдено</div>
        )}
      </div>
    </div>
  )
}
