import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/timeline')({
  component: TimelineScreen,
})

type TimelineEvent = {
  ts: number
  ts_iso: string
  agent: string
  status: string
  task?: string
  messages?: number
}

type TimelineData = {
  hours: number
  count: number
  events: TimelineEvent[]
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-amber-600 text-white',
  unknown: 'bg-neutral-600 text-white',
}

const STATE_LABEL: Record<string, string> = {
  online: '🟢 online',
  offline: '⚪ offline',
  degraded: '🟡 degraded',
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function TimelineScreen() {
  const [filter, setFilter] = useState<string>('all')
  const { data, isLoading, isError } = useQuery<TimelineData>({
    queryKey: ['timeline'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=timeline&hours=24')
      const j = await res.json()
      return j.ok ? j : { hours: 24, count: 0, events: [] }
    },
    refetchInterval: 15000,
  })

  const events = (data?.events ?? []).filter((e) => filter === 'all' || e.agent === filter)
  const agents = Array.from(new Set((data?.events ?? []).map((e) => e.agent)))

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Replay Riwayat Kerja</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Aktivitas live dari semua agent — 24 jam terakhir ({data?.count ?? 0} event).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'all' ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card)] text-[var(--theme-text-muted)] border border-[var(--theme-border)]'}`}
          >
            Semua
          </button>
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => setFilter(a)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === a ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card)] text-[var(--theme-text-muted)] border border-[var(--theme-border)]'}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-[var(--theme-muted)]">Memuat timeline…</p>}
      {isError && <p className="text-sm text-red-400">Gagal memuat timeline.</p>}

      <div className="space-y-2">
        {!isLoading && events.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-8 text-center text-sm text-[var(--theme-muted)]">
            Belum ada aktivitas tercatat dalam 24 jam terakhir.
          </div>
        )}
        {events.map((e, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2"
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${AGENT_COLOR[e.agent] ?? AGENT_COLOR.unknown}`}>
              {e.agent.slice(0, 1).toUpperCase()}
            </span>
            <span className="w-32 shrink-0 text-xs tabular-nums text-[var(--theme-text-muted)]">{fmtTime(e.ts_iso)}</span>
            <span className="w-24 shrink-0 text-xs font-medium text-[var(--theme-text)]">{e.agent}</span>
            <span className="w-24 shrink-0 text-xs">{STATE_LABEL[e.status] ?? e.status}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--theme-text-muted)]">
              {e.task ? `🔧 ${e.task}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
