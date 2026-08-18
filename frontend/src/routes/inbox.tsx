import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/inbox')({
  component: InboxScreen,
})

type Msg = {
  id: string
  from: string
  to: string
  subject: string
  body: string
  priority: string
  task_id?: string
  created_at: string
  read_by?: string[]
}

type Broadcast = {
  id: string
  from: string
  subject: string
  body: string
  created_at: string
}

type Notif = {
  kind: string
  id: string
  title: string
  detail: string
  ts: string
}

const AGENTS = ['rena', 'farrah', 'nadine', 'aaron', 'dinda']

function fmt(iso: string): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function InboxScreen() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'messages' | 'broadcast' | 'notifications'>('messages')
  const [frm, setFrm] = useState('samian')
  const [to, setTo] = useState('rena')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [bcSubject, setBcSubject] = useState('')
  const [bcBody, setBcBody] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 3500)
  }

  const messagesQuery = useQuery({
    queryKey: ['messages'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=messages')
      if (!res.ok) return []
      const j = await res.json()
      return (j.items ?? []) as Msg[]
    },
    refetchInterval: 15000,
  })

  const broadcastQuery = useQuery({
    queryKey: ['broadcasts'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=broadcast')
      if (!res.ok) return []
      const j = await res.json()
      return (j.items ?? []) as Broadcast[]
    },
    refetchInterval: 20000,
  })

  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=notifications')
      if (!res.ok) return []
      const j = await res.json()
      return (j.items ?? []) as Notif[]
    },
    refetchInterval: 15000,
  })

  const sendMsg = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: frm, to, subject, body }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      flash('✅ Pesan terkirim')
      setBody('')
      setSubject('')
      qc.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: (e) => flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`),
  })

  const sendBc = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: frm, subject: bcSubject, body: bcBody }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      flash('📢 Broadcast terkirim ke semua agent')
      setBcBody('')
      setBcSubject('')
      qc.invalidateQueries({ queryKey: ['broadcasts'] })
    },
    onError: (e) => flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`),
  })

  const tabs = [
    { id: 'messages' as const, label: `💬 Pesan (${messagesQuery.data?.length ?? 0})` },
    { id: 'broadcast' as const, label: `📢 Broadcast (${broadcastQuery.data?.length ?? 0})` },
    { id: 'notifications' as const, label: `🔔 Notifikasi (${notifQuery.data?.length ?? 0})` },
  ]

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">📬 Inbox & Komunikasi</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Pesan antar agent, broadcast dari CEO, dan semua notifikasi dalam satu tempat.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                tab === t.id ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card2)] text-[var(--theme-muted)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {toast && <div className="mb-3 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-500">{toast}</div>}

      {tab === 'messages' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Form kirim pesan */}
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">✉️ Kirim Pesan Agent</div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <select value={frm} onChange={(e) => setFrm(e.target.value)} className="w-1/2 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-2 text-sm text-[var(--theme-text)]">
                  {['samian', ...AGENTS].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="w-1/2 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-2 py-2 text-sm text-[var(--theme-text)]">
                  {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subjek (opsional)"
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Isi pesan…"
                rows={4}
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <button
                onClick={() => sendMsg.mutate()}
                disabled={!body || sendMsg.isPending}
                className="w-full rounded-lg bg-accent-500 py-2 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {sendMsg.isPending ? 'Mengirim…' : 'Kirim Pesan'}
              </button>
            </div>

            {/* Form broadcast */}
            <div className="mt-5 border-t border-[var(--theme-border-subtle)] pt-4">
              <div className="mb-2 text-sm font-semibold text-[var(--theme-text)]">📢 Broadcast ke Semua Agent</div>
              <input
                value={bcSubject}
                onChange={(e) => setBcSubject(e.target.value)}
                placeholder="Subjek instruksi"
                className="mb-2 w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <textarea
                value={bcBody}
                onChange={(e) => setBcBody(e.target.value)}
                placeholder="Isi instruksi…"
                rows={3}
                className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <button
                onClick={() => sendBc.mutate()}
                disabled={!bcBody || sendBc.isPending}
                className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {sendBc.isPending ? 'Mengirim…' : 'Broadcast Instruksi'}
              </button>
            </div>
          </div>

          {/* Thread pesan */}
          <div className="lg:col-span-2 space-y-2">
            {(messagesQuery.data ?? []).length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-8 text-center text-sm text-[var(--theme-muted)]">
                Belum ada pesan antar agent
              </div>
            )}
            {(messagesQuery.data ?? []).map((m) => (
              <div key={m.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-[var(--theme-text)]">{m.from}</span>
                    <span className="text-[var(--theme-muted)]">→</span>
                    <span className="font-semibold text-[var(--theme-text)]">{m.to}</span>
                    {m.priority === 'high' && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">HIGH</span>
                    )}
                    {m.task_id && (
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">#{m.task_id}</span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--theme-muted)]">{fmt(m.created_at)}</span>
                </div>
                {m.subject && <div className="mt-1 text-sm font-medium text-[var(--theme-text)]">{m.subject}</div>}
                <div className="mt-1 text-sm text-[var(--theme-text-muted)]">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'broadcast' && (
        <div className="space-y-2">
          {(broadcastQuery.data ?? []).length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-8 text-center text-sm text-[var(--theme-muted)]">
              Belum ada broadcast
            </div>
          )}
          {(broadcastQuery.data ?? []).map((b) => (
            <div key={b.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--theme-text)]">📢 {b.subject}</span>
                <span className="text-xs text-[var(--theme-muted)]">{fmt(b.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-[var(--theme-text-muted)]">{b.body}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-2">
          {(notifQuery.data ?? []).length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-8 text-center text-sm text-[var(--theme-muted)]">
              Tidak ada notifikasi — semua tenang 🎉
            </div>
          )}
          {(notifQuery.data ?? []).map((n) => (
            <div key={n.kind + n.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
              <div>
                <div className="text-sm font-medium text-[var(--theme-text)]">{n.title}</div>
                <div className="mt-0.5 text-xs text-[var(--theme-muted)]">{n.detail}</div>
              </div>
              <span className="shrink-0 text-xs text-[var(--theme-muted)]">{fmt(n.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
