'use client'

import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { AgentDefinition, CreateAgentInput } from '@/types/agent'
import { cn } from '@/lib/utils'

const COLOR_OPTIONS = [
  { value: 'text-blue-400', label: 'Blue', swatch: '#60a5fa' },
  { value: 'text-purple-400', label: 'Purple', swatch: '#c084fc' },
  { value: 'text-orange-400', label: 'Orange', swatch: '#fb923c' },
  { value: 'text-emerald-400', label: 'Emerald', swatch: '#34d399' },
  { value: 'text-amber-400', label: 'Amber', swatch: '#fbbf24' },
  { value: 'text-cyan-400', label: 'Cyan', swatch: '#22d3ee' },
  { value: 'text-yellow-400', label: 'Yellow', swatch: '#facc15' },
  { value: 'text-red-400', label: 'Red', swatch: '#f87171' },
  { value: 'text-pink-400', label: 'Pink', swatch: '#f472b6' },
  { value: 'text-indigo-400', label: 'Indigo', swatch: '#818cf8' },
  { value: 'text-teal-400', label: 'Teal', swatch: '#2dd4bf' },
  { value: 'text-lime-400', label: 'Lime', swatch: '#a3e635' },
  { value: 'text-rose-400', label: 'Rose', swatch: '#fb7185' },
  { value: 'text-violet-400', label: 'Violet', swatch: '#a78bfa' },
  { value: 'text-sky-400', label: 'Sky', swatch: '#38bdf8' },
  { value: 'text-green-400', label: 'Green', swatch: '#4ade80' },
]

const COMMON_EMOJIS = [
  '🤖', '🧠', '🎯', '⚡', '🔥', '🌟', '💡', '🛠️',
  '🎨', '🏗️', '📣', '🔍', '⚙️', '🔬', '🛡️', '🚀',
  '📊', '✍️', '🧬', '🔐', '📱', '🌐', '💻', '🗂️',
]

type Props = {
  open: boolean
  isSubmitting?: boolean
  /** If provided, we're editing an existing agent */
  agent?: AgentDefinition | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateAgentInput) => void | Promise<void>
}

function getDefaults(agent?: AgentDefinition | null): CreateAgentInput {
  return {
    name: agent?.name ?? '',
    emoji: agent?.emoji ?? '🤖',
    color: agent?.color ?? 'text-blue-400',
    roleLabel: agent?.roleLabel ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    model: agent?.model ?? null,
    tags: agent?.tags ?? [],
  }
}

export function AgentEditorDialog({
  open,
  isSubmitting = false,
  agent,
  onOpenChange,
  onSubmit,
}: Props) {
  const isEditing = Boolean(agent && !agent.isBuiltIn)
  const [form, setForm] = useState<CreateAgentInput>(getDefaults(agent))
  const [tagsInput, setTagsInput] = useState((agent?.tags ?? []).join(', '))
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  useEffect(() => {
    if (!open) {
      const defaults = getDefaults(agent)
      setForm(defaults)
      setTagsInput((agent?.tags ?? []).join(', '))
      setShowEmojiPicker(false)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange, agent])

  if (!open) return null

  function set<K extends keyof CreateAgentInput>(key: K, value: CreateAgentInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10)
    await onSubmit({ ...form, name: form.name.trim(), tags })
  }

  const selectedColor = COLOR_OPTIONS.find((c) => c.value === form.color) ?? COLOR_OPTIONS[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold text-[var(--theme-text)]">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5 overflow-y-auto">
          {/* Identity row: emoji + name + color */}
          <div className="flex items-start gap-3">
            {/* Emoji picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] text-xl hover:bg-[var(--theme-hover)] transition-colors"
                title="Choose emoji"
              >
                {form.emoji}
              </button>
              {showEmojiPicker && (
                <div className="absolute left-0 top-10 z-10 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2 shadow-xl">
                  <div className="grid grid-cols-8 gap-1">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          set('emoji', emoji)
                          setShowEmojiPicker(false)
                        }}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded text-base hover:bg-[var(--theme-hover)] transition-colors',
                          form.emoji === emoji && 'bg-[var(--theme-hover)]',
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Name */}
            <div className="flex-1">
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Agent name"
                required
                maxLength={40}
                className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              />
            </div>

            {/* Color swatch */}
            <div className="relative group">
              <button
                type="button"
                className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] hover:bg-[var(--theme-hover)] transition-colors"
                title="Color"
              >
                <span
                  className="h-4 w-4 rounded-full border border-white/20"
                  style={{ background: selectedColor.swatch }}
                />
              </button>
              {/* Color picker dropdown */}
              <div className="absolute right-0 top-10 z-10 hidden group-focus-within:block group-hover:block rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2 shadow-xl">
                <div className="grid grid-cols-4 gap-1.5">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => set('color', c.value)}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all',
                        form.color === c.value
                          ? 'border-[var(--theme-accent)] scale-110'
                          : 'border-transparent hover:scale-105',
                      )}
                      title={c.label}
                      style={{ background: c.swatch }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Role label */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              Role / Title
            </label>
            <input
              type="text"
              value={form.roleLabel}
              onChange={(e) => set('roleLabel', e.target.value)}
              placeholder="e.g. Data Scientist, Legal Analyst"
              maxLength={60}
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            />
          </div>

          {/* System prompt */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              System Prompt
              <span className="ml-1.5 font-normal opacity-60">(defines behaviour)</span>
            </label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              rows={6}
              placeholder={`You are ${form.name || 'an expert agent'}. Your role is to...`}
              className="w-full resize-y rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none font-mono"
            />
          </div>

          {/* Model override */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              Model override
              <span className="ml-1.5 font-normal opacity-60">(optional — uses session default if blank)</span>
            </label>
            <input
              type="text"
              value={form.model ?? ''}
              onChange={(e) => set('model', e.target.value.trim() || null)}
              placeholder="e.g. claude-opus-4-5"
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none font-mono"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--theme-muted)]">
              Tags
              <span className="ml-1.5 font-normal opacity-60">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. analysis, legal, research"
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.name.trim()}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {isSubmitting ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
