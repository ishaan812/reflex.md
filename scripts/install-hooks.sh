#!/usr/bin/env bash
# Install Reflex capture hooks on macOS:
#   1. Add the Reflex local CA to the System keychain (trustRoot)
#   2. Set the HTTP/HTTPS proxy on the primary network service (catches
#      apps that honor macOS system proxy, e.g. Safari, most URLSession apps)
#   3. Install a pf rdr anchor that redirects local outbound :443 to the
#      transparent listener (catches apps that bypass env + system proxy,
#      e.g. Bun-compiled binaries like opencode, Go clients, Claude Code CLI)
#
# Intended to be run via sudo-prompt from the Electron shell on first launch.
# Can also be run manually:
#
#   scripts/install-hooks.sh --ca /path/to/reflex-ca.pem
#
# Use --uninstall to reverse everything.

set -euo pipefail

CA_PATH=""
PROXY_HOST="127.0.0.1"
PROXY_PORT="8888"
TRANSPARENT_PORT="8889"
UNINSTALL=0
PF_ONLY=0
NO_PF=0
INJECT_SHELL=1
SHELL_USER="${SUDO_USER:-${USER:-}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ca)               CA_PATH="$2"; shift 2 ;;
    --proxy-host)       PROXY_HOST="$2"; shift 2 ;;
    --proxy-port)       PROXY_PORT="$2"; shift 2 ;;
    --transparent-port) TRANSPARENT_PORT="$2"; shift 2 ;;
    --uninstall)        UNINSTALL=1; shift ;;
    --pf-only)          PF_ONLY=1; shift ;;
    --no-pf)            NO_PF=1; shift ;;
    --no-shell)         INJECT_SHELL=0; shift ;;
    --shell-user)       SHELL_USER="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [options]
  --ca <path>               Reflex CA PEM (required unless --uninstall)
  --proxy-host <host>       default 127.0.0.1
  --proxy-port <port>       default 8888  (hudsucker HTTP(S) proxy)
  --transparent-port <port> default 8889  (raw TLS listener for pf redirect)
  --uninstall               remove CA + disable proxy + flush pf anchor
  --pf-only                 only touch the pf anchor (skip CA + system proxy)
  --no-pf                   skip the pf anchor; only CA + system proxy
  --no-shell                skip writing HTTPS_PROXY / NODE_EXTRA_CA_CERTS into ~/.zshenv
  --shell-user <name>       target user whose ~/.zshenv gets patched (default: \$SUDO_USER)
EOF
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root (it modifies the System keychain and network prefs)." >&2
  exit 1
fi

primary_service() {
  # Pick the network service whose Device matches the default route.
  # macOS ships BSD awk (no gawk 3-arg match), so we do state-tracking:
  #   "(1) Wi-Fi"
  #   "(Hardware Port: Wi-Fi, Device: en0)"
  # → remember the service name from the "(N) Name" line, then check the
  # next "Device: X" line.
  local dev
  dev="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  if [ -z "$dev" ]; then
    echo "Wi-Fi"
    return
  fi
  networksetup -listnetworkserviceorder | awk -v d="$dev" '
    /^\([0-9]+\) / {
      name = $0
      sub(/^\([0-9]+\) /, "", name)
    }
    /Device:/ {
      line = $0
      sub(/.*Device: /, "", line)
      sub(/\).*/, "", line)
      if (line == d) { print name; exit }
    }
  '
}

SERVICE="$(primary_service)"
if [ -z "$SERVICE" ]; then
  echo "could not determine primary network service; defaulting to Wi-Fi" >&2
  SERVICE="Wi-Fi"
fi
echo "==> primary network service: $SERVICE"

install_ca() {
  [ -n "$CA_PATH" ] || { echo "missing --ca"; exit 2; }
  [ -f "$CA_PATH" ] || { echo "CA file not found: $CA_PATH"; exit 2; }
  echo "==> trusting CA: $CA_PATH"
  security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain \
    "$CA_PATH"
}

uninstall_ca() {
  echo "==> removing Reflex CA from System keychain"
  # Best-effort: remove by CN. We set CN = "Reflex Local MITM CA" in rust/src/ca.rs.
  security delete-certificate -c "Reflex Local MITM CA" \
    /Library/Keychains/System.keychain 2>/dev/null || true
}

SHELL_MARK_BEGIN="# >>> reflex-capture env (added by scripts/install-hooks.sh) >>>"
SHELL_MARK_END="# <<< reflex-capture env <<<"

target_home() {
  if [ -z "$SHELL_USER" ] || [ "$SHELL_USER" = "root" ]; then
    echo "$HOME"
    return
  fi
  dscl . -read "/Users/$SHELL_USER" NFSHomeDirectory 2>/dev/null \
    | awk -F': ' '/NFSHomeDirectory:/ {print $2}'
}

inject_shell_env() {
  [ "$INJECT_SHELL" -eq 1 ] || return 0
  [ -n "$CA_PATH" ] || return 0

  local home zshenv
  home="$(target_home)"
  [ -n "$home" ] || { echo "==> shell inject skipped: no target home"; return 0; }
  zshenv="$home/.zshenv"

  echo "==> injecting HTTPS_PROXY + NODE_EXTRA_CA_CERTS into $zshenv"

  # Strip any previous reflex block first (idempotent re-runs).
  if [ -f "$zshenv" ]; then
    awk -v b="$SHELL_MARK_BEGIN" -v e="$SHELL_MARK_END" '
      index($0, b) { skip=1 }
      !skip { print }
      index($0, e) { skip=0 }
    ' "$zshenv" > "$zshenv.tmp" && mv "$zshenv.tmp" "$zshenv"
  fi

  {
    echo ""
    echo "$SHELL_MARK_BEGIN"
    echo "# These env vars route AI-tool HTTPS traffic through the Reflex proxy"
    echo "# so the sidecar can capture request/response bodies. Remove with:"
    echo "#   sudo bash scripts/install-hooks.sh --uninstall"
    echo "export HTTPS_PROXY=\"http://$PROXY_HOST:$PROXY_PORT\""
    echo "export HTTP_PROXY=\"http://$PROXY_HOST:$PROXY_PORT\""
    echo "export ALL_PROXY=\"http://$PROXY_HOST:$PROXY_PORT\""
    echo "# Trust the Reflex CA for Node, Bun, and most OpenSSL-based tools:"
    echo "export NODE_EXTRA_CA_CERTS=\"$CA_PATH\""
    echo "export SSL_CERT_FILE=\"$CA_PATH\""
    echo "export REQUESTS_CA_BUNDLE=\"$CA_PATH\""
    echo "export CURL_CA_BUNDLE=\"$CA_PATH\""
    echo "# Don't proxy loopback so the sidecar itself can talk to origins"
    echo "# (redundant with pf's \`user != _reflex\` rule, belt-and-braces):"
    echo "export NO_PROXY=\"127.0.0.1,localhost,::1\""
    echo "$SHELL_MARK_END"
  } >> "$zshenv"

  # Keep ownership + mode sensible when run under sudo.
  if [ -n "$SHELL_USER" ] && [ "$SHELL_USER" != "root" ]; then
    chown "$SHELL_USER" "$zshenv" 2>/dev/null || true
  fi
  chmod 644 "$zshenv"
}

strip_shell_env() {
  local home zshenv
  home="$(target_home)"
  [ -n "$home" ] || return 0
  zshenv="$home/.zshenv"
  [ -f "$zshenv" ] || return 0
  if grep -q "$SHELL_MARK_BEGIN" "$zshenv"; then
    echo "==> removing reflex env block from $zshenv"
    awk -v b="$SHELL_MARK_BEGIN" -v e="$SHELL_MARK_END" '
      index($0, b) { skip=1 }
      !skip { print }
      index($0, e) { skip=0 }
    ' "$zshenv" > "$zshenv.tmp" && mv "$zshenv.tmp" "$zshenv"
    if [ -n "$SHELL_USER" ] && [ "$SHELL_USER" != "root" ]; then
      chown "$SHELL_USER" "$zshenv" 2>/dev/null || true
    fi
  fi
}

enable_proxy() {
  echo "==> setting proxy on '$SERVICE' → $PROXY_HOST:$PROXY_PORT"
  networksetup -setwebproxy       "$SERVICE" "$PROXY_HOST" "$PROXY_PORT"
  networksetup -setsecurewebproxy "$SERVICE" "$PROXY_HOST" "$PROXY_PORT"
  networksetup -setwebproxystate       "$SERVICE" on
  networksetup -setsecurewebproxystate "$SERVICE" on
}

disable_proxy() {
  echo "==> disabling proxy on '$SERVICE'"
  networksetup -setwebproxystate       "$SERVICE" off || true
  networksetup -setsecurewebproxystate "$SERVICE" off || true
}

PF_ANCHOR="reflex"
PF_RULES="/etc/pf.anchors/reflex.rules"
PF_MAIN="/etc/pf.conf"
PF_MAIN_BACKUP="/etc/pf.conf.reflex-backup"

# Dedicated system user the sidecar runs as. We exclude this user from
# the pf redirect so the sidecar's own outbound connections to real
# origins don't loop back into the interceptor.
REFLEX_USER="_reflex"
REFLEX_UID="401"
REFLEX_GID="401"
REFLEX_GROUP="_reflex"

pf_active_iface() {
  route -n get default 2>/dev/null | awk '/interface:/{print $2}'
}

ensure_reflex_user() {
  if id -u "$REFLEX_USER" >/dev/null 2>&1; then
    echo "==> system user $REFLEX_USER already exists (uid=$(id -u $REFLEX_USER))"
    return
  fi
  echo "==> creating system user $REFLEX_USER (uid=$REFLEX_UID)"

  # Group first
  if ! dscl . -read "/Groups/$REFLEX_GROUP" >/dev/null 2>&1; then
    dscl . -create "/Groups/$REFLEX_GROUP"
    dscl . -create "/Groups/$REFLEX_GROUP" PrimaryGroupID "$REFLEX_GID"
    dscl . -create "/Groups/$REFLEX_GROUP" RealName "Reflex capture"
    dscl . -create "/Groups/$REFLEX_GROUP" Password "*"
  fi

  # User
  dscl . -create "/Users/$REFLEX_USER"
  dscl . -create "/Users/$REFLEX_USER" UserShell /usr/bin/false
  dscl . -create "/Users/$REFLEX_USER" RealName "Reflex capture sidecar"
  dscl . -create "/Users/$REFLEX_USER" UniqueID "$REFLEX_UID"
  dscl . -create "/Users/$REFLEX_USER" PrimaryGroupID "$REFLEX_GID"
  dscl . -create "/Users/$REFLEX_USER" NFSHomeDirectory /var/empty
  dscl . -create "/Users/$REFLEX_USER" Password "*"
  # Hide from the macOS login picker
  dscl . -create "/Users/$REFLEX_USER" IsHidden 1
}

remove_reflex_user() {
  if id -u "$REFLEX_USER" >/dev/null 2>&1; then
    echo "==> removing system user $REFLEX_USER"
    dscl . -delete "/Users/$REFLEX_USER" 2>/dev/null || true
  fi
  if dscl . -read "/Groups/$REFLEX_GROUP" >/dev/null 2>&1; then
    dscl . -delete "/Groups/$REFLEX_GROUP" 2>/dev/null || true
  fi
}

install_pf() {
  ensure_reflex_user
  local iface; iface="$(pf_active_iface)"; iface="${iface:-en0}"
  echo "==> writing pf anchor '$PF_ANCHOR' ($PF_RULES)"
  echo "    iface=$iface, redirect :443 → $PROXY_HOST:$TRANSPARENT_PORT, bypass user=$REFLEX_USER"

  # Anchor body. Two-phase capture on macOS pf:
  #
  #   1. rdr on lo0 rewrites dst to 127.0.0.1:<transparent> for any :443
  #      packet entering lo0. This is the endpoint for redirected flows.
  #
  #   2. The filter rule forces locally-originated outbound :443 traffic
  #      (EXCEPT from the sidecar user) to be route-to'd via lo0, so it
  #      actually hits the rdr rule above. Without this, local outbound
  #      goes straight out en0 and never traverses any interface's IN
  #      chain where rdr fires.
  #
  # The `user != $REFLEX_USER` clause breaks the self-loop that would
  # otherwise arise when the sidecar's own outbound connection to the
  # real origin re-matches the route-to rule.
  cat > "$PF_RULES" <<EOF
# Reflex capture anchor — generated by scripts/install-hooks.sh
rdr pass on lo0 inet proto tcp from any to any port 443 -> $PROXY_HOST port $TRANSPARENT_PORT
rdr pass on $iface inet proto tcp from any to any port 443 -> $PROXY_HOST port $TRANSPARENT_PORT

pass out on $iface route-to (lo0 127.0.0.1) inet proto tcp from any to any port 443 user != $REFLEX_USER keep state
EOF

  # Ensure the main /etc/pf.conf references our anchor. Idempotent.
  if ! grep -q "rdr-anchor \"$PF_ANCHOR\"" "$PF_MAIN" 2>/dev/null; then
    if [ ! -f "$PF_MAIN_BACKUP" ]; then
      cp "$PF_MAIN" "$PF_MAIN_BACKUP"
      echo "==> backed up $PF_MAIN → $PF_MAIN_BACKUP"
    fi
    # In macOS pf.conf the anchor reference must appear in the right
    # section for its rule types. `rdr-anchor` goes in the translation
    # block; `anchor` (filter rules like pass/block) goes in the filter
    # block.  Appending both to the tail works because pf collates them.
    {
      echo ""
      echo "# reflex-capture: added by scripts/install-hooks.sh"
      echo "rdr-anchor \"$PF_ANCHOR\""
      echo "anchor \"$PF_ANCHOR\""
      echo "load anchor \"$PF_ANCHOR\" from \"$PF_RULES\""
    } >> "$PF_MAIN"
    echo "==> appended anchor reference to $PF_MAIN"
  fi

  echo "==> loading pf rules"
  pfctl -f "$PF_MAIN" 2>&1 | sed 's/^/    /' || true
  pfctl -E 2>&1 | sed 's/^/    /' || true

  echo "==> active pf rules in anchor '$PF_ANCHOR' (rdr):"
  pfctl -a "$PF_ANCHOR" -s nat 2>&1 | sed 's/^/    /' || true
  echo "==> active pf rules in anchor '$PF_ANCHOR' (filter):"
  pfctl -a "$PF_ANCHOR" -s rules 2>&1 | sed 's/^/    /' || true
}

uninstall_pf() {
  echo "==> flushing pf anchor '$PF_ANCHOR'"
  pfctl -a "$PF_ANCHOR" -F all 2>/dev/null || true

  if [ -f "$PF_MAIN_BACKUP" ]; then
    echo "==> restoring $PF_MAIN from $PF_MAIN_BACKUP"
    cp "$PF_MAIN_BACKUP" "$PF_MAIN"
    rm -f "$PF_MAIN_BACKUP"
    pfctl -f "$PF_MAIN" 2>&1 | sed 's/^/    /' || true
  else
    # No backup: remove our lines in place (best effort)
    if grep -q "reflex-capture: added by scripts/install-hooks.sh" "$PF_MAIN" 2>/dev/null; then
      echo "==> stripping reflex entries from $PF_MAIN"
      awk '
        /# reflex-capture: added by/ {skip=1; next}
        skip && /^$/ {skip=0; next}
        skip {next}
        {print}
      ' "$PF_MAIN" > "$PF_MAIN.tmp" && mv "$PF_MAIN.tmp" "$PF_MAIN"
      pfctl -f "$PF_MAIN" 2>&1 | sed 's/^/    /' || true
    fi
  fi

  rm -f "$PF_RULES"
  echo "==> removed $PF_RULES"
}

if [ "$UNINSTALL" -eq 1 ]; then
  [ "$PF_ONLY" -eq 1 ] || disable_proxy
  [ "$PF_ONLY" -eq 1 ] || uninstall_ca
  [ "$PF_ONLY" -eq 1 ] || strip_shell_env
  [ "$NO_PF" -eq 1 ] || uninstall_pf
  [ "$NO_PF" -eq 1 ] || remove_reflex_user
  echo "done: Reflex hooks removed."
else
  [ "$PF_ONLY" -eq 1 ] || install_ca
  [ "$PF_ONLY" -eq 1 ] || enable_proxy
  [ "$PF_ONLY" -eq 1 ] || inject_shell_env
  [ "$NO_PF" -eq 1 ] || install_pf
  echo "done: Reflex hooks installed."
  if [ "$NO_PF" -ne 1 ]; then
    cat <<NOTE

NOTE: The pf anchor excludes outbound traffic from user '$REFLEX_USER'
(uid $(id -u $REFLEX_USER 2>/dev/null || echo $REFLEX_UID)) to avoid a
redirect loop. Launch the sidecar as that user so its own TLS
connections to real origins are NOT redirected back into itself:

  sudo -u $REFLEX_USER /absolute/path/to/reflex-capture \\
    --proxy-port $PROXY_PORT --ws-port 9999 \\
    --transparent-port $TRANSPARENT_PORT \\
    --data-dir /var/run/reflex-capture

The data dir must be writable by '$REFLEX_USER'.
NOTE
  fi
fi
