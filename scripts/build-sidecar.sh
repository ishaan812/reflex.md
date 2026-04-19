#!/usr/bin/env bash
# Build the Rust capture sidecar and copy the binary into
# electron/resources/ so the Electron main process can spawn it.
#
# Usage:
#   scripts/build-sidecar.sh [--release]
#
# Defaults to a release build. Pass --debug for a faster incremental dev build.

set -euo pipefail

profile="release"
for arg in "$@"; do
  case "$arg" in
    --release) profile="release" ;;
    --debug)   profile="dev" ;;
    -h|--help)
      echo "Usage: $0 [--release|--debug]"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rust_dir="$root_dir/rust"
out_dir="$root_dir/electron/resources"
mkdir -p "$out_dir"

cargo_profile_flag=""
cargo_subdir="debug"
if [ "$profile" = "release" ]; then
  cargo_profile_flag="--release"
  cargo_subdir="release"
fi

echo "==> cargo build $cargo_profile_flag  (cwd: $rust_dir)"
(cd "$rust_dir" && cargo build $cargo_profile_flag)

src_bin="$rust_dir/target/$cargo_subdir/reflex-capture"
dest_bin="$out_dir/capture"

if [ ! -f "$src_bin" ]; then
  echo "error: expected binary at $src_bin" >&2
  exit 1
fi

cp "$src_bin" "$dest_bin"
chmod +x "$dest_bin"
echo "==> copied $src_bin → $dest_bin"
ls -lh "$dest_bin"
