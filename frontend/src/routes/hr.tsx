import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { ControlScreen } from './control'
import { OnboardingScreen } from './onboarding'
import { ReviewScreen } from './review'

export const Route = createFileRoute('/hr')({
  component: HrHub,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || 'control',
  }),
})

const TABS = [
  { id: 'control', label: '🛡️ Control' },
  { id: 'onboarding', label: '🎓 Onboarding' },
  { id: 'review', label: '⭐ Review' },
]

export function HrHub() {
  const { tab } = useSearch({ from: '/hr' })
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 md:px-8">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate({ to: '/hr', search: { tab: t.id } })}
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
        {tab === 'onboarding' ? (
          <OnboardingScreen />
        ) : tab === 'review' ? (
          <ReviewScreen />
        ) : (
          <ControlScreen />
        )}
      </div>
    </div>
  )
}
