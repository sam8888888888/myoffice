import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/health')({
  component: HealthScreen,
})

type HealthRow = {
  id: string
  name: string
  status: string
  server: string
  score: number
  level: 'healthy' | 'watch' | 'critical'
  reasons: string[]
  recommendation: string
  sessions: number
  messages: number
  cost: number
  currentTask: string | null
}

type HealthData = {
  generated_at: string
  rows: HealthRow[]
  summary: { healthy: number; watch: number; critical: number }
}

const LEVEL_STYLE: Record<string, { badge: string; bar: string; emoji: string }> = {
  healthy: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500', emoji: '🟢' },
  watch: { badge: 'border-amber-200 bg-amber-50 text-amber-700', bar: 'bg-amber-500', emoji: '🟡' },
  critical: { badge: 'border-red-200 bg-red-50 text-red-700', bar: 'bg-red-500', emoji: '🔴' },
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function HealthScreen() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as HealthData
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const h = healthQuery.data
  const rows = h?.rows ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Health Monitor</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Skor kesehatan agent — heartbeat, aktivitas, dan rekomendasi.
          </p>
        </div>
        {h && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
              🟢 {h.summary.healthy} sehat
            </span>
            {h.summary.watch > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">
                🟡 {h.summary.watch} watch
              </span>
            )}
            {h.summary.critical > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-medium text-red-700">
                🔴 {h.summary.critical} critical
              </span>
            )}
          </div>
        )}
      </div>

      {healthQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat health: {String(healthQuery.error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const s = LEVEL_STYLE[r.level] ?? LEVEL_STYLE.critical
          return (
            <div key={r.id} className={`rounded-xl border p-4 ${r.level === 'critical' ? 'border-red-300 bg-red-50/30' : r.level === 'watch' ? 'border-amber-300 bg-amber-50/30' : 'border-[var(--theme-border)] bg-[var(--theme-card)]'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-[var(--theme-text)]">{r.name}</div>
                  <div className="text-xs text-[var(--theme-muted)]">{r.server} · {r.status}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.badge}`}>
                  {s.emoji} {r.level}
                </span>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Skor kesehatan</span>
                  <span className="text-lg font-bold text-[var(--theme-text)]">{r.score}<span className="text-xs text-[var(--theme-muted)]">/100</span></span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--theme-border)]">
                  <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${r.score}%` }} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.reasons.map((reason) => (
                  <span key={reason} className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
                    {reason}
                  </span>
                ))}
              </div>

              <div className="mt-3 space-y-1 text-xs text-[var(--theme-text-muted)]">
                <div>{formatNum(r.messages)} pesan · {r.sessions} sesi · ${r.cost.toFixed(2)}</div>
                {r.currentTask && <div className="truncate">🔧 {r.currentTask}</div>}
              </div>

              <div className="mt-3 rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
                💡 {r.recommendation}
              </div>
            </div>
          )
        })}
      </div>

      {rows.length === 0 && !healthQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat health monitor…</div>
      )}
    </div>
  )
}
