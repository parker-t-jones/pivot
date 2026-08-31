#!/usr/bin/env bash
#
# Cloud Agent `start` phase — per-boot runtime reconciliation.
# Brings up the Docker daemon and the local Supabase stack, writes services/api/.env from
# the local Supabase credentials, and seeds reference data. Idempotent and returns when
# the stack is ready. The API server itself runs as a `terminals` process (see
# .cursor/environment.json) so its logs stay visible.
set -uo pipefail

cd "$(dirname "$0")/.."

log() { echo "[start] $*"; }

# Docker bridge networking in this nested VM needs the legacy iptables backend (see
# cloud-agent-install.sh) and IP forwarding enabled.
sudo update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true

# 1. Start the Docker daemon if it isn't already serving.
if ! docker info >/dev/null 2>&1; then
  log "Starting dockerd..."
  sudo rm -f /var/run/docker.pid 2>/dev/null || true
  sudo bash -c 'nohup dockerd --storage-driver=fuse-overlayfs >/var/log/cloud-agent-dockerd.log 2>&1 &'
  for _ in $(seq 1 60); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
fi
if ! docker info >/dev/null 2>&1; then
  log "ERROR: dockerd did not become ready"; sudo tail -n 20 /var/log/cloud-agent-dockerd.log 2>/dev/null || true
  exit 1
fi
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
log "dockerd ready"

# 2. Start the local Supabase stack (idempotent: no-op if already running).
log "Starting Supabase (this pulls images on first run)..."
pnpm exec supabase start

# 3. Write services/api/.env from the local Supabase credentials (gitignored).
log "Writing services/api/.env"
eval "$(pnpm exec supabase status -o env 2>/dev/null | grep -E '^(API_URL|JWT_SECRET|SERVICE_ROLE_KEY)=')"
cat > services/api/.env <<EOF
SUPABASE_URL=${API_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_JWT_SECRET=${JWT_SECRET}
CACHE_DRIVER=memory
PORT=3000
EOF

# 4. Seed reference data (all idempotent upserts). seed:schedule uses a bundled data file;
#    seed:players / seed:test-user fetch from Sleeper's public API — best-effort so a
#    transient network failure doesn't block boot.
log "Seeding schedule..."; pnpm seed:schedule || log "WARN: seed:schedule failed"
log "Seeding players (Sleeper)..."; pnpm seed:players || log "WARN: seed:players failed (network?)"
log "Seeding test user..."; pnpm seed:test-user || log "WARN: seed:test-user failed (network?)"

# 5. Launch the API dev server detached (idempotent: skip if :3000 is already serving).
if curl -sf -o /dev/null http://127.0.0.1:3000/state/nfl 2>/dev/null \
  || (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  log "API server already running on :3000"
else
  log "Starting API server (pnpm --filter @fantasy-focus/api dev)..."
  nohup pnpm --filter @fantasy-focus/api dev >/tmp/api.log 2>&1 &
  for _ in $(seq 1 30); do
    (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null && break
    sleep 1
  done
fi

log "Ready. Supabase API: http://127.0.0.1:54321  Studio: http://127.0.0.1:54323  App API: http://127.0.0.1:3000"
log "Test user: test@fantasyfocus.dev / FantasyFocusTest123!"
