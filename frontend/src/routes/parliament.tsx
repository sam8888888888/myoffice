import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/parliament')({
  component: ParliamentScreen,
})

type Session = {
  id: string
  title: string
  issue: string
  type: string
  risk: string
  votes: Array<{ agent: string; vote: string; reason: string }>
  approves: number
  againsts: number
  decision: string
  status: string
  created_at: string
}

type McpServer = {
  name: string
  url: string
  enabled: boolean
  tools?: string[]
  created_at?: string
}

const VOTE_STYLE: Record<string, string> = {
  approve: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  against: 'bg-red-500/15 text-red-500 border-red-500/30',
  abstain: 'bg-[var(--theme-card2)] text-[var(--theme-muted)] border-[var(--theme-border)]',
}

function fmt(iso: string): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function ParliamentScreen() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [issue, setIssue] = useState('')
  const [type, setType] = useState('task')
  const [risk, setRisk] = useState('medium')
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 3500)
  }

  const parQuery = useQuery({
    queryKey: ['parliament'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=parliament')
      if (!res.ok) return []
      const j = await res.json()
      return (j.items ?? []) as Session[]
    },
    refetchInterval: 20000,
  })

  const mcpQuery = useQuery({
    queryKey: ['mcp'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=mcp')
      if (!res.ok) return []
      const j = await res.json()
      return (j.servers ?? []) as McpServer[]
    },
    refetchInterval: 30000,
  })

  const startSess = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=parliament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, issue, type, risk }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: (d) => {
      flash(`🏛 Sidang selesai — ${d.session?.decision ?? '?'}`)
      setIssue('')
      setTitle('')
      qc.invalidateQueries({ queryKey: ['parliament'] })
    },
    onError: (e) => flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`),
  })

  const addMcp = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: mcpName, url: mcpUrl, enabled: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      flash('✅ MCP server ditambahkan')
      setMcpName('')
      setMcpUrl('')
      qc.invalidateQueries({ queryKey: ['mcp'] })
    },
    onError: (e) => flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`),
  })

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">🏛 Agent Parliament</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Voting multi-agent sebelum keputusan besar — setiap agent menilai dari domainnya.
        </p>
      </div>

      {toast && <div className="mb-3 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-500">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Form sidang baru */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">📜 Mulai Sidang</div>
          <div className="space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul keputusan"
              className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
            <textarea
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              placeholder="Isu yang diputuskan…"
              rows={3}
              className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
            <div className="flex gap-2">
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-1/2 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-2 text-sm text-[var(--theme-text)]">
                {['task', 'deploy', 'install', 'secret_access', 'spending', 'external_contact', 'riset', 'content'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select value={risk} onChange={(e) => setRisk(e.target.value)} className="w-1/2 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-2 text-sm text-[var(--theme-text)]">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <button
              onClick={() => startSess.mutate()}
              disabled={!issue || startSess.isPending}
              className="w-full rounded-lg bg-accent-500 py-2 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
            >
              🗳 Mulai Voting
            </button>
          </div>

          {/* MCP servers */}
          <div className="mt-5 border-t border-[var(--theme-border-subtle)] pt-4">
            <div className="mb-2 text-sm font-semibold text-[var(--theme-text)]">🔌 MCP Servers</div>
            <div className="space-y-2">
              <input
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder="Nama server"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <input
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="http://host:port/mcp"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <button
                onClick={() => addMcp.mutate()}
                disabled={!mcpName || !mcpUrl || addMcp.isPending}
                className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                + Tambah MCP
              </button>
              <div className="space-y-1">
                {(mcpQuery.data ?? []).map((s) => (
                  <div key={s.name} className="flex items-center justify-between rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-sm">
                    <span className="font-medium text-[var(--theme-text)]">🔌 {s.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                      {s.enabled ? 'AKTIF' : 'MATI'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Riwayat sidang */}
        <div className="lg:col-span-2 space-y-2">
          {(parQuery.data ?? []).length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-8 text-center text-sm text-[var(--theme-muted)]">
              Belum ada sidang — mulai voting pertama!
            </div>
          )}
          {(parQuery.data ?? []).map((s) => (
            <div key={s.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-[var(--theme-text)]">{s.title}</div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.decision === 'approved' ? 'bg-emerald-500/15 text-emerald-500' : s.decision === 'rejected' ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-500'}`}>
                    {s.decision?.toUpperCase()}
                  </span>
                  <span className="text-xs text-[var(--theme-muted)]">{fmt(s.created_at)}</span>
                </div>
              </div>
              <p className="mt-1 text-sm text-[var(--theme-text-muted)]">{s.issue}</p>
              <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[var(--theme-muted)]">{s.type}</span>
                <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[var(--theme-muted)]">risiko {s.risk}</span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">✅ {s.approves}</span>
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-500">❌ {s.againsts}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {(s.votes ?? []).map((v) => (
                  <div key={v.agent} className={`rounded-lg border px-2 py-1.5 text-center ${VOTE_STYLE[v.vote] ?? VOTE_STYLE.abstain}`}>
                    <div className="text-xs font-semibold">{v.agent}</div>
                    <div className="text-[10px]">{v.vote}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
