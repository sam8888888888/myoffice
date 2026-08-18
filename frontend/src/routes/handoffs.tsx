import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAgents } from '@/hooks/use-agents'

export const Route = createFileRoute('/handoffs')({
  component: HandoffsScreen,
})

type Handoff = {
  id: string
  from_agent: string
  to_agent: string
  task: string
  note: string
  status: 'open' | 'done'
  created_at: string
  completed_at: string | null
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-primary-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

function AgentTag({ id }: { id: string }) {
  return (
    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${AGENT_COLOR[id] ?? 'bg-neutral-500 text-white'}`}>
      {id.charAt(0).toUpperCase()}
    </span>
  )
}

function HandoffsScreen() {
  const qc = useQueryClient()
  const { data: agents } = useAgents()
  const agentIds = (agents ?? []).map((a) => a.id)
  const [tab, setTab] = useState<'open' | 'all'>('open')

  const handoffsQuery = useQuery({
    queryKey: ['handoffs'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=handoffs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.items ?? []) as Array<Handoff>
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const submit = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=handoffs&action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['handoffs'] }),
  })

  const done = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=handoffs&action=done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['handoffs'] }),
  })

  const items = handoffsQuery.data ?? []
  const shown = tab === 'open' ? items.filter((i) => i.status === 'open') : items
  const openCount = items.filter((i) => i.status === 'open').length

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Handoff Log</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Serah terima tugas antar agent — "task ini sekarang di siapa?".
        </p>
        <div className="mt-3 flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-0.5 text-sm w-fit">
          <button
            onClick={() => setTab('open')}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === 'open' ? 'bg-[var(--theme-accent)] text-white' : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'}`}
          >
            Open ({openCount})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === 'all' ? 'bg-[var(--theme-accent)] text-white' : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'}`}
          >
            Semua
          </button>
        </div>
      </div>

      {/* form */}
      <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Catat handoff baru</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
          <select id="ho-from" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="farrah">
            {agentIds.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select id="ho-to" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="nadine">
            {agentIds.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            id="ho-task"
            placeholder="Nama tugas…"
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2"
          />
          <input
            id="ho-note"
            placeholder="Catatan…"
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
          />
          <button
            onClick={() =>
              submit.mutate({
                from_agent: (document.getElementById('ho-from') as HTMLSelectElement).value,
                to_agent: (document.getElementById('ho-to') as HTMLSelectElement).value,
                task: (document.getElementById('ho-task') as HTMLInputElement).value || 'Tugas tanpa judul',
                note: (document.getElementById('ho-note') as HTMLInputElement).value,
              })
            }
            disabled={submit.isPending}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submit.isPending ? '…' : 'Handoff'}
          </button>
        </div>
      </div>

      {handoffsQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat handoff: {String(handoffsQuery.error)}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((h) => (
          <div key={h.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <AgentTag id={h.from_agent} />
              <span className="text-xs text-[var(--theme-muted)]">→</span>
              <AgentTag id={h.to_agent} />
              <span className="text-sm font-semibold text-[var(--theme-text)]">{h.task}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                h.status === 'open'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}>
                {h.status}
              </span>
              <span className="ml-auto text-xs text-[var(--theme-muted)]">{fmtTime(h.created_at)}</span>
            </div>
            {h.note && <p className="mt-2 text-sm text-[var(--theme-text-muted)]">{h.note}</p>}
            <div className="mt-2 flex items-center gap-3 text-xs text-[var(--theme-muted)]">
              <span>{h.from_agent} → {h.to_agent}</span>
              {h.status === 'open' ? (
                <button
                  onClick={() => done.mutate(h.id)}
                  disabled={done.isPending}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  ✓ Tandai selesai
                </button>
              ) : (
                <span className="ml-auto text-emerald-600">Selesai · {fmtTime(h.completed_at)}</span>
              )}
            </div>
          </div>
        ))}
        {shown.length === 0 && !handoffsQuery.isError && (
          <div className="py-10 text-center text-[var(--theme-muted)]">
            {tab === 'open' ? 'Tidak ada handoff terbuka. Semua tugas clear 🎉' : 'Belum ada handoff.'}
          </div>
        )}
      </div>
    </div>
  )
}
