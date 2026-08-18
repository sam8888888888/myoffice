import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAgents } from '@/hooks/use-agents'

export const Route = createFileRoute('/review')({
  component: ReviewScreen,
})

type Review = {
  id: string
  agent: string
  summary_auto: { currentTask: string | null; sessions: number; messages: number; cost: number }
  kendala: string
  saran: string
  follow_up: string
  rating: number
  created_at: string
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

function Stars({ rating }: { rating: number }) {
  return <span className="text-amber-500">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
}

export function ReviewScreen() {
  const qc = useQueryClient()
  const { data: agents } = useAgents()
  const agentIds = (agents ?? []).map((a) => a.id)
  const [agent, setAgent] = useState('aaron')
  const [kendala, setKendala] = useState('')
  const [saran, setSaran] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [rating, setRating] = useState(4)

  const reviewsQuery = useQuery({
    queryKey: ['reviews'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=reviews')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.items ?? []) as Array<Review>
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=reviews&action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, kendala, saran, follow_up: followUp, rating }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] })
      setKendala('')
      setSaran('')
      setFollowUp('')
    },
  })

  const items = reviewsQuery.data ?? []
  const filtered = agent ? items.filter((r) => r.agent === agent) : items

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Review 1:1</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Evaluasi rutin dengan agent — ringkasan kerja otomatis + catatan kendala & saran.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Form */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Review baru</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--theme-muted)]">Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              >
                {agentIds.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--theme-muted)]">Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    className={`text-xl ${n <= rating ? 'text-amber-500' : 'text-[var(--theme-border)]'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--theme-muted)]">Kendala</label>
              <textarea
                value={kendala}
                onChange={(e) => setKendala(e.target.value)}
                rows={2}
                placeholder="Apa kendala minggu ini?"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--theme-muted)]">Saran / catatan Papi</label>
              <textarea
                value={saran}
                onChange={(e) => setSaran(e.target.value)}
                rows={2}
                placeholder="Arahan untuk agent…"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--theme-muted)]">Follow-up</label>
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="Tindak lanjut yang dijanjikan…"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
            </div>
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
              className="w-full rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submit.isPending ? 'Menyimpan…' : 'Simpan review'}
            </button>
            {submit.isError && <div className="text-xs text-red-600">{String(submit.error)}</div>}
          </div>
        </div>

        {/* Riwayat */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--theme-text)]">Riwayat review</h2>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-1 text-xs text-[var(--theme-text)]"
            >
              {agentIds.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.id} className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-card2)] p-3">
                <div className="flex items-center justify-between">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${AGENT_COLOR[r.agent] ?? ''}`}>
                    {r.agent.charAt(0).toUpperCase()}
                  </span>
                  <Stars rating={r.rating} />
                  <span className="text-[10px] text-[var(--theme-muted)]">{fmtTime(r.created_at)}</span>
                </div>
                <div className="mt-2 text-[11px] text-[var(--theme-muted)]">
                  Saat review: {r.summary_auto.currentTask ?? 'Idle'} · {r.summary_auto.sessions} sesi · {r.summary_auto.messages} pesan · ${r.summary_auto.cost.toFixed(2)}
                </div>
                {r.kendala && (
                  <div className="mt-1.5 text-xs text-[var(--theme-text-muted)]">
                    <span className="text-red-600">Kendala:</span> {r.kendala}
                  </div>
                )}
                {r.saran && (
                  <div className="mt-1 text-xs text-[var(--theme-text-muted)]">
                    <span className="text-emerald-600">Saran:</span> {r.saran}
                  </div>
                )}
                {r.follow_up && (
                  <div className="mt-1 text-xs text-[var(--theme-text-muted)]">
                    <span className="text-sky-600">Follow-up:</span> {r.follow_up}
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-xs text-[var(--theme-muted)]">Belum ada review untuk agent ini.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
