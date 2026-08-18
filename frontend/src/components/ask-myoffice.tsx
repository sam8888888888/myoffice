import { useState } from 'react'

/**
 * F3-1: AI Assistant "Tanya MyOffice" — modal chat Q&A data live.
 */
export function AskMyOffice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hist, setHist] = useState<Array<{ q: string; a: string }>>([])
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const ask = async () => {
    const question = q.trim()
    if (!question || loading) return
    setLoading(true)
    setQ('')
    try {
      const res = await fetch(`/api/office?resource=ask&q=${encodeURIComponent(question)}`)
      const j = await res.json()
      const answer = (j.answer ?? 'Tidak ada jawaban') as string
      setHist((h) => [...h, { q: question, a: answer }])
    } catch {
      setHist((h) => [...h, { q: question, a: '⚠️ Gagal menjawab — coba lagi.' }])
    } finally {
      setLoading(false)
    }
  }

  const suggestions = ['siapa online?', 'spend minggu ini?', 'task pending nadine?', 'approval menunggu?', 'ada incident?']

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[70vh] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-xl sm:h-[60vh] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--theme-border-subtle)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--theme-text)]">🤖 Tanya MyOffice</div>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {hist.length === 0 && (
            <div className="py-8 text-center">
              <div className="text-3xl">🤖</div>
              <p className="mt-2 text-sm text-[var(--theme-muted)]">Tanya data live MyOffice — fleet, spend, task, approval, incident.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setQ(s); setTimeout(() => ask(), 0) }}
                    className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-1 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hist.map((h, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[var(--theme-accent)] px-3 py-2 text-sm text-white">
                {h.q}
              </div>
              <div className="w-fit max-w-[85%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
                {h.a}
              </div>
            </div>
          ))}
          {loading && <div className="text-sm text-[var(--theme-muted)]">Menjawab…</div>}
        </div>

        <div className="flex gap-2 border-t border-[var(--theme-border-subtle)] px-4 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
            placeholder="Tanya: siapa online? spend? task pending?"
            className="flex-1 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
          />
          <button onClick={ask} disabled={loading || !q.trim()} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
            Kirim
          </button>
        </div>
      </div>
    </div>
  )
}
