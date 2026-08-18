import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/payroll')({
  component: PayrollScreen,
})

type PayrollRow = {
  id: string
  name: string
  salary_usd: number
  spent_usd: number
  pct: number
  status: string
  threshold_pct: number
  currentTask?: string | null
  status_live?: string
}

type PayrollData = {
  period: string
  currency: string
  warning_threshold_pct: number
  generated_at: string
  rows: PayrollRow[]
  totals: { budget_usd: number; spent_usd: number; pct: number }
}

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  over: 'bg-red-50 text-red-700 border-red-200',
  'belum-ada-aktivitas': 'bg-[var(--theme-card2)] text-[var(--theme-text)] border-[var(--theme-border)]',
}

function ProgressBar({ pct, status }: { pct: number; status: string }) {
  const color = status === 'over' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--theme-card2)]">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function PayrollScreen() {
  const payrollQuery = useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=payroll')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as PayrollData
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const p = payrollQuery.data
  const rows = p?.rows ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Payroll Token</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Alokasi budget bulanan per agent ({p?.period ?? '…'}) vs biaya token terpakai.
          </p>
        </div>
        {p && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              Budget ${p.totals.budget_usd.toFixed(2)}
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              Terpakai ${p.totals.spent_usd.toFixed(2)}
            </span>
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                p.totals.pct >= 100
                  ? 'bg-red-50 text-red-700'
                  : p.totals.pct >= p.warning_threshold_pct
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {p.totals.pct}% total
            </span>
          </div>
        )}
      </div>

      {payrollQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat payroll: {String(payrollQuery.error)}
        </div>
      )}

      {p && (
        <div className="overflow-x-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-sm">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[var(--theme-border)] text-left text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">
                <th className="px-4 py-3">Agent</th>
                <th className="px-3 py-3">Budget</th>
                <th className="px-3 py-3">Terpakai</th>
                <th className="px-3 py-3 w-1/4">Progress</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Live</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--theme-border-subtle)] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--theme-text)]">{r.name}</div>
                    {r.currentTask && <div className="max-w-[220px] truncate text-xs text-[var(--theme-text-muted)]">🔧 {r.currentTask}</div>}
                  </td>
                  <td className="px-3 py-3 text-[var(--theme-text)]">${r.salary_usd.toFixed(2)}</td>
                  <td className="px-3 py-3 text-[var(--theme-text)]">${r.spent_usd.toFixed(2)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProgressBar pct={r.pct} status={r.status} />
                      </div>
                      <span className="w-12 text-right text-xs font-medium text-[var(--theme-text-muted)]">{r.pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[r.status] ?? STATUS_STYLE.ok}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${r.status_live === 'online' ? 'text-emerald-600' : 'text-red-500'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${r.status_live === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {r.status_live}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!p && !payrollQuery.isError && <div className="py-10 text-center text-[var(--theme-muted)]">Memuat payroll…</div>}
    </div>
  )
}
