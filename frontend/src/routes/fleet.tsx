import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/fleet')({
  component: FleetScreen,
})

type Agent = {
  id: string
  name: string
  role: string
  server: string
  status: string
  currentTask: string | null
  sessions: number
  messages: number
  tools: number
  tokens: number
  cost: number
  model: string | null
  version: string | null
  source: string
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    online: { dot: 'bg-emerald-500', label: 'Online' },
    degraded: { dot: 'bg-amber-500', label: 'Degraded' },
    offline: { dot: 'bg-red-500', label: 'Offline' },
  }
  const s = map[status] ?? map.offline
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--theme-text-muted)]">
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    processing: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    idle: 'bg-[var(--theme-card2)] text-[var(--theme-text-muted)] border-[var(--theme-border)]',
    paused: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    waiting_approval: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
    offline: 'bg-red-500/15 text-red-500 border-red-500/30',
  }
  const label: Record<string, string> = {
    processing: '⚙️ Processing',
    idle: '💤 Idle',
    paused: '⏸ Paused',
    waiting_approval: '⏳ Waiting Approval',
    offline: '📴 Offline',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${map[state] ?? map.idle}`}>
      {label[state] ?? state}
    </span>
  )
}

function AgentCard({ a, state }: { a: Agent; state?: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-lg font-bold text-primary-700">
            {a.name.charAt(0)}
          </div>
          <div>
            <div className="font-semibold text-[var(--theme-text)]">{a.name}</div>
            <div className="text-xs text-[var(--theme-muted)]">{a.role}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={a.status} />
          {state && <StateBadge state={state} />}
        </div>
      </div>
      <div className="mt-3 text-xs text-[var(--theme-muted)]">
        {a.server} · {a.source}
        {a.model ? ` · ${a.model}` : ''}
        {a.version ? ` · v${a.version}` : ''}
      </div>
      <div className="mt-2 min-h-[2.5rem] rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
        {a.currentTask ? `🔧 ${a.currentTask}` : '🟢 Idle'}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <Stat label="Sessions" value={formatNum(a.sessions)} />
        <Stat label="Messages" value={formatNum(a.messages)} />
        <Stat label="Tools" value={formatNum(a.tools)} />
        <Stat label="Tokens" value={formatNum(a.tokens)} />
      </div>
      <div className="mt-3 border-t border-[var(--theme-border-subtle)] pt-2 text-xs text-[var(--theme-muted)]">
        Cost (est): <span className="font-medium">~${a.cost.toFixed(2)}</span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--theme-card2)] py-2">
      <div className="text-sm font-semibold text-[var(--theme-text)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">{label}</div>
    </div>
  )
}

function FleetScreen() {
  const fleetQuery = useQuery({
    queryKey: ['fleet'],
    queryFn: async () => {
      const res = await fetch('/api/fleet')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.agents ?? []) as Array<Agent>
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const agents = fleetQuery.data ?? []

  const statusQuery = useQuery({
    queryKey: ['office-status'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=status')
      const j = await res.json()
      return (j.rows ?? []) as Array<{ id: string; state: string }>
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })
  const stateMap = new Map((statusQuery.data ?? []).map((r) => [r.id, r.state]))

  const online = agents.filter((a) => a.status === 'online').length
  const totalTokens = agents.reduce((s, a) => s + a.tokens, 0)
  const totalCost = agents.reduce((s, a) => s + a.cost, 0)

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Fleet</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Semua agent dalam satu layar — status, tugas aktif, dan biaya.
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
            {online}/{agents.length} online
          </span>
          <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
            {formatNum(totalTokens)} tokens
          </span>
          <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
            ~${totalCost.toFixed(2)}
          </span>
        </div>
      </div>
      {fleetQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat fleet: {String(fleetQuery.error)}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <AgentCard key={a.id} a={a} state={stateMap.get(a.id)} />
        ))}
      </div>
      {agents.length === 0 && !fleetQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat fleet…</div>
      )}
    </div>
  )
}
