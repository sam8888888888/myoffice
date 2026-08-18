import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/incidents')({
  component: IncidentsScreen,
})

type Incident = { id: string; agent: string; severity: string; message: string; status: string; created_at: string; escalated?: boolean }

const SEV_COLOR: Record<string, string> = { critical: 'bg-red-500/15 text-red-300', warning: 'bg-amber-500/15 text-amber-300', info: 'bg-sky-500/15 text-sky-300' }
const ST_COLOR: Record<string, string> = { open: 'bg-red-500/15 text-red-300', escalated: 'bg-orange-500/15 text-orange-300', resolved: 'bg-emerald-500/15 text-emerald-300' }

function IncidentsScreen() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['incidents'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=incidents')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      return { items: (d.items ?? []) as Incident[], open: (d.open ?? 0) as number }
    },
    refetchInterval: 30000,
  })

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=incidents&action=resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, note: 'resolved via dashboard' }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  })

  const check = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=incidents&action=check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  })

  const items = q.data?.items ?? []
  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">🚨 Incidents</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">Deteksi + eskalasi otomatis (critical {'>'} 15 menit)</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 text-xs font-medium text-[var(--theme-text-muted)]">
            Open: <b className={q.data?.open ? 'text-red-300' : 'text-emerald-300'}>{q.data?.open ?? 0}</b>
          </span>
          <button onClick={() => check.mutate()} className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-card2)]">🔄 Cek</button>
        </div>
      </div>
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEV_COLOR[i.severity] ?? ''}`}>{i.severity.toUpperCase()}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ST_COLOR[i.status] ?? ''}`}>{i.status.toUpperCase()}{i.escalated ? ' ⚡' : ''}</span>
                  <span className="text-sm font-medium text-[var(--theme-text)]">{i.message}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--theme-muted)]">{i.id} · {i.created_at?.replace('T', ' ').slice(0, 16)}Z</div>
              </div>
              {i.status !== 'resolved' && (
                <button onClick={() => resolve.mutate(i.id)} className="rounded-md border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/10">✓ Resolve</button>
              )}
            </div>
          ))}
          {!items.length && <div className="py-6 text-center text-sm text-[var(--theme-muted)]">✅ Tidak ada incident — semua agent sehat.</div>}
        </div>
      </div>
    </div>
  )
}
