import { useQuery } from '@tanstack/react-query'

/**
 * Mission Control (F1-3) — widget bar: approvals pending, incidents open,
 * agent online, spend hari ini. Data dari office backend.
 */
export function MissionControl() {
  const q = useQuery({
    queryKey: ['mission-control'],
    queryFn: async () => {
      const [ap, inc, fleet, kpi] = await Promise.all([
        fetch('/api/office?resource=approvals').then((r) => (r.ok ? r.json() : {})),
        fetch('/api/office?resource=incidents').then((r) => (r.ok ? r.json() : {})),
        fetch('/api/office?resource=fleet').then((r) => (r.ok ? r.json() : {})),
        fetch('/api/office?resource=kpi').then((r) => (r.ok ? r.json() : {})),
      ])
      const agents = Array.isArray((fleet as { agents?: unknown }).agents) ? ((fleet as { agents: Array<{ status?: string }> }).agents) : []
      const online = agents.filter((a) => a.status === 'online').length
      const total = agents.length
      const openInc = (inc as { open?: number }).open ?? 0
      const pending = (ap as { pending_count?: number }).pending_count ?? (Array.isArray((ap as { items?: unknown[] }).items) ? ((ap as { items: Array<{ status?: string }> }).items.filter((i) => i.status === 'pending').length) : 0)
      const rows = (kpi as { rows?: Array<{ cost?: number }> }).rows ?? []
      const spend = rows.reduce((s, r) => s + (r.cost ?? 0), 0)
      return { online, total, openInc, pending, spend }
    },
    refetchInterval: 30000,
  })

  const d = q.data
  const cards = [
    { label: 'Agent Online', value: d ? `${d.online}/${d.total}` : '…', tone: d && d.total > 0 && d.online === d.total ? 'good' : 'warn' },
    { label: 'Approvals Pending', value: d ? String(d.pending) : '…', tone: d && d.pending > 0 ? 'warn' : 'good' },
    { label: 'Incidents Open', value: d ? String(d.openInc) : '…', tone: d && d.openInc > 0 ? 'bad' : 'good' },
    { label: 'Spend (est)', value: d ? `$${d.spend.toFixed(2)}` : '…', tone: 'good' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
            {c.label}
          </div>
          <div
            className={`mt-1 text-xl font-bold ${
              c.tone === 'bad'
                ? 'text-red-400'
                : c.tone === 'warn'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
