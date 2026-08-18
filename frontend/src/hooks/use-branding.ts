import { useEffect, useState } from 'react'

export type Branding = {
  name: string
  logo: string
  primary_color: string
  description: string
  footer: string
  contact: string
}

const DEFAULT_BRANDING: Branding = {
  name: 'MyOffice',
  logo: '/myoffice-avatar.webp',
  primary_color: '#6366F1',
  description: 'AI agent operating system',
  footer: 'Powered by SAM Group',
  contact: '',
}

let cache: Branding | null = null

/**
 * Branding whitelabel — dibaca dari /api/office?resource=branding (runtime, tanpa rebuild).
 * Fallback ke default + localStorage cache biar cepat.
 */
export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(() => {
    try {
      const raw = localStorage.getItem('myoffice-branding')
      if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) }
    } catch {
      /* ignore */
    }
    return cache ?? DEFAULT_BRANDING
  })

  useEffect(() => {
    let alive = true
    fetch('/api/office?resource=branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return
        const merged = { ...DEFAULT_BRANDING, ...(data?.branding ?? {}) }
        cache = merged
        setBranding(merged)
        try {
          localStorage.setItem('myoffice-branding', JSON.stringify(merged))
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* fallback default */
      })
    return () => {
      alive = false
    }
  }, [])

  return branding
}

/** Terapkan warna primer sebagai CSS variable global (untuk aksen tema). */
export function applyBrandingPrimary(color: string) {
  if (!color) return
  try {
    document.documentElement.style.setProperty('--brand-primary', color)
  } catch {
    /* ignore */
  }
}
