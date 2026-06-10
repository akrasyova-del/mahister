import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSatellite, updateSatellitePriority, updateSatelliteCategory, getTelescopes, manualAssign } from '../services/api'
import { StatusBadge } from '../components/StatusBadge'
import { CATEGORIES, UNCATEGORIZED_LABEL } from '../constants'
import type { Satellite, Telescope } from '../types'
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
  const [editingPriority, setEditingPriority] = useState(false)
  const [priorityInput, setPriorityInput] = useState('')
  const [savingPriority, setSavingPriority] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)
  const [categoryInput, setCategoryInput] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [telescopes, setTelescopes] = useState<Telescope[]>([])
  const [editingTelescope, setEditingTelescope] = useState(false)
  const [telescopeInput, setTelescopeInput] = useState('')
  const [savingTelescope, setSavingTelescope] = useState(false)

  useEffect(() => {
    if (!noradId) return
    getSatellite(parseInt(noradId))
      .then(s => setSatellite(s as SatelliteDetail))
      .catch(() => setNotFound(true))
  }, [noradId])

  useEffect(() => {
    getTelescopes().then(setTelescopes)
  }, [])

  const startEditPriority = () => {
    setPriorityInput(String(satellite?.priority ?? ''))
    setEditingPriority(true)
  }

  const savePriority = async () => {
    if (!satellite) return
    const p = parseInt(priorityInput)
    if (isNaN(p) || p < 1) { setEditingPriority(false); return }
    setSavingPriority(true)
    try {
      await updateSatellitePriority(satellite.norad_id, p)
      setSatellite({ ...satellite, priority: p })
    } finally {
      setSavingPriority(false)
      setEditingPriority(false)
    }
  }

  const startEditCategory = () => {
    setCategoryInput(satellite?.category ?? '')
    setEditingCategory(true)
  }

  const saveCategory = async () => {
    if (!satellite) return
    setSavingCategory(true)
    try {
      const category = categoryInput.trim() || null
      await updateSatelliteCategory(satellite.norad_id, category)
      setSatellite({ ...satellite, category })
    } finally {
      setSavingCategory(false)
      setEditingCategory(false)
    }
  }

  const startEditTelescope = () => {
    setTelescopeInput(satellite?.assigned_telescope_id ? String(satellite.assigned_telescope_id) : '')
    setEditingTelescope(true)
  }

  const saveTelescope = async () => {
    if (!satellite) return
    const telescopeId = parseInt(telescopeInput)
    if (isNaN(telescopeId)) { setEditingTelescope(false); return }
    setSavingTelescope(true)
    try {
      const updated = await manualAssign(satellite.id, telescopeId)
      setSatellite({
        ...satellite,
        assigned_telescope_id: updated.assigned_telescope_id,
        assigned_telescope_name: updated.assigned_telescope_name,
        assignment_status: updated.status,
        assignment_reason: updated.reason,
        assignment_score: updated.score,
        priority_type: updated.priority_type,
      })
    } finally {
      setSavingTelescope(false)
      setEditingTelescope(false)
    }
  }

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
            ['Тип орбіти', satellite.orbit_type],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="text-white font-medium">{String(value)}</span>
            </div>
          ))}
          {/* Category — editable, nullable */}
          <div className="flex justify-between text-sm items-center">
            <span className="text-gray-400">Категорія</span>
            {editingCategory ? (
              <div className="flex items-center gap-1">
                <select
                  value={categoryInput}
                  onChange={e => setCategoryInput(e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm"
                  autoFocus
                >
                  <option value="">{UNCATEGORIZED_LABEL}</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={saveCategory}
                  disabled={savingCategory}
                  className="px-2 py-0.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
                >
                  ✓
                </button>
                <button
                  onClick={() => setEditingCategory(false)}
                  className="px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className={satellite.category ? 'text-white font-medium' : 'text-gray-500 italic'}>
                  {satellite.category || UNCATEGORIZED_LABEL}
                </span>
                <button
                  onClick={startEditCategory}
                  className="text-gray-500 hover:text-gray-300 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
                >
                  ✎
                </button>
              </div>
            )}
          </div>
          {/* Priority — editable */}
          <div className="flex justify-between text-sm items-center">
            <span className="text-gray-400">Пріоритет</span>
            {editingPriority ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={priorityInput}
                  onChange={e => setPriorityInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePriority(); if (e.key === 'Escape') setEditingPriority(false) }}
                  className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm text-right"
                  autoFocus
                />
                <button
                  onClick={savePriority}
                  disabled={savingPriority}
                  className="px-2 py-0.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
                >
                  ✓
                </button>
                <button
                  onClick={() => setEditingPriority(false)}
                  className="px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{satellite.priority}</span>
                <button
                  onClick={startEditPriority}
                  className="text-gray-500 hover:text-gray-300 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
                >
                  ✎
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wide">Призначення</h2>
          {[
            ['Домашній телескоп', satellite.home_telescope_name || '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm items-start gap-3">
              <span className="text-gray-400 shrink-0">{label}</span>
              <span className="text-white text-right">{String(value)}</span>
            </div>
          ))}

          {/* Current telescope — editable, manual (re)assignment */}
          <div className="flex justify-between text-sm items-center gap-3">
            <span className="text-gray-400 shrink-0">Поточний телескоп</span>
            {editingTelescope ? (
              <div className="flex items-center gap-1">
                <select
                  value={telescopeInput}
                  onChange={e => setTelescopeInput(e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm"
                  autoFocus
                >
                  <option value="">—</option>
                  {telescopes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  onClick={saveTelescope}
                  disabled={savingTelescope || !telescopeInput}
                  className="px-2 py-0.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
                >
                  ✓
                </button>
                <button
                  onClick={() => setEditingTelescope(false)}
                  className="px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{satellite.assigned_telescope_name || '—'}</span>
                <button
                  onClick={startEditTelescope}
                  className="text-gray-500 hover:text-gray-300 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
                >
                  ✎
                </button>
              </div>
            )}
          </div>

          {[
            ['Тип пріоритету', satellite.priority_type || '—'],
            ['Причина', satellite.assignment_reason || '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm items-start gap-3">
              <span className="text-gray-400 shrink-0">{label}</span>
              <span className="text-white text-right">{String(value)}</span>
            </div>
          ))}

          <div className="flex justify-between text-sm items-start gap-3">
            <span className="text-gray-400 shrink-0">Статус призначення</span>
            {satellite.assignment_status ? (
              <StatusBadge status={satellite.assignment_status} type="assignment" />
            ) : (
              <span className="text-white text-right">—</span>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-gray-200 text-sm uppercase tracking-wide">TLE</h2>
          {[
            ['Статус', satellite.tle_status],
            ['Джерело', satellite.tle_source || '—'],
            ['Вік (год)', satellite.tle_age_hours != null ? satellite.tle_age_hours.toFixed(1) : '—'],
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
