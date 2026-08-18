import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { EmployeesScreen } from './employees'
import { KpiScreen } from './kpi'

export const Route = createFileRoute('/team')({
  component: TeamHub,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || 'employees',
  }),
})

const TABS = [
  { id: 'employees', label: '👥 Karyawan' },
  { id: 'kpi', label: '🏆 KPI' },
]

export function TeamHub() {
  const { tab } = useSearch({ from: '/team' })
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 md:px-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate({ to: '/team', search: { tab: t.id } })}
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
        {tab === 'kpi' ? <KpiScreen /> : <EmployeesScreen />}
      </div>
    </div>
  )
}
