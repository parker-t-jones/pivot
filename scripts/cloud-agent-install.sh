#!/usr/bin/env bash
#
# Cloud Agent `install` phase — durable, idempotent repository setup.
# Prepares system dependencies and installs/builds workspace packages. Runtime services
# (Docker daemon, local Supabase, API) are brought up separately in cloud-agent-start.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

# Local Supabase runs its full stack in Docker, so the VM needs a Docker engine.
# fuse-overlayfs is the storage driver that works inside the nested Cloud Agent VM.
if ! command -v docker >/dev/null 2>&1; then
  echo "[install] Installing docker.io + fuse-overlayfs..."
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -y
  sudo apt-get install -y -o Dpkg::Options::=--force-confold \
    docker.io fuse-overlayfs uidmap
fi

# Docker 29 defaults to an nftables firewall backend that drops container-to-container
# traffic on the bridge network inside this nested VM (the Supabase realtime container
# can't reach Postgres). Pin the legacy iptables backend, which works here.
sudo update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true

# Allow the agent user to use the Docker socket without sudo.
sudo groupadd -f docker
sudo usermod -aG docker "$(id -un)" || true

# Workspace dependencies + type build (typecheck/tests read source via vitest aliases,
# but the API/services resolve workspace packages from dist).
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm build

echo "[install] Done."
