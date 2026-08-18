import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/kpi')({
  component: KpiScreen,
})

type KpiRow = {
  id: string
  name: string
  role: string
  status: string
  sessions: number
  messages: number
  tools: number
  tokens: number
  cost: number
  msgs_per_session: number
  tasks_completed: number
  quality: number
  autonomy: number
  cost_per_task: number
  kpi_score: number
  currentTask?: string | null
}

type BestWork = {
  agent: string
  title: string
  desc: string
  date: string
}

type KpiData = {
  period: string
  generated_at: string
  rows: KpiRow[]
  best_work: BestWork[]
  totals: { agents: number; sessions: number; messages: number; tokens: number; cost: number }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score, 0), 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--theme-border)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-[var(--theme-text)]">{score.toFixed(1)}</span>
    </div>
  )
}

export function KpiScreen() {
  const kpiQuery = useQuery({
    queryKey: ['kpi'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=kpi')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as KpiData
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })
  const [reportMsg, setReportMsg] = useState<string | null>(null)
  const exportPdf = useMutation({
    mutationFn: async (kind: string) => {
      const res = await fetch('/api/office?resource=report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, days: 7 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { file?: string }
    },
    onSuccess: (d) => {
      setReportMsg(`Laporan dibuat → buka menu Files › reports/${d.file?.split('/').pop() ?? ''}`)
      setTimeout(() => setReportMsg(null), 6000)
    },
    onError: () => setReportMsg('Gagal membuat laporan'),
  })

  const kpi = kpiQuery.data
  const rows = kpi?.rows ?? []
  const [qAgent, setQAgent] = useState(rows[0]?.id ?? 'rena')
  const [qQuality, setQQuality] = useState(4)
  const [qAutonomy, setQAutonomy] = useState(0.8)
  const [qTasks, setQTasks] = useState(5)

  const qualityMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: qAgent, quality: qQuality, autonomy: qAutonomy, tasks_completed: qTasks }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => kpiQuery.refetch(),
  })

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">KPI Scorecard</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Skor kinerja agent ({kpi?.period ?? '…'}) — kombinasi kualitas, otonomi, dan aktivitas.
          </p>
        </div>
        {kpi && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              {formatNum(kpi.totals.messages)} pesan
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              {formatNum(kpi.totals.tokens)} token
            </span>
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              ~${kpi.totals.cost.toFixed(2)}
            </span>
            <button
              onClick={() => exportPdf.mutate('kpi')}
              disabled={exportPdf.isPending}
              className="rounded-full border border-[var(--theme-border)] px-3 py-1 font-medium text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-card2)] disabled:opacity-50"
            >
              {exportPdf.isPending ? '⏳ …' : '📄 Export PDF'}
            </button>
          </div>
        )}
        {reportMsg && (
          <div className="mt-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {reportMsg}
          </div>
        )}
      </div>

      {/* Quality input */}
      <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Agent</label>
            <select
              value={qAgent}
              onChange={(e) => setQAgent(e.target.value)}
              className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            >
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Kualitas (1–5)</label>
            <input
              type="number" min={1} max={5} step={0.1}
              value={qQuality}
              onChange={(e) => setQQuality(Number(e.target.value))}
              className="w-20 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Otonomi (0–1)</label>
            <input
              type="number" min={0} max={1} step={0.05}
              value={qAutonomy}
              onChange={(e) => setQAutonomy(Number(e.target.value))}
              className="w-20 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Tugas selesai</label>
            <input
              type="number" min={0}
              value={qTasks}
              onChange={(e) => setQTasks(Number(e.target.value))}
              className="w-20 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <button
            onClick={() => qualityMut.mutate()}
            disabled={qualityMut.isPending}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {qualityMut.isPending ? 'Menyimpan…' : '💾 Simpan Kualitas'}
          </button>
          {qualityMut.isSuccess && <span className="text-xs text-emerald-500">Tersimpan ✓</span>}
        </div>
      </div>

      {kpiQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat KPI: {String(kpiQuery.error)}
        </div>
      )}

      {kpi && (
        <>
          {/* Score table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--theme-border)] text-left text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-3 py-3">Skor KPI</th>
                  <th className="px-3 py-3">Sesi</th>
                  <th className="px-3 py-3">Pesan</th>
                  <th className="px-3 py-3">Tools</th>
                  <th className="px-3 py-3">Token</th>
                  <th className="px-3 py-3">Kualitas</th>
                  <th className="px-3 py-3">Otonomi</th>
                  <th className="px-3 py-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.id} className={`border-b border-[var(--theme-border-subtle)] last:border-0 ${idx === 0 ? 'bg-primary-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {idx === 0 && <span className="text-base">🥇</span>}
                        {idx === 1 && <span className="text-base">🥈</span>}
                        {idx === 2 && <span className="text-base">🥉</span>}
                        <div>
                          <div className="font-medium text-[var(--theme-text)]">{r.name}</div>
                          <div className="text-xs text-[var(--theme-muted)]">{r.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><ScoreBar score={r.kpi_score} /></td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{r.sessions}</td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{formatNum(r.messages)}</td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{formatNum(r.tools)}</td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{formatNum(r.tokens)}</td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{r.quality ? `${r.quality}/5` : '-'}</td>
                    <td className="px-3 py-3 text-[var(--theme-text)]">{r.autonomy ? `${Math.round(r.autonomy * 100)}%` : '-'}</td>
                    <td className="px-3 py-3 font-medium text-[var(--theme-text)]">${r.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Best work */}
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">🏆 Karya terbaik minggu ini</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {kpi.best_work.map((b, i) => (
                <div key={i} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">{b.agent} · {b.date}</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--theme-text)]">{b.title}</div>
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!kpi && !kpiQuery.isError && <div className="py-10 text-center text-[var(--theme-muted)]">Memuat KPI…</div>}
    </div>
  )
}
