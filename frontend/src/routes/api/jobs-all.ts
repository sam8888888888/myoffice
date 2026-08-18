import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const JOBS_AGG = 'http://127.0.0.1:3122'
const JOBS_TOKEN = process.env.MYOFFICE_API_TOKEN || ''

async function aggFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(JOBS_TOKEN ? { 'X-Office-Token': JOBS_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  })
}

export const Route = createFileRoute('/api/jobs-all')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const res = await aggFetch(`${JOBS_AGG}/jobs.json`, {
            signal: AbortSignal.timeout(8000),
          })
          const data = await res.json()
          return json({ ok: true, ...data })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = await request.text()
          const res = await aggFetch(`${JOBS_AGG}/action`, {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(20000),
          })
          const data = await res.json()
          return json({ ok: res.ok && data.ok !== false, ...data })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
