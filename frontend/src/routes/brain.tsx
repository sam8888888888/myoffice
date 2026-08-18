import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/brain')({
  component: MemoryScreen,
})

type MemoryEntry = {
  id: string
  title: string
  category: string
  agent: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

const CATEGORY_LABEL: Record<string, string> = {
  system: 'System (identitas agent)',
  reference: 'Reference (pengetahuan)',
  company: 'Company (keputusan & fakta)',
}

const AGENTS = ['rena', 'farrah', 'nadine', 'aaron', 'dinda']

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function AuditPanel() {
  const auditQuery = useQuery({
    queryKey: ['memory-audit'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=memory&action=audit')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.audit ?? {}) as {
        total_notes: number
        total_files: number
        by_category: Record<string, number>
        duplicates: Record<string, string[]>
        large_notes: Array<{ id: string; bytes: number }>
        suggestion: string
      }
    },
    staleTime: 5000,
  })
  if (auditQuery.isLoading) return <div className="py-4 text-center text-sm text-[var(--theme-muted)]">Menganalisis…</div>
  const a = auditQuery.data
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-2 text-center">
          <div className="text-lg font-bold text-[var(--theme-text)]">{a?.total_notes ?? 0}</div>
          <div className="text-[10px] text-[var(--theme-muted)]">Notes</div>
        </div>
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-2 text-center">
          <div className="text-lg font-bold text-[var(--theme-text)]">{a?.total_files ?? 0}</div>
          <div className="text-[10px] text-[var(--theme-muted)]">File .md</div>
        </div>
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-2 text-center">
          <div className="text-lg font-bold text-[var(--theme-text)]">{Object.keys(a?.duplicates ?? {}).length}</div>
          <div className="text-[10px] text-[var(--theme-muted)]">Duplikat</div>
        </div>
      </div>
      <div className="text-xs text-[var(--theme-muted)]">
        Per kategori:{' '}
        {Object.entries(a?.by_category ?? {}).map(([c, n]) => `${c} (${n})`).join(' · ') || '—'}
      </div>
      {Object.keys(a?.duplicates ?? {}).length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
          <div className="mb-1 text-xs font-semibold text-amber-300">⚠ Kemungkinan duplikat</div>
          {Object.entries(a?.duplicates ?? {}).map(([k, ids]) => (
            <div key={k} className="truncate text-[11px] text-[var(--theme-muted)]">{ids.join(' , ')}</div>
          ))}
        </div>
      )}
      {(a?.large_notes ?? []).length > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2">
          <div className="mb-1 text-xs font-semibold text-orange-300">📦 Catatan besar (&gt;10KB)</div>
          {(a?.large_notes ?? []).map((n) => (
            <div key={n.id} className="truncate text-[11px] text-[var(--theme-muted)]">{n.id} — {(n.bytes / 1024).toFixed(1)}KB</div>
          ))}
        </div>
      )}
      <div className="text-xs text-[var(--theme-muted)]">💡 {a?.suggestion}</div>
    </div>
  )
}

function MemoryScreen() {
  const qc = useQueryClient()
  const [category, setCategory] = useState<string>('')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [detail, setDetail] = useState<{ id: string; title: string; category: string; agent: string | null; tags: string[]; content: string } | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [ctxAgent, setCtxAgent] = useState('nadine')
  const [showAudit, setShowAudit] = useState(false)
  const [semantic, setSemantic] = useState(false)

  const listQuery = useQuery({
    queryKey: ['memory', category, q, semantic],
    queryFn: async () => {
      const params = new URLSearchParams({ resource: 'memory' })
      if (semantic) {
        params.set('action', 'semantic')
        if (q) params.set('q', q)
        if (category) params.set('category', category)
        params.set('limit', '12')
        const res = await fetch(`/api/office?${params.toString()}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        return ((data.semantic ?? []) as Array<{ id: string; title: string; category: string; score: number; snippet: string }>).map((r) => ({
          id: r.id,
          title: `${r.title} · ✨ ${r.score}`,
          category: r.category,
          agent: null,
          tags: [],
          content: r.snippet,
        })) as MemoryEntry[]
      }
      if (category) params.set('category', category)
      if (q) params.set('q', q)
      const res = await fetch(`/api/office?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.items ?? []) as MemoryEntry[]
    },
    staleTime: 3000,
  })

  const contextQuery = useQuery({
    queryKey: ['memory-context', ctxAgent],
    queryFn: async () => {
      const res = await fetch(`/api/office?resource=memory&action=context&agent=${encodeURIComponent(ctxAgent)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.blocks ?? []) as Array<{ id: string; content: string }>
    },
    enabled: showContext,
    staleTime: 5000,
  })

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/office?resource=memory&action=read&path=${encodeURIComponent(id)}`)
    if (!res.ok) return
    const d = await res.json()
    setDetail(d.item ?? d)
    setSelectedId(id)
    setEditing(false)
  }

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['memory'] })
      const item = data?.item
      if (item?.id) openDetail(item.id)
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/office?resource=memory&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memory'] })
      setSelectedId(null)
      setDetail(null)
      setEditing(false)
    },
  })

  const items = listQuery.data ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Memory</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Knowledge base agent — system, reference, company. Versi otomatis tersimpan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowContext((v) => !v)}
            className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-muted)]"
          >
            {showContext ? 'Tutup Context' : 'Auto-Context'}
          </button>
          <button
            onClick={() => {
              setDetail({ id: '', title: '', category: 'reference', agent: null, tags: [], content: '' })
              setEditing(true)
            }}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Note Baru
          </button>
        </div>
      </div>

      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowAudit(false)}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--theme-text)]">🔍 Audit Memory</h2>
              <button onClick={() => setShowAudit(false)} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]">✕</button>
            </div>
            <AuditPanel />
          </div>
        </div>
      )}

      {showContext && (
        <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--theme-text)]">Auto-Context untuk agent:</span>
            <select
              value={ctxAgent}
              onChange={(e) => setCtxAgent(e.target.value)}
              className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-1 text-sm text-[var(--theme-text)]"
            >
              {AGENTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <span className="ml-auto text-xs text-[var(--theme-muted)]">yang akan dibaca agent di awal sesi</span>
          </div>
          <div className="space-y-2">
            {contextQuery.data?.map((b) => (
              <details key={b.id} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--theme-text)]">{b.id}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--theme-muted)]">{b.content.slice(0, 600)}</pre>
              </details>
            ))}
            {contextQuery.data?.length === 0 && (
              <div className="text-sm text-[var(--theme-muted)]">
                Belum ada memory system/company untuk agent ini. Buat note kategori <b>system</b> dengan agent tersebut, atau kategori <b>company</b>.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* kiri: kategori + list */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2 lg:col-span-1">
          <div className="flex flex-wrap gap-1 px-2 py-2">
            <button
              onClick={() => setCategory('')}
              className={`rounded-full px-3 py-1 text-xs font-medium ${category === '' ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card2)] text-[var(--theme-muted)]'}`}
            >
              Semua
            </button>
            <button
              onClick={() => {
                void (async () => {
                  await fetch('/api/office?resource=memory&action=refresh-contexts', { method: 'POST' })
                  await fetch('/api/office?resource=memory&action=daily', { method: 'POST' })
                  await fetch('/api/office?resource=memory&action=dreaming', { method: 'POST' })
                  qc.invalidateQueries({ queryKey: ['memory'] })
                })()
              }}
              className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              title="Auto: refresh context + ringkasan harian + dreaming (Memory B/C)"
            >
              🔄 Auto
            </button>
            <button
              onClick={() => setShowAudit((v) => !v)}
              className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              title="Audit memory: duplikasi, ukuran, statistik"
            >
              🔍 Audit
            </button>
            <button
              onClick={() => setShowContext((v) => !v)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${showContext ? 'bg-[var(--theme-accent)] text-white' : 'text-[var(--theme-muted)]'}`}
            >
              🧠 Auto-Context
            </button>
            {['system', 'reference', 'company', 'learnings'].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${category === c ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card2)] text-[var(--theme-muted)]'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={semantic ? 'Cari berdasarkan makna…' : 'Cari memory…'}
              className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
            <button
              onClick={() => setSemantic((v) => !v)}
              title="Semantic search: cari berdasarkan makna, bukan kata persis"
              className={`shrink-0 rounded-lg border px-2 py-2 text-sm ${semantic ? 'border-violet-500/50 bg-violet-500/20 text-violet-300' : 'border-[var(--theme-border)] text-[var(--theme-muted)]'}`}
            >
              ✨
            </button>
          </div>
          <div className="max-h-[520px] space-y-1 overflow-y-auto">
            {items.map((m) => (
              <button
                key={m.id}
                onClick={() => openDetail(m.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${selectedId === m.id ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)]' : 'text-[var(--theme-text)] hover:bg-[var(--theme-hover)]'}`}
              >
                <span className="mt-0.5 shrink-0 rounded bg-[var(--theme-card2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--theme-muted)]">
                  {m.category}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="block text-[10px] text-[var(--theme-muted)]">
                    {m.agent ? `@${m.agent} · ` : ''}
                    {fmtTime(m.updated_at)}
                  </span>
                </span>
              </button>
            ))}
            {items.length === 0 && !listQuery.isError && (
              <div className="py-10 text-center text-[var(--theme-muted)]">Belum ada memory. Buat note pertama.</div>
            )}
            {listQuery.isError && (
              <div className="px-3 py-4 text-sm text-red-600">Gagal memuat: {String(listQuery.error)}</div>
            )}
          </div>
        </div>

        {/* kanan: detail/editor */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] lg:col-span-2">
          {editing ? (
            <div className="p-4">
              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input
                  id="mem-title"
                  defaultValue={detail?.title ?? ''}
                  placeholder="Judul…"
                  className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2"
                />
                <select id="mem-cat" defaultValue={detail?.category ?? 'reference'} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select id="mem-agent" defaultValue={detail?.agent ?? ''} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
                  <option value="">Tanpa agent (shared)</option>
                  {AGENTS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <textarea
                id="mem-content"
                defaultValue={detail?.content ?? ''}
                placeholder="Isi memory (markdown)…"
                className="h-72 w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] p-3 font-mono text-sm text-[var(--theme-text)]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => { setEditing(false); if (!detail?.id) setDetail(null) }} className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)]">
                  Batal
                </button>
                <button
                  onClick={() =>
                    save.mutate({
                      id: detail?.id ?? '',
                      title: (document.getElementById('mem-title') as HTMLInputElement).value,
                      category: (document.getElementById('mem-cat') as HTMLSelectElement).value,
                      agent: (document.getElementById('mem-agent') as HTMLSelectElement).value || null,
                      content: (document.getElementById('mem-content') as HTMLTextAreaElement).value,
                    })
                  }
                  disabled={save.isPending}
                  className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {save.isPending ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          ) : detail ? (
            <div className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--theme-muted)]">{detail.category}</span>
                {detail.agent && <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">@{detail.agent}</span>}
                {(detail.tags ?? []).map((t) => (
                  <span key={t} className="rounded bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]">#{t}</span>
                ))}
                <span className="ml-auto text-xs text-[var(--theme-muted)]">diperbarui {fmtTime(detail.updated_at ?? '')}</span>
              </div>
              <h2 className="text-lg font-bold text-[var(--theme-text)]">{detail.title}</h2>
              <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--theme-text)]">
                {detail.content}
              </pre>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => remove.mutate(detail.id)}
                  disabled={remove.isPending}
                  className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/10"
                >
                  Hapus
                </button>
                <button onClick={() => setEditing(true)} className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-[var(--theme-muted)]">
              Pilih memory di kiri, atau buat note baru.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
