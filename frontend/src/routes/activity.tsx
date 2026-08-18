import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { StandupScreen } from './standup'
import { TimelineScreen } from './timeline'
import { ShiftScreen } from './shift'

export const Route = createFileRoute('/activity')({
  component: ActivityHub,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || 'standup',
  }),
})

const TABS = [
  { id: 'standup', label: '📋 Standup' },
  { id: 'timeline', label: '🕒 Timeline' },
  { id: 'shift', label: '🕐 Shift' },
]

export function ActivityHub() {
  const { tab } = useSearch({ from: '/activity' })
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 md:px-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate({ to: '/activity', search: { tab: t.id } })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-[var(--theme-card)] text-[var(--theme-text-muted)] border border-[var(--theme-border)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'timeline' ? (
          <TimelineScreen />
        ) : tab === 'shift' ? (
          <ShiftScreen />
        ) : (
          <StandupScreen />
        )}
      </div>
    </div>
  )
}
