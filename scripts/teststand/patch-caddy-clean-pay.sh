#!/bin/sh
set -eu

CADDYFILE=/opt/remnawave/caddy/Caddyfile

cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%F_%H-%M-%S)"

python3 - "$CADDYFILE" >/tmp/Caddyfile.cleanpay <<'PY'
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
lines = text.splitlines()
out = []
i = 0

while i < len(lines):
    line = lines[i]
    if line.strip().startswith("oplata.clear-vpn.org") and "{" in line:
        depth = line.count("{") - line.count("}")
        i += 1
        while i < len(lines) and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            i += 1
        continue
    out.append(line)
    i += 1

while out and not out[-1].strip():
    out.pop()

out.extend(
    [
        "",
        "oplata.clear-vpn.org {",
        "  encode gzip zstd",
        "  reverse_proxy clean-pay-web:3000 {",
        "    header_up Host {host}",
        "    header_up X-Forwarded-Host {host}",
        "    header_up X-Forwarded-Proto {scheme}",
        "    header_up X-Forwarded-Port 443",
        "    header_up X-Real-IP {remote_host}",
        "    header_up X-Forwarded-For {remote_host}",
        "  }",
        "}",
    ]
)

print("\n".join(out) + "\n")
PY

cat /tmp/Caddyfile.cleanpay >"$CADDYFILE"
rm -f /tmp/Caddyfile.cleanpay
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile || docker restart caddy
