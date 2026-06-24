param(
  [string]$ProjectRoot = "C:\code\clean-pay",
  [string]$HostName = "host1.clear-vpn.org",
  [int]$Port = 6088,
  [string]$User = "root",
  [string]$AskPassPath = "work\cleanpay_askpass.cmd"
)

$ErrorActionPreference = "Stop"

$workDir = Resolve-Path "work"
$archive = Join-Path $workDir "clean-pay-teststand.tar.gz"
$knownHosts = Join-Path $workDir "known_hosts_cleanpay"
$ask = (Resolve-Path $AskPassPath).Path

$env:SSH_ASKPASS = $ask
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy"

if (Test-Path $archive) {
  Remove-Item -LiteralPath $archive -Force
}

tar -czf $archive `
  -C $ProjectRoot `
  --exclude ".git" `
  --exclude "node_modules" `
  --exclude ".next" `
  --exclude "work" `
  --exclude ".env" `
  --exclude ".env.local" `
  --exclude ".env.production" `
  .

scp -P $Port `
  -o PreferredAuthentications=password `
  -o PubkeyAuthentication=no `
  -o NumberOfPasswordPrompts=1 `
  -o StrictHostKeyChecking=no `
  -o UserKnownHostsFile="$knownHosts" `
  $archive "${User}@${HostName}:/opt/clean-pay-teststand.tar.gz"

scp -P $Port `
  -o PreferredAuthentications=password `
  -o PubkeyAuthentication=no `
  -o NumberOfPasswordPrompts=1 `
  -o StrictHostKeyChecking=no `
  -o UserKnownHostsFile="$knownHosts" `
  (Resolve-Path "work\docker-compose.teststand.yml").Path "${User}@${HostName}:/tmp/docker-compose.teststand.yml"

scp -P $Port `
  -o PreferredAuthentications=password `
  -o PubkeyAuthentication=no `
  -o NumberOfPasswordPrompts=1 `
  -o StrictHostKeyChecking=no `
  -o UserKnownHostsFile="$knownHosts" `
  (Resolve-Path "work\deploy-clean-pay-teststand.sh").Path "${User}@${HostName}:/tmp/deploy-clean-pay-teststand.sh"

scp -P $Port `
  -o PreferredAuthentications=password `
  -o PubkeyAuthentication=no `
  -o NumberOfPasswordPrompts=1 `
  -o StrictHostKeyChecking=no `
  -o UserKnownHostsFile="$knownHosts" `
  (Resolve-Path "work\patch-caddy-clean-pay.sh").Path "${User}@${HostName}:/tmp/patch-caddy-clean-pay.sh"

$remoteScript = @'
set -eu

APP_DIR=/opt/clean-pay
ARCHIVE=/opt/clean-pay-teststand.tar.gz
REMNASHOP_DIR=/opt/remnashop

if [ -f "$REMNASHOP_DIR/.env" ]; then
  cd "$REMNASHOP_DIR"
  cp .env ".env.bak.clean-pay-web.$(date +%F_%H-%M-%S)"
  APP_API_KEY_VALUE="$(openssl rand -hex 32)"
  APP_JWT_SECRET_VALUE="$(openssl rand -hex 32)"
  APP_API_KEY_VALUE="$APP_API_KEY_VALUE" APP_JWT_SECRET_VALUE="$APP_JWT_SECRET_VALUE" python3 - <<'PY'
from pathlib import Path
import os

path = Path(".env")
lines = path.read_text(encoding="utf-8").splitlines()
updates = {
    "WEB_ENABLED": "true",
    "WEB_CABINET_URL": "https://oplata.clear-vpn.org",
}

if not any(line.startswith("APP_API_KEY=") for line in lines):
    updates["APP_API_KEY"] = os.environ["APP_API_KEY_VALUE"]

if not any(line.startswith("APP_JWT_SECRET=") for line in lines):
    updates["APP_JWT_SECRET"] = os.environ["APP_JWT_SECRET_VALUE"]

seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else None
    if key in updates or (key and key.startswith("#") and key[1:] in updates):
        clean_key = key[1:] if key.startswith("#") else key
        out.append(f"{clean_key}={updates[clean_key]}")
        seen.add(clean_key)
    else:
        out.append(line)

insert_after = len(out)
for idx, line in enumerate(out):
    if line.startswith("APP_CRYPT_KEY="):
        insert_after = idx + 1
        break

missing_secret_lines = []
for key in ("APP_API_KEY", "APP_JWT_SECRET"):
    if key in updates and key not in seen:
        missing_secret_lines.append(f"{key}={updates[key]}")
        seen.add(key)

if missing_secret_lines:
    out[insert_after:insert_after] = missing_secret_lines

for key in ("WEB_ENABLED", "WEB_CABINET_URL"):
    if key not in seen:
        out.append(f"{key}={updates[key]}")

path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
  docker compose --env-file .env -f docker-compose.yml up -d --force-recreate remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
fi

if [ -d "$APP_DIR" ]; then
  cp -a "$APP_DIR" "/opt/clean-pay.backup.$(date +%F_%H-%M-%S)"
  if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" /tmp/clean-pay.env.keep
  fi
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
tar -xzf "$ARCHIVE" -C "$APP_DIR"

if [ -f /tmp/clean-pay.env.keep ]; then
  mv /tmp/clean-pay.env.keep "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

mv /tmp/docker-compose.teststand.yml "$APP_DIR/docker-compose.teststand.yml"
mv /tmp/deploy-clean-pay-teststand.sh "$APP_DIR/deploy-clean-pay-teststand.sh"
mv /tmp/patch-caddy-clean-pay.sh "$APP_DIR/patch-caddy-clean-pay.sh"
chmod +x "$APP_DIR/deploy-clean-pay-teststand.sh" "$APP_DIR/patch-caddy-clean-pay.sh"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: create $APP_DIR/.env with production secrets before running deployment."
  exit 1
fi

cd "$APP_DIR"
./deploy-clean-pay-teststand.sh
./patch-caddy-clean-pay.sh
docker restart caddy
docker ps --filter name=clean-pay --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sS http://127.0.0.1:4010/api/health
'@

ssh -n -p $Port `
  -o PreferredAuthentications=password `
  -o PubkeyAuthentication=no `
  -o NumberOfPasswordPrompts=1 `
  -o StrictHostKeyChecking=no `
  -o UserKnownHostsFile="$knownHosts" `
  "${User}@${HostName}" "$remoteScript"
