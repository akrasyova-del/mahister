import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getAssignments, getTelescopes, recalculateAssignments, manualAssign } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import { wsService } from '../services/websocket'
import type { Assignment, Telescope } from '../types'
import { format } from 'date-fns'

const CATEGORIES = [
  'Оптико-електронна розвідка',
  'Радіолокаційна розвідка',
  'Радіотехнічна розвідка',
  'Оптико-електронне спостереження',
  'Метеорологічні',
  'Навігаційні',
]

const ORBIT_TYPES = ['LEO', 'MEO', 'GEO', 'HEO']

export function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [telescopes, setTelescopes] = useState<Telescope[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [filterTelescope, setFilterTelescope] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [transferredOnly, setTransferredOnly] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([
      getAssignments({ transferred_only: transferredOnly || undefined }),
      getTelescopes(),
    ])
    setAssignments(a)
    setTelescopes(t)
  }, [transferredOnly])

  useEffect(() => {
    load()
    const unsub = wsService.onMessage((type) => {
      if (['assignments_updated', 'telescope_status_changed'].includes(type)) load()
    })
    return unsub
  }, [load])

  const handleRecalculate = async () => {
    setLoading(true)
    await recalculateAssignments()
    await load()
    setLoading(false)
  }

  const filtered = assignments.filter(a => {
    if (filterTelescope && a.assigned_telescope_id !== parseInt(filterTelescope)) return false
    if (filterCategory && a.category !== filterCategory) return false
    if (filterStatus && a.status !== filterStatus) return false
    if (search && !a.satellite_name?.toLowerCase().includes(search.toLowerCase()) && !String(a.norad_id).includes(search)) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Розподіл КА</h1>
        <button
          onClick={handleRecalculate}
          disabled={loading}
          className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
        >
          ⚡ Перерахувати
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <input
          type="text"
          placeholder="Пошук КА..."
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
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Всі статуси</option>
          <option value="LOCAL_ASSIGNED">Локальний</option>
          <option value="TRANSFERRED">Перенаправлений</option>
          <option value="TLE_MISSING">TLE відсутній</option>
          <option value="NO_AVAILABLE_TELESCOPE">Немає телескопа</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={transferredOnly}
            onChange={e => setTransferredOnly(e.target.checked)}
            className="rounded"
          />
          Тільки перенаправлені
        </label>
      </div>

      <div className="text-xs text-gray-500">{filtered.length} з {assignments.length} записів</div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">КА</th>
                <th className="px-3 py-2 text-left">NORAD</th>
                <th className="px-3 py-2 text-left">Категорія</th>
                <th className="px-3 py-2 text-left">Орбіта</th>
                <th className="px-3 py-2 text-left">Закріплений за</th>
                <th className="px-3 py-2 text-left">Спостерігає</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Тип</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2 text-left">Наст. проліт</th>
                <th className="px-3 py-2 text-left">Макс. кут</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(a => (
                <tr
                  key={a.id}
                  className={`hover:bg-gray-800/50 transition-colors ${
                    a.priority_type === 'TRANSFERRED' ? 'bg-amber-900/10' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link
                      to={`/satellites/${a.norad_id}`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {a.satellite_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-400">{a.norad_id}</td>
                  <td className="px-3 py-2 text-gray-300 max-w-[140px] truncate">{a.category}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">{a.orbit_type}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{a.home_telescope_name || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {['LOCAL_ASSIGNED', 'TRANSFERRED', 'MANUAL_ASSIGNED'].includes(a.status)
                      ? <span className="text-green-400 font-medium">{a.assigned_telescope_name || '—'}</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={a.status} type="assignment" /></td>
                  <td className="px-3 py-2">
                    {a.priority_type === 'TRANSFERRED' ? (
                      <span className="text-amber-400 text-xs font-semibold">⬆ Пріоритет</span>
                    ) : (
                      <span className="text-gray-500 text-xs">Нормальний</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {a.score != null ? a.score.toFixed(3) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">
                    {a.next_pass_start
                      ? format(new Date(a.next_pass_start), 'dd.MM HH:mm')
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">
                    {a.max_elevation_deg != null ? `${a.max_elevation_deg.toFixed(1)}°` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-500">Записів не знайдено</div>
        )}
      </div>
    </div>
  )
}
