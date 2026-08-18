import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AgentAvatar } from '@/components/agent-avatar'

export const Route = createFileRoute('/employees')({
  component: EmployeesScreen,
})

type Employee = {
  id: string
  name: string
  role: string
  dept: string
  status: string
  server: string
  avatar?: string | null
  currentTask: string | null
  kpi_score: number
  messages: number
  sessions: number
  cost: number
  salary_usd: number
  spent_usd: number
  payroll_pct: number
  payroll_status: string
  health_score: number
  health_level: string
  health_rec: string
  best_work: { agent: string; title: string; desc: string; date: string } | null
  last_handoff: { from_agent: string; to_agent: string; task: string; status: string; created_at: string } | null
}

type EmployeesData = {
  company: string
  rows: Employee[]
  totals: { agents: number; online: number; budget_usd: number; spent_usd: number }
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

const HEALTH_EMOJI: Record<string, string> = { healthy: '🟢', watch: '🟡', critical: '🔴' }
const PAY_STYLE: Record<string, string> = {
  ok: 'text-emerald-600',
  warning: 'text-amber-600',
  over: 'text-red-600',
  'belum-ada-aktivitas': 'text-[var(--theme-muted)]',
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

function EmployeeCard({ e }: { e: Employee }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <AgentAvatar id={e.id} name={e.name} avatar={e.avatar} size="lg" />
          <div>
            <div className="font-semibold text-[var(--theme-text)]">{e.name}</div>
            <div className="text-xs text-[var(--theme-text-muted)]">{e.role}{e.dept && e.dept !== e.role ? ` · ${e.dept}` : ''}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${e.status === 'online' ? 'text-emerald-600' : 'text-red-500'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${e.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {e.status}
          </span>
          <span className="text-[10px] text-[var(--theme-muted)]">{e.server}</span>
        </div>
      </div>

      {/* KPI + Health + Payroll mini-bars */}
      <div className="mt-3 space-y-2">
        <MiniBar label="KPI" value={e.kpi_score} max={100} suffix="" color={e.kpi_score >= 25 ? 'bg-emerald-500' : 'bg-amber-500'} />
        <MiniBar label="Health" value={e.health_score} max={100} suffix="" color={e.health_level === 'critical' ? 'bg-red-500' : e.health_level === 'watch' ? 'bg-amber-500' : 'bg-emerald-500'} />
        <MiniBar label="Payroll" value={Math.min(e.payroll_pct, 100)} max={100} suffix="%" color={e.payroll_status === 'over' ? 'bg-red-500' : e.payroll_status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-[var(--theme-card2)] py-1.5">
          <div className="font-semibold text-[var(--theme-text)]">{formatNum(e.messages)}</div>
          <div className="text-[9px] uppercase text-[var(--theme-text-muted)]">Pesan</div>
        </div>
        <div className="rounded-lg bg-[var(--theme-card2)] py-1.5">
          <div className="font-semibold text-[var(--theme-text)]">${e.cost.toFixed(2)}</div>
          <div className="text-[9px] uppercase text-[var(--theme-text-muted)]">Cost</div>
        </div>
        <div className="rounded-lg bg-[var(--theme-card2)] py-1.5">
          <div className={`font-semibold ${PAY_STYLE[e.payroll_status] ?? 'text-[var(--theme-text)]'}`}>{e.payroll_pct}%</div>
          <div className="text-[9px] uppercase text-[var(--theme-text-muted)]">Budget</div>
        </div>
      </div>

      <div className="mt-3 min-h-[2.5rem] rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
        {e.currentTask ? `🔧 ${e.currentTask}` : '🟢 Idle'}
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[var(--theme-muted)]">Health</span>
          <span className="font-medium text-[var(--theme-text)]">{HEALTH_EMOJI[e.health_level] ?? ''} {e.health_score}/100 · {e.health_level}</span>
        </div>
        {e.best_work && (
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-[var(--theme-muted)]">🏆 Karya</span>
            <span className="text-right text-[var(--theme-text-muted)]">{e.best_work.title}</span>
          </div>
        )}
        {e.last_handoff && (
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-[var(--theme-muted)]">⇄ Handoff</span>
            <span className="text-right text-[var(--theme-text-muted)]">
              {e.last_handoff.from_agent} → {e.last_handoff.to_agent} · {e.last_handoff.task} ({e.last_handoff.status})
            </span>
          </div>
        )}
        {e.health_rec && (
          <div className="rounded-lg bg-[var(--theme-card2)] px-2 py-1.5 text-[var(--theme-muted)]">💡 {e.health_rec}</div>
        )}
      </div>
    </div>
  )
}

function MiniBar({ label, value, max, suffix, color }: { label: string; value: number; max: number; suffix: string; color: string }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--theme-border)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right text-[10px] font-medium text-[var(--theme-text-muted)]">
        {value}{suffix}
      </span>
    </div>
  )
}

export function EmployeesScreen() {
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=employees')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as EmployeesData
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const data = employeesQuery.data
  const rows = data?.rows ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Kartu Karyawan</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            HRIS digital {data?.company ?? '…'} — profil lengkap tiap agent: kinerja, kesehatan, budget, karya.
          </p>
        </div>
        {data && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              {data.totals.online}/{data.totals.agents} online
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              ${data.totals.spent_usd.toFixed(2)} / ${data.totals.budget_usd.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {employeesQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat karyawan: {String(employeesQuery.error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((e) => (
          <EmployeeCard key={e.id} e={e} />
        ))}
      </div>

      {rows.length === 0 && !employeesQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat kartu karyawan…</div>
      )}
    </div>
  )
}
