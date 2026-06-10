import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getSatellites,
  getCatalog,
  syncCatalog,
  importFromCatalog,
  updateSatelliteTracked,
  updateSatelliteCategory,
} from '../services/api'
import { wsService } from '../services/websocket'
import { Spinner } from '../components/Spinner'
import { CATEGORIES, UNCATEGORIZED_LABEL } from '../constants'
import type { Satellite, CatalogEntry } from '../types'

type Tab = 'tracked' | 'browse'

export function CatalogPage() {
  const [tab, setTab] = useState<Tab>('tracked')
  const [satellites, setSatellites] = useState<Satellite[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [hideTracked, setHideTracked] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importCategory, setImportCategory] = useState('')

  const loadTracked = useCallback(async () => {
    setSatellites(await getSatellites({ include_untracked: true }))
  }, [])

  const loadCatalog = useCallback(async () => {
    setCatalog(await getCatalog({ search: search || undefined, hide_tracked: hideTracked }))
  }, [search, hideTracked])

  useEffect(() => {
    loadTracked()
    const unsub = wsService.onMessage((type) => {
      if (['assignments_updated', 'catalog_imported'].includes(type)) loadTracked()
    })
    return unsub
  }, [loadTracked])

  useEffect(() => {
    if (tab === 'browse') loadCatalog()
  }, [tab, loadCatalog])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncCatalog()
      await loadCatalog()
    } finally {
      setSyncing(false)
    }
  }

  const toggleSelected = (noradId: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(noradId)) next.delete(noradId)
      else next.add(noradId)
      return next
    })
  }

  const handleImport = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      await importFromCatalog([...selected], importCategory || null)
      setSelected(new Set())
      await loadCatalog()
      await loadTracked()
    } finally {
      setLoading(false)
    }
  }

  const handleToggleTracked = async (s: Satellite, tracked: boolean) => {
    await updateSatelliteTracked(s.norad_id, tracked)
    setSatellites(prev => prev.map(x => x.norad_id === s.norad_id ? { ...x, active: tracked } : x))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Каталог КА</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('tracked')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              tab === 'tracked' ? 'bg-blue-800 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Мої супутники ({satellites.filter(s => s.active).length})
          </button>
          <button
            onClick={() => setTab('browse')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              tab === 'browse' ? 'bg-blue-800 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Каталог Space-Track
          </button>
        </div>
      </div>

      {tab === 'tracked' && <TrackedTab satellites={satellites} onToggleTracked={handleToggleTracked} />}

      {tab === 'browse' && (
        <div className="space-y-3">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Пошук за назвою або NORAD ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 w-64"
            />
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={hideTracked}
                onChange={e => setHideTracked(e.target.checked)}
                className="rounded"
              />
              Сховати вже відстежувані
            </label>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {syncing && <Spinner />} {syncing ? 'Синхронізація...' : '⟳ Синхронізувати з Space-Track'}
            </button>
            <span className="text-xs text-gray-500">{catalog.length} об'єктів</span>
          </div>

          {selected.size > 0 && (
            <div className="bg-gray-900 border border-blue-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-300">Обрано: {selected.size}</span>
              <select
                value={importCategory}
                onChange={e => setImportCategory(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
              >
                <option value="">{UNCATEGORIZED_LABEL}</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={handleImport}
                disabled={loading}
                className="px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {loading && <Spinner />} + Додати до спостереження
              </button>
            </div>
          )}

          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2 text-left">Назва</th>
                    <th className="px-3 py-2 text-left">NORAD</th>
                    <th className="px-3 py-2 text-left">Позначення</th>
                    <th className="px-3 py-2 text-left">Орбіта</th>
                    <th className="px-3 py-2 text-left">Період, хв</th>
                    <th className="px-3 py-2 text-left">Запуск</th>
                    <th className="px-3 py-2 text-left">Відстежується</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {catalog.map(c => (
                    <tr key={c.norad_id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(c.norad_id)}
                          disabled={c.tracked}
                          onChange={() => toggleSelected(c.norad_id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-white max-w-[240px] truncate">{c.name}</td>
                      <td className="px-3 py-2 font-mono text-gray-300">{c.norad_id}</td>
                      <td className="px-3 py-2 font-mono text-gray-400 text-xs">{c.international_designator}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">{c.orbit_type}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">{c.period_min != null ? c.period_min.toFixed(1) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{c.launch_date || '—'}</td>
                      <td className="px-3 py-2">
                        {c.tracked
                          ? <span className="text-green-400 text-xs font-medium">✓ так</span>
                          : <span className="text-gray-600 text-xs">ні</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {catalog.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                Каталог порожній. Натисніть «Синхронізувати з Space-Track».
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TrackedTab({
  satellites,
  onToggleTracked,
}: {
  satellites: Satellite[]
  onToggleTracked: (s: Satellite, tracked: boolean) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [showUntracked, setShowUntracked] = useState(true)

  const filtered = satellites.filter(s => {
    if (!showUntracked && !s.active) return false
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !String(s.norad_id).includes(search)) return false
    return true
  })

  return (
    <div className="space-y-3">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Пошук за назвою або NORAD ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 w-64"
        />
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showUntracked}
            onChange={e => setShowUntracked(e.target.checked)}
            className="rounded"
          />
          Показувати зняті зі спостереження
        </label>
        <span className="text-xs text-gray-500">{filtered.length} з {satellites.length}</span>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Відстежується</th>
                <th className="px-3 py-2 text-left">КА</th>
                <th className="px-3 py-2 text-left">NORAD</th>
                <th className="px-3 py-2 text-left">Категорія</th>
                <th className="px-3 py-2 text-left">Орбіта</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(s => (
                <tr key={s.id} className={`hover:bg-gray-800/50 transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={e => onToggleTracked(s, e.target.checked)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-[200px] truncate">
                    <Link to={`/satellites/${s.norad_id}`} className="text-blue-400 hover:text-blue-300">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-400">{s.norad_id}</td>
                  <td className="px-3 py-2 text-gray-300 text-xs max-w-[200px]">
                    <CategoryEditor satellite={s} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300">{s.orbit_type}</span>
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

function CategoryEditor({ satellite }: { satellite: Satellite }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(satellite.category ?? '')
  const [current, setCurrent] = useState(satellite.category)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const category = value.trim() || null
      await updateSatelliteCategory(satellite.norad_id, category)
      setCurrent(category)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <select
          value={value}
          onChange={e => setValue(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200 max-w-[140px]"
          autoFocus
        >
          <option value="">{UNCATEGORIZED_LABEL}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={save}
          disabled={saving}
          className="px-1.5 py-0.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 flex items-center"
        >
          {saving ? <Spinner className="h-3 w-3" /> : '✓'}
        </button>
        <button
          onClick={() => { setValue(current ?? ''); setEditing(false) }}
          className="px-1.5 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={current ? 'truncate' : 'text-gray-500 italic'} title={current || UNCATEGORIZED_LABEL}>
        {current || UNCATEGORIZED_LABEL}
      </span>
      <button
        onClick={() => setEditing(true)}
        className="text-gray-500 hover:text-gray-300 text-xs px-1 py-0 rounded border border-gray-700 hover:border-gray-500 shrink-0"
      >
        ✎
      </button>
    </div>
  )
}
