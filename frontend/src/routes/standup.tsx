import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/standup')({
  component: StandupScreen,
})

type StandupEntry = {
  id: string
  name: string
  role: string
  status: string
  server: string
  currentTask: string | null
  sessions: number
  messages: number
  tools: number
  cost: number
  kpi_score: number
  best_work: { agent: string; title: string; desc: string; date: string } | null
}

type StandupData = {
  generated_at: string
  date: string
  entries: StandupEntry[]
  totals: { agents: number; online: number; messages: number; cost: number }
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-primary-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function StandupScreen() {
  const standupQuery = useQuery({
    queryKey: ['standup'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=standup')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as StandupData
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const s = standupQuery.data
  const entries = s?.entries ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Daily Standup</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Feed "hari ini mereka ngapain" — {s?.date ?? '…'}.
          </p>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            📁 Snapshot harian otomatis tersimpan di vault: <code className="rounded bg-[var(--theme-card2)] px-1.5 py-0.5">/opt/myoffice/vault/standup_{s?.date ?? 'YYYY-MM-DD'}.md</code> (cron 08:00 MYT)
          </p>
        </div>
        {s && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              {s.totals.online}/{s.totals.agents} online
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              {formatNum(s.totals.messages)} pesan
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              ~${s.totals.cost.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {standupQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat standup: {String(standupQuery.error)}
        </div>
      )}

      <div className="space-y-4">
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${AGENT_COLOR[e.id] ?? 'bg-neutral-500 text-white'}`}>
                {e.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--theme-text)]">{e.name}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${e.status === 'online' ? 'text-emerald-600' : 'text-red-500'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${e.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {e.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--theme-muted)]">{e.role} · {e.server}</div>
              </div>
              <div className="text-right text-xs text-[var(--theme-muted)]">
                <div>KPI <span className="font-semibold text-[var(--theme-text)]">{e.kpi_score.toFixed(1)}</span></div>
                <div>${e.cost.toFixed(2)}</div>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
              {e.currentTask ? `🔧 Sedang mengerjakan: ${e.currentTask}` : '🟢 Idle — belum ada tugas aktif.'}
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-[var(--theme-card2)] py-2">
                <div className="text-sm font-semibold text-[var(--theme-text)]">{e.sessions}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Sesi</div>
              </div>
              <div className="rounded-lg bg-[var(--theme-card2)] py-2">
                <div className="text-sm font-semibold text-[var(--theme-text)]">{formatNum(e.messages)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Pesan</div>
              </div>
              <div className="rounded-lg bg-[var(--theme-card2)] py-2">
                <div className="text-sm font-semibold text-[var(--theme-text)]">{formatNum(e.tools)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Tools</div>
              </div>
              <div className="rounded-lg bg-[var(--theme-card2)] py-2">
                <div className="text-sm font-semibold text-[var(--theme-text)]">{e.kpi_score > 0 ? '🏆' : '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Highlight</div>
              </div>
            </div>

            {e.best_work && (
              <div className="mt-3 rounded-lg border border-[var(--theme-border-subtle)] px-3 py-2 text-xs">
                <span className="text-[var(--theme-muted)]">🏆 Karya terbaik · {e.best_work.date}: </span>
                <span className="font-medium text-[var(--theme-text)]">{e.best_work.title}</span>
                <span className="text-[var(--theme-muted)]"> — {e.best_work.desc}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {entries.length === 0 && !standupQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat standup…</div>
      )}
    </div>
  )
}
