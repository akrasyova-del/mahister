import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getSatellites, getTelescopes, recalculateAssignments } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { wsService } from '../services/websocket'
import { UNCATEGORIZED_LABEL } from '../constants'
import type { Satellite, Telescope } from '../types'

const ACTIVE_STATUSES = new Set(['LOCAL_ASSIGNED', 'TRANSFERRED', 'MANUAL_ASSIGNED'])

const TLE_COLORS: Record<string, string> = {
  FRESH: 'text-green-400',
  AGING: 'text-yellow-400',
  STALE: 'text-red-400',
  TLE_MISSING: 'text-gray-500',
  NO_EPOCH: 'text-gray-400',
}

export function AssignmentsPage() {
  const [satellites, setSatellites] = useState<Satellite[]>([])
  const [telescopes, setTelescopes] = useState<Telescope[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [filterTelescope, setFilterTelescope] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterOrbit, setFilterOrbit] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [transferredOnly, setTransferredOnly] = useState(false)

  const load = useCallback(async () => {
    const [sats, tels] = await Promise.all([getSatellites(), getTelescopes()])
    setSatellites(sats)
    setTelescopes(tels)
  }, [])

  useEffect(() => {
    load()
    const unsub = wsService.onMessage((type) => {
      if (['assignments_updated', 'telescope_status_changed'].includes(type)) load()
    })
    return unsub
  }, [load])

  const handleRecalculate = async () => {
    setLoading(true)
    try {
      await recalculateAssignments()
      await load()
    } finally {
      setLoading(false)
    }
  }

  const categories = [...new Set(satellites.map(s => s.category).filter((c): c is string => !!c))]

  const filtered = satellites.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !String(s.norad_id).includes(search)) return false
    if (filterTelescope && String(s.assigned_telescope_id) !== filterTelescope) return false
    if (filterCategory && s.category !== filterCategory) return false
    if (filterOrbit && s.orbit_type !== filterOrbit) return false
    if (filterStatus && s.assignment_status !== filterStatus) return false
    if (transferredOnly && s.priority_type !== 'TRANSFERRED') return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          Розподіл КА <span className="text-gray-500 font-normal text-lg">({satellites.length})</span>
        </h1>
        <button
          onClick={handleRecalculate}
          disabled={loading}
          className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {loading ? <Spinner /> : '⚡'} Перерахувати
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <input
          type="text"
          placeholder="Пошук КА або NORAD..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 col-span-2 lg:col-span-1"
        />
        <select
          value={filterTelescope}
          onChange={e => setFilterTelescope(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі телескопи</option>
          {telescopes.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі категорії</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterOrbit}
          onChange={e => setFilterOrbit(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі орбіти</option>
          {['LEO', 'MEO', 'GEO', 'HEO'].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі статуси</option>
          <option value="LOCAL_ASSIGNED">Спостерігається</option>
          <option value="TRANSFERRED">Перенаправлений</option>
          <option value="WAITING_VISIBILITY">Поза видимістю</option>
          <option value="NO_AVAILABLE_TELESCOPE">Немає телескопа</option>
          <option value="TLE_MISSING">TLE відсутній</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={transferredOnly}
            onChange={e => setTransferredOnly(e.target.checked)}
            className="rounded"
          />
          Перенаправлені
        </label>
      </div>

      <div className="text-xs text-gray-500">{filtered.length} з {satellites.length} КА</div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">КА</th>
                <th className="px-3 py-2 text-left">NORAD</th>
                <th className="px-3 py-2 text-left">Категорія</th>
                <th className="px-3 py-2 text-left">Орбіта</th>
                <th className="px-3 py-2 text-left">TLE</th>
                <th className="px-3 py-2 text-left">Закріплений за</th>
                <th className="px-3 py-2 text-left">Спостерігає</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Тип</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className={`hover:bg-gray-800/50 transition-colors ${
                    s.priority_type === 'TRANSFERRED' ? 'bg-amber-900/10' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-medium max-w-[200px] truncate">
                    <Link to={`/satellites/${s.norad_id}`} className="text-blue-400 hover:text-blue-300">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-400">{s.norad_id}</td>
                  <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={s.category || UNCATEGORIZED_LABEL}>
                    {s.category
                      ? <span className="text-gray-300">{s.category}</span>
                      : <span className="text-gray-500 italic">{UNCATEGORIZED_LABEL}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">{s.orbit_type}</span>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className={TLE_COLORS[s.tle_status] || 'text-gray-400'}>{s.tle_status}</span>
                    {s.tle_age_hours != null && (
                      <span className="text-gray-600 ml-1">{s.tle_age_hours.toFixed(0)}г</span>
                    )}
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
                    {s.priority_type === 'TRANSFERRED'
                      ? <span className="text-amber-400 text-xs font-semibold">⬆ Пріоритет</span>
                      : <span className="text-gray-600 text-xs">Норм.</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/satellites/${s.norad_id}`} className="text-blue-400 hover:text-blue-300 text-xs">→</Link>
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
