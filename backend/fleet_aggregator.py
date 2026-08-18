#!/usr/bin/env python3
"""MyOffice Fleet Aggregator — polling semua agent (Hermes + SAMCODER) & expose JSON."""
import json
import os
import time
import urllib.request
import urllib.parse
import http.cookiejar
import http.server
import threading

KEYS_FILE = '/opt/myoffice/gateway_keys.env'
KEYS = {}
if os.path.exists(KEYS_FILE):
    for line in open(KEYS_FILE):
        line = line.strip()
        if '=' in line:
            k, _, v = line.partition('=')
            KEYS[k.strip()] = v.strip()

GATEWAYS = [
    {'id': 'rena',   'name': 'Rena',   'role': 'Koordinasi & Operasional', 'server': 'Hostinger', 'url': 'http://127.0.0.1:8642',  'key': KEYS.get('RENA', '')},
    {'id': 'farrah', 'name': 'Farrah', 'role': 'Ops & Bisnis',             'server': 'Contabo',   'url': 'http://127.0.0.1:18642', 'key': KEYS.get('FARRAH', '')},
    {'id': 'nadine', 'name': 'Nadine', 'role': 'Proyek FindBuyer',         'server': 'Contabo',   'url': 'http://127.0.0.1:18643', 'key': KEYS.get('NADINE', '')},
    {'id': 'aaron',  'name': 'Aaron',  'role': 'Audit & Security',         'server': 'OVH',       'url': 'http://127.0.0.1:18644', 'key': KEYS.get('AARON', '')},
]

SAMCODER = {
    'id': 'dinda', 'name': 'Dinda', 'role': 'Development & Automation (SAMCODER)',
    'server': 'Contabo', 'url': 'https://coder.sam.university',
    'user': KEYS.get('SAMCODER_USER', ''), 'pass': KEYS.get('SAMCODER_PASS', ''),
}

# Harga per 1M token (USD) — mapping model → harga nyata (Fix cost calculator)
# Format key: substring model (lowercase). Urutan dicek dari spesifik ke umum.
MODEL_COST_PER_M = [
    ('deepseek', 0.28),      # DeepSeek V3/V4 ~$0.14-0.28/M
    ('openai/gpt-4o', 2.50), # GPT-4o
    ('openai', 1.25),        # GPT-4o-mini range
    ('claude', 3.00),        # Claude Sonnet/Opus range
    ('grok', 3.00),
    ('gemini', 1.25),
    ('llama', 0.50),
    ('qwen', 0.30),
    ('mistral', 0.50),
]
DEFAULT_COST_PER_M = 0.50


def model_cost_per_m(model):
    """Ambil harga per model (lowercase substring match)."""
    m = (model or '').lower()
    if not m:
        return DEFAULT_COST_PER_M
    for key, price in MODEL_COST_PER_M:
        if key in m:
            return price
    return DEFAULT_COST_PER_M


state = {'agents': [], 'updated': None}

# --- activity log (#4 Shift & Jam Kerja) ---
ACTIVITY_LOG = '/opt/myoffice/data/activity_log.jsonl'
ACTIVITY_MAX_LINES = 20000
_last_snapshot = {}  # agent_id -> (status, task, messages)


def append_activity(agents):
    """Catat snapshot hanya saat ada perubahan status/task/messages."""
    global _last_snapshot
    now = time.time()
    lines = []
    for a in agents:
        aid = a['id']
        key = (a.get('status'), a.get('currentTask'), a.get('messages', 0))
        prev = _last_snapshot.get(aid)
        if prev is None or prev != key:
            rec = {
                'ts': now,
                'agent': aid,
                'status': a.get('status'),
                'task': a.get('currentTask'),
                'messages': a.get('messages', 0),
            }
            lines.append(json.dumps(rec))
            _last_snapshot[aid] = key
    if not lines:
        return
    try:
        os.makedirs(os.path.dirname(ACTIVITY_LOG), exist_ok=True)
        # rotasi jika terlalu besar
        if os.path.exists(ACTIVITY_LOG):
            with open(ACTIVITY_LOG) as f:
                count = sum(1 for _ in f)
            if count > ACTIVITY_MAX_LINES:
                os.replace(ACTIVITY_LOG, ACTIVITY_LOG + '.old')
        with open(ACTIVITY_LOG, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
    except Exception:
        pass


def http_json(url, key=None, timeout=8, method='GET', data=None, headers=None):
    h = dict(headers or {})
    if key:
        h['Authorization'] = 'Bearer ' + key
    body = None
    if data is not None:
        h['Content-Type'] = 'application/json'
        body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def poll_hermes(gw):
    try:
        health = http_json(gw['url'] + '/v1/health', gw['key'])
        online = health.get('status') == 'ok'
        version = health.get('version', '')
    except Exception:
        return {'id': gw['id'], 'name': gw['name'], 'role': gw['role'], 'server': gw['server'],
                'status': 'offline', 'currentTask': None, 'sessions': 0, 'messages': 0,
                'tools': 0, 'tokens': 0, 'cost': 0, 'model': None, 'version': None,
                'lastSeen': None, 'source': 'hermes'}
    try:
        data = http_json(gw['url'] + '/api/sessions?limit=50', gw['key'])
        sess = data.get('data', []) if isinstance(data, dict) else []
    except Exception:
        sess = []
    total_m = sum(int(s.get('message_count') or 0) for s in sess)
    total_t = sum(int(s.get('tool_call_count') or 0) for s in sess)
    total_tok = sum(int(s.get('input_tokens') or 0) + int(s.get('output_tokens') or 0) for s in sess)
    active = None
    for s in sorted(sess, key=lambda x: x.get('started_at') or 0, reverse=True):
        if not s.get('ended_at'):
            active = s
            break
    model = active.get('model') if active else (sess[0].get('model') if sess else None)
    return {'id': gw['id'], 'name': gw['name'], 'role': gw['role'], 'server': gw['server'],
            'status': 'online' if online else 'degraded',
            'currentTask': (active.get('title') or '(aktif, tanpa judul)') if active else None,
            'sessions': len(sess), 'messages': total_m, 'tools': total_t, 'tokens': total_tok,
            'cost': round(total_tok * model_cost_per_m(model) / 1e6, 2), 'model': model, 'version': version,
            'lastSeen': time.time(), 'source': 'hermes'}


def poll_samcoder():
    base = SAMCODER['url']
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [('User-Agent', 'Mozilla/5.0 (MyOffice Fleet)')]
    try:
        req = urllib.request.Request(base + '/api/login', data=json.dumps(
            {'username': SAMCODER['user'], 'password': SAMCODER['pass']}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        with opener.open(req, timeout=10) as r:
            login = json.loads(r.read().decode())
        if not login.get('ok'):
            raise Exception('login failed')
        with opener.open(base + '/api/status', timeout=8) as r:
            st = json.loads(r.read().decode())
        hub = st.get('hub', {})
        me = st.get('me', {})
        with opener.open(base + '/api/sessions', timeout=8) as r:
            sess_data = json.loads(r.read().decode())
        sess = sess_data.get('sessions', [])
    except Exception:
        return {'id': SAMCODER['id'], 'name': SAMCODER['name'], 'role': SAMCODER['role'],
                'server': SAMCODER['server'], 'status': 'offline', 'currentTask': None,
                'sessions': 0, 'messages': 0, 'tools': 0, 'tokens': 0, 'cost': 0,
                'model': None, 'version': None, 'lastSeen': None, 'source': 'samcoder'}
    active_name = (me.get('activeSession') or {}).get('name')
    total_msg = sum(int(s.get('messageCount') or 0) for s in sess)
    return {'id': SAMCODER['id'], 'name': SAMCODER['name'], 'role': SAMCODER['role'],
            'server': SAMCODER['server'],
            'status': 'online' if hub.get('uptimeSec') else 'degraded',
            'currentTask': active_name, 'sessions': len(sess), 'messages': total_msg,
            'tools': 0, 'tokens': 0, 'cost': 0,
            'model': me.get('model'), 'version': hub.get('version'),
            'lastSeen': time.time(), 'source': 'samcoder'}


def backfill_activity_log(days=7):
    """Backfill activity log dari sessions gateway (Fix timesheet kosong)."""
    from datetime import datetime as _dt
    cutoff = time.time() - days * 86400
    count = 0
    for gw in GATEWAYS:
        try:
            data = http_json(gw['url'] + '/api/sessions?limit=200', gw['key'])
            sess = data.get('data', []) if isinstance(data, dict) else []
        except Exception:
            continue
        with open(ACTIVITY_LOG, 'a', encoding='utf-8') as f:
            for s in sess:
                st = s.get('started_at') or 0
                if isinstance(st, str):
                    try:
                        st = _dt.fromisoformat(st.replace('Z', '+00:00')).timestamp()
                    except Exception:
                        continue
                if not isinstance(st, (int, float)) or st < cutoff:
                    continue
                rec = {'ts': st, 'agent': gw['id'], 'action': 'session',
                       'detail': (s.get('title') or '')[:120], 'source': 'backfill'}
                f.write(json.dumps(rec) + '\n')
                count += 1
    print(f"backfill: {count} entries")
    return count


def refresh():
    agents = [poll_hermes(g) for g in GATEWAYS]
    agents.append(poll_samcoder())
    state['agents'] = agents
    state['updated'] = time.time()
    append_activity(agents)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/fleet.json'):
            body = json.dumps({'updated': state['updated'], 'agents': state['agents']}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/health':
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *a):
        pass


def main():
    refresh()
    t = threading.Thread(target=lambda: (time.sleep(15), main()) if False else None, daemon=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 3120), Handler)
    threading.Thread(target=loop, daemon=True).start()
    srv.serve_forever()


def loop():
    while True:
        time.sleep(15)
        try:
            refresh()
        except Exception:
            pass


if __name__ == '__main__':
    main()
