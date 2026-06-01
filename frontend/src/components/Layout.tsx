import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { wsService } from '../services/websocket'

const NAV = [
  { path: '/', label: 'Панель' },
  { path: '/map', label: 'Карта' },
  { path: '/assignments', label: 'Розподіл КА' },
  { path: '/globe', label: '3D Глобус' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    wsService.connect()
    const unsub = wsService.onMessage((type) => {
      if (type) setConnected(true)
    })

    // Heartbeat
    const interval = setInterval(() => wsService.ping(), 20000)
    return () => {
      unsub()
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-blue-400">🛰 Satellite Watcher</span>
          <span className="text-xs text-gray-500">Система розподілу КА</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-400">{connected ? 'WS підключено' : 'WS відключено'}</span>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="w-48 bg-gray-900 border-r border-gray-800 p-3 flex flex-col gap-1">
          {NAV.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === path
                  ? 'bg-blue-900 text-blue-200'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <main className="flex-1 p-4 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
