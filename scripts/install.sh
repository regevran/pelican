#!/usr/bin/env bash
#
# Install the Pelican systemd user units.
#
# The unit files beside this script are templates: each carries @REPO@ where the
# repository's own path belongs, because a unit file cannot work that out for
# itself. This script fills that in and writes the results under
# ~/.config/systemd/user/, replacing any earlier install. Re-run it after moving
# the repository or editing a unit.
#
# Nothing is enabled. `systemctl --user start pelican.target` starts the whole
# stack whether or not it has been enabled; enabling is what makes it start at
# login, and is left to you because it is a change to your session rather than
# to this repository.

set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd -- "$here/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found: these units need systemd." >&2
  exit 1
fi

if [ ! -d "$repo/world_renderer" ] || [ ! -d "$repo/world_state_stream" ]; then
  echo "$repo does not look like the pelican repository." >&2
  exit 1
fi

shopt -s nullglob
sources=("$here"/pelican-*.service "$here"/pelican.target)
if [ ${#sources[@]} -eq 0 ]; then
  echo "No unit files found beside $here." >&2
  exit 1
fi

mkdir -p "$unit_dir"

# sed treats & in the replacement as "the whole match"; an ampersand in a
# directory name is unlikely but would silently corrupt every unit.
replacement="${repo//&/\\&}"

for source in "${sources[@]}"; do
  name="$(basename -- "$source")"
  sed "s|@REPO@|$replacement|g" "$source" >"$unit_dir/$name"
  printf '  installed %s\n' "$name"
done

systemctl --user daemon-reload

# The units will start, but two of them will fail immediately on a fresh clone
# without these. Warn now rather than let it look like a systemd problem.
missing=()
[ -x "$repo/world_simulator/.venv/bin/python" ] || missing+=("world_simulator/.venv (set it up with: python3 -m venv world_simulator/.venv && world_simulator/.venv/bin/pip install -e world_simulator)")
[ -d "$repo/world_state_stream/node_modules" ] || missing+=("world_state_stream/node_modules (cd world_state_stream && npm install)")
[ -d "$repo/world_renderer/node_modules" ] || missing+=("world_renderer/node_modules (cd world_renderer && npm install)")
if [ ${#missing[@]} -gt 0 ]; then
  printf '\nNot set up yet:\n' >&2
  for item in "${missing[@]}"; do printf '  - %s\n' "$item" >&2; done
fi

# The broker unit runs `docker compose up`, and compose manages containers by
# name: it will not adopt a container it did not create. A pelican-rabbitmq
# started by hand therefore makes the unit fail, and Restart=on-failure turns
# that single failure into a loop — so say so here, where the remedy is obvious,
# rather than leaving it to be diagnosed from journalctl.
if command -v docker >/dev/null 2>&1 && docker inspect pelican-rabbitmq >/dev/null 2>&1; then
  project="$(docker inspect pelican-rabbitmq \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
  if [ -z "$project" ]; then
    cat >&2 <<'WARN'

A container named pelican-rabbitmq exists but was not created by compose.

pelican-broker runs `docker compose up`, which cannot claim a name that is
already taken, so the unit will restart in a loop until you remove it:

    docker rm -f pelican-rabbitmq

WARN
  fi
fi

cat <<EOF

Installed to $unit_dir, for the repository at $repo.

  systemctl --user start pelican.target     start the whole stack
  systemctl --user status pelican.target    what is up
  systemctl --user stop pelican.target      stop the whole stack

Then open http://localhost:5173 — the scene appears as soon as the first
WorldState arrives, a second or two after starting.

To start the stack at login:

  systemctl --user enable pelican.target

and, only if you want it running before you log in as well:

  loginctl enable-linger $USER
EOF
