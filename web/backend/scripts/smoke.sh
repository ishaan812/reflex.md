#!/usr/bin/env bash
set -euo pipefail

HOST="${BACKEND_ORIGIN:-http://localhost:3001}"

echo "[smoke] GET $HOST/api/health"
RESP=$(curl -sf "$HOST/api/health")
echo "  -> $RESP"
if [[ "$RESP" != *'"ok":true'* ]]; then
  echo "FAIL: health did not return ok=true"
  exit 1
fi

echo "[smoke] GET $HOST/api/me (expect 401)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HOST/api/me")
echo "  -> HTTP $CODE"
if [[ "$CODE" != "401" ]]; then
  echo "FAIL: /api/me should return 401 without a cookie, got $CODE"
  exit 1
fi

echo "[smoke] all checks passed"
