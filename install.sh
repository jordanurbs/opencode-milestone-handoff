#!/usr/bin/env bash
#
# Installer for the OpenCode Milestone Handoff plugin.
# Copies the plugin into your GLOBAL OpenCode config and appends the AGENTS.md
# instruction. Safe to run multiple times (idempotent).
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
PLUGIN_SRC="$REPO_DIR/opencode/plugins/handoff.ts"
SNIPPET_SRC="$REPO_DIR/opencode/AGENTS.snippet.md"
MARKER="## Multi-step plans and handoff"

echo "==> Installing to: $CONFIG_DIR"
mkdir -p "$CONFIG_DIR/plugins"

echo "==> Copying plugin -> $CONFIG_DIR/plugins/handoff.ts"
cp "$PLUGIN_SRC" "$CONFIG_DIR/plugins/handoff.ts"

AGENTS_FILE="$CONFIG_DIR/AGENTS.md"
if [ -f "$AGENTS_FILE" ] && grep -qF "$MARKER" "$AGENTS_FILE"; then
  echo "==> AGENTS.md already contains the handoff instruction; leaving it as-is."
else
  echo "==> Appending handoff instruction -> $AGENTS_FILE"
  {
    [ -f "$AGENTS_FILE" ] && printf '\n'
    cat "$SNIPPET_SRC"
  } >>"$AGENTS_FILE"
fi

cat <<'EOF'

==> Done.

Next steps (a human must do these):
  1. Restart OpenCode  (plugins load at startup).
  2. Optional: set a threshold, e.g.  export OPENCODE_HANDOFF_THRESHOLD=0.15
  3. Start a task and cross the threshold to see a "Handoff: ..." session appear.

Uninstall:  rm "$CONFIG_DIR/plugins/handoff.ts"  (and remove the AGENTS.md section).
EOF
