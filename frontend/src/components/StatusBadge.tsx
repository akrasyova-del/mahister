import type { TelescopeStatus, AssignmentStatus } from '../types'

const TELESCOPE_STATUS_CONFIG: Record<TelescopeStatus, { label: string; className: string }> = {
  ONLINE: { label: 'Онлайн', className: 'bg-green-100 text-green-800 border-green-300' },
  OFFLINE: { label: 'Офлайн', className: 'bg-red-100 text-red-800 border-red-300' },
  WEATHER_BLOCKED: { label: 'Погода', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  PARTIAL: { label: 'Частковий', className: 'bg-orange-100 text-orange-800 border-orange-300' },
  MANUAL_MODE: { label: 'Ручний', className: 'bg-blue-100 text-blue-800 border-blue-300' },
  ERROR: { label: 'Помилка', className: 'bg-gray-100 text-gray-800 border-gray-300' },
}

const OBSERVING = { label: '● Спостерігається',          className: 'bg-green-100 text-green-700 border-green-200' }
const NOT_OBSERVING = { label: '○ Призначено, поза видимістю', className: 'bg-gray-100 text-gray-600 border-gray-200' }

const ASSIGNMENT_STATUS_CONFIG: Record<AssignmentStatus, { label: string; className: string }> = {
  LOCAL_ASSIGNED:         OBSERVING,
  TRANSFERRED:            OBSERVING,
  MANUAL_ASSIGNED:        OBSERVING,
  WAITING_VISIBILITY:     NOT_OBSERVING,
  WEATHER_BLOCKED:        NOT_OBSERVING,
  NO_AVAILABLE_TELESCOPE: NOT_OBSERVING,
  TLE_MISSING:            NOT_OBSERVING,
}

interface Props {
  status: TelescopeStatus | AssignmentStatus
  type?: 'telescope' | 'assignment'
}

export function StatusBadge({ status, type = 'telescope' }: Props) {
  const config =
    type === 'telescope'
      ? TELESCOPE_STATUS_CONFIG[status as TelescopeStatus]
      : ASSIGNMENT_STATUS_CONFIG[status as AssignmentStatus]

  if (!config) return <span className="text-gray-400 text-xs">{status}</span>

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  )
}

export const TELESCOPE_STATUS_COLOR: Record<TelescopeStatus, string> = {
  ONLINE: '#22c55e',
  OFFLINE: '#ef4444',
  WEATHER_BLOCKED: '#eab308',
  PARTIAL: '#f97316',
  MANUAL_MODE: '#3b82f6',
  ERROR: '#1f2937',
}
