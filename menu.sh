#!/usr/bin/env bash
# Clean Pay: interactive menu for installation, updates and backups.
#
#   ./menu.sh                 open the interactive menu
#   ./menu.sh status          print the status of Clean Pay and Remnashop
#   ./menu.sh backup [REASON] create a full verified backup (suitable for cron)
#   ./menu.sh verify DIR      verify an existing backup
#
# The menu only orchestrates reviewed entry points (deploy.sh, docker compose,
# git). Every global action (install or update of Clean Pay or Remnashop)
# starts with a mandatory full backup and stops if the backup fails.

# Menu actions are dispatched by name through run_action.
# shellcheck disable=SC2317,SC2329

set -uo pipefail
umask 077

# Run from a private copy: updating the checkout replaces this file, and bash
# reads scripts incrementally while they execute.
if [ -z "${CLEAN_PAY_MENU_ROOT:-}" ]; then
  menu_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
  menu_copy=$(mktemp "${TMPDIR:-/tmp}/clean-pay-menu.XXXXXX") || exit 1
  cat -- "${BASH_SOURCE[0]}" > "$menu_copy" || exit 1
  CLEAN_PAY_MENU_ROOT=$menu_root CLEAN_PAY_MENU_COPY=$menu_copy exec bash "$menu_copy" "$@"
fi
if [ -n "${CLEAN_PAY_MENU_COPY:-}" ] && [ "${CLEAN_PAY_MENU_COPY}" = "${BASH_SOURCE[0]}" ]; then
  trap 'rm -f -- "$CLEAN_PAY_MENU_COPY"' EXIT
fi

# Width calculations below count characters, which needs a UTF-8 locale.
case "$(locale charmap 2>/dev/null)" in
  UTF-8|utf8) ;;
  *) if locale -a 2>/dev/null | grep -qiE '^c[.]utf-?8$'; then export LC_ALL=C.UTF-8; fi ;;
esac

ROOT_DIR=$CLEAN_PAY_MENU_ROOT
DEPLOY_SCRIPT="$ROOT_DIR/deploy.sh"
ENV_FILE="$ROOT_DIR/deploy/prod/.env"
MENU_CONF="$ROOT_DIR/deploy/prod/menu.env"
RUNBOOK="$ROOT_DIR/deploy/prod/zero-downtime-production-runbook.md"
REMNASHOP_CHECK_SCRIPT="$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh"
NODE_TOOLING_SCRIPT="$ROOT_DIR/deploy/prod/node-tooling.sh"
CREDENTIAL_GUARD_SCRIPT="$ROOT_DIR/deploy/prod/credential-file-guard.mjs"
SCREEN_SESSION=clean-pay-menu
LAST_BACKUP_DIR=''

# ─── Оформление ─────────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

RULE='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

say() { printf '%s\n' "$*"; }
ok() { printf '  %s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err() { printf '  %s✘%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die() { err "$*"; exit 1; }
note() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
step() { printf '\n%s[%s/%s]%s %s%s%s\n' "$C_CYAN" "$1" "$2" "$C_RESET" "$C_BOLD" "$3" "$C_RESET"; }

title() {
  printf '\n%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
  printf '  %s%s%s\n' "$C_BOLD" "$1" "$C_RESET"
  [ -z "${2:-}" ] || printf '  %s%s%s\n' "$C_DIM" "$2" "$C_RESET"
  printf '%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
}

# printf pads by bytes; pad by characters so Cyrillic columns stay aligned.
pad() {
  local text=$1 width=$2
  printf '%s' "$text"
  [ "${#text}" -ge "$width" ] || printf '%*s' "$(( width - ${#text} ))" ''
}

kv() { printf '  %s %s\n' "$(pad "$1" 22)" "$2"; }

is_interactive() { [ -t 0 ] && [ -t 1 ]; }

pause() {
  is_interactive || return 0
  printf '\n%sНажмите Enter, чтобы вернуться в меню…%s' "$C_DIM" "$C_RESET"
  IFS= read -r _ || true
}

ask_yes_no() {
  local question=$1 default=${2:-no} suffix answer
  if [ "$default" = yes ]; then suffix='[Д/н]'; else suffix='[д/Н]'; fi
  while :; do
    printf '  %s %s ' "$question" "$suffix"
    IFS= read -r answer || answer=''
    case "$answer" in
      д|Д|да|Да|ДА|y|Y|yes|Yes|YES) return 0 ;;
      н|Н|нет|Нет|НЕТ|n|N|no|No|NO) return 1 ;;
      '') [ "$default" = yes ]; return ;;
      *) say '  Ответьте «да» или «нет».' ;;
    esac
  done
}

# Prints the answer; the prompt goes to stderr so callers can capture stdout.
ask_value() {
  local question=$1 default=${2:-} answer
  if [ -n "$default" ]; then
    printf '  %s [%s]: ' "$question" "$default" >&2
  else
    printf '  %s: ' "$question" >&2
  fi
  IFS= read -r answer || answer=''
  [ -n "$answer" ] || answer=$default
  printf '%s' "$answer"
}

ask_secret() {
  local question=$1 answer stty_state=''
  printf '  %s (ввод скрыт): ' "$question" >&2
  if command -v stty >/dev/null 2>&1; then
    stty_state=$(stty -g 2>/dev/null || true)
    stty -echo 2>/dev/null || true
  fi
  IFS= read -r answer || answer=''
  [ -z "$stty_state" ] || stty "$stty_state" 2>/dev/null || true
  printf '\n' >&2
  printf '%s' "$answer"
}

# Destructive actions require typing a word, not just pressing Enter.
type_to_confirm() {
  local word=$1 answer
  printf '  Чтобы продолжить, введите %s%s%s: ' "$C_BOLD" "$word" "$C_RESET"
  IFS= read -r answer || answer=''
  [ "$answer" = "$word" ]
}

# Runs one menu action in a subshell with errexit, so a failure returns to the
# menu with a clear message instead of closing the whole program.
run_action() {
  ( set -euo pipefail; "$@" )
  local status=$?
  if [ "$status" -eq 0 ]; then
    printf '\n%s✔ Готово.%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '\n%s✘ Действие не выполнено (код %s). Подробности — выше.%s\n' "$C_RED" "$status" "$C_RESET"
  fi
  return "$status"
}

# Same isolation for read-only screens, without the "done" footer.
run_view() {
  ( set -euo pipefail; "$@" ) && return 0
  printf '\n%s✘ Не удалось показать данные. Подробности — выше.%s\n' "$C_RED" "$C_RESET"
  return 1
}

# ─── Настройки ──────────────────────────────────────────────────────────────

# Reads one KEY=value from an env-style file without sourcing it.
env_get() {
  local file=$1 name=$2 fallback=${3:-} value=''
  if [ -f "$file" ] && [ -r "$file" ]; then
    value=$({ grep -E "^${name}=" "$file" 2>/dev/null || true; } | tail -n 1 \
      | sed -e "s/^${name}=//" -e 's/\r$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  fi
  if [ -n "$value" ]; then printf '%s' "$value"; else printf '%s' "$fallback"; fi
}

cp_env() { env_get "$ENV_FILE" "$1" "${2:-}"; }

load_settings() {
  local remnashop_env
  remnashop_env=$(cp_env REMNASHOP_ENV_FILE /opt/remnashop/.env)
  BACKUP_DIR=$(env_get "$MENU_CONF" BACKUP_DIR /var/backups/clean-pay)
  REMNASHOP_DIR=$(env_get "$MENU_CONF" REMNASHOP_DIR "$(dirname -- "$remnashop_env")")
  REMNASHOP_REPO=$(env_get "$MENU_CONF" REMNASHOP_REPO https://github.com/flake92/remnashop.git)
  REMNASHOP_SOURCES=$(env_get "$MENU_CONF" REMNASHOP_SOURCES /opt/deploy-sources/remnashop.git)
  REMNASHOP_STAGING=$(env_get "$MENU_CONF" REMNASHOP_STAGING /opt/deploy-staging)
  REMNASHOP_IMAGE=$(env_get "$MENU_CONF" REMNASHOP_IMAGE remnashop)
  REMNASHOP_TAG_PREFIX=$(env_get "$MENU_CONF" REMNASHOP_TAG_PREFIX clean-pay-prod-)
  CADDYFILE=$(env_get "$MENU_CONF" CADDYFILE '')
  RS_API=$(cp_env REMNASHOP_API_CONTAINER remnashop)
  RS_WORKER=$(cp_env REMNASHOP_WORKER_CONTAINER remnashop-taskiq-worker)
  RS_SCHEDULER=$(cp_env REMNASHOP_SCHEDULER_CONTAINER remnashop-taskiq-scheduler)
  RS_DB=$(cp_env REMNASHOP_POSTGRES_CONTAINER remnashop-db)
  RS_COMPOSE="$REMNASHOP_DIR/docker-compose.yml"
}

save_settings() {
  local tmp
  tmp=$(mktemp "$MENU_CONF.XXXXXX") || return 1
  {
    printf '# Настройки menu.sh. Секретов здесь нет; файл не отслеживается git.\n'
    printf 'BACKUP_DIR=%s\n' "$BACKUP_DIR"
    printf 'REMNASHOP_DIR=%s\n' "$REMNASHOP_DIR"
    printf 'REMNASHOP_REPO=%s\n' "$REMNASHOP_REPO"
    printf 'REMNASHOP_SOURCES=%s\n' "$REMNASHOP_SOURCES"
    printf 'REMNASHOP_STAGING=%s\n' "$REMNASHOP_STAGING"
    printf 'REMNASHOP_IMAGE=%s\n' "$REMNASHOP_IMAGE"
    printf 'REMNASHOP_TAG_PREFIX=%s\n' "$REMNASHOP_TAG_PREFIX"
    printf 'CADDYFILE=%s\n' "$CADDYFILE"
  } > "$tmp" && chmod 600 "$tmp" && mv -f -- "$tmp" "$MENU_CONF"
}

valid_abs_path() { case "$1" in /*) [ "$1" != / ] && ! printf '%s' "$1" | grep -q '[[:space:]]' ;; *) return 1 ;; esac; }

# ─── Окружение и Docker ─────────────────────────────────────────────────────

have() { command -v "$1" >/dev/null 2>&1; }

docker_ok() { have docker && docker version --format '{{.Server.Version}}' >/dev/null 2>&1; }

need_docker() {
  have docker || die 'Docker не установлен. Установка: curl -fsSL https://get.docker.com | sh'
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die 'Docker установлен, но демон недоступен (запущен ли он, есть ли права?).'
  docker compose version >/dev/null 2>&1 || die 'Нет плагина Docker Compose v2.'
}

need_git() { have git || die 'Не найден git.'; }

cp_installed() { [ -f "$ENV_FILE" ]; }

cp_project() { cp_env COMPOSE_PROJECT_NAME clean-pay-prod; }

cp_container() {
  docker ps -a \
    --filter "label=com.docker.compose.project=$(cp_project)" \
    --filter "label=com.docker.compose.service=$1" \
    --format '{{.Names}}' 2>/dev/null | head -n 1
}

container_exists() { [ -n "$1" ] && docker inspect "$1" >/dev/null 2>&1; }

container_running() {
  [ -n "$1" ] && [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]
}

container_field() { docker inspect -f "$2" "$1" 2>/dev/null || true; }

container_revision() {
  container_field "$1" '{{index .Config.Labels "org.opencontainers.image.revision"}}'
}

short() { printf '%s' "${1:0:7}"; }

# One status line: "● name   работает · healthy   extra".
status_line() {
  local label=$1 name=$2 extra=${3:-} state health mark text
  if [ -z "$name" ] || ! container_exists "$name"; then
    printf '    %s○%s %-26s %sне найден%s\n' "$C_DIM" "$C_RESET" "$label" "$C_DIM" "$C_RESET"
    return
  fi
  state=$(container_field "$name" '{{.State.Status}}')
  health=$(container_field "$name" '{{if .State.Health}}{{.State.Health.Status}}{{end}}')
  case "$state:$health" in
    running:healthy|running:) mark="$C_GREEN●$C_RESET"; text='работает' ;;
    running:starting) mark="$C_YELLOW●$C_RESET"; text='запускается' ;;
    running:*) mark="$C_RED●$C_RESET"; text="работает, но $health" ;;
    *) mark="$C_RED●$C_RESET"; text="остановлен ($state)" ;;
  esac
  [ -z "$health" ] || text="$text · $health"
  printf '    %s %-26s %s%s\n' "$mark" "$label" "$text" "${extra:+   $C_DIM$extra$C_RESET}"
}

free_mb() {
  local dir=$1
  while [ ! -d "$dir" ] && [ "$dir" != / ]; do dir=$(dirname -- "$dir"); done
  df -Pk "$dir" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1024 }'
}

human_mb() { awk -v mb="$1" 'BEGIN { if (mb >= 1024) printf "%.1f ГБ", mb / 1024; else printf "%d МБ", mb }'; }

human_size() { du -sh -- "$1" 2>/dev/null | awk '{print $1}'; }

db_query() {
  docker exec "$1" sh -c 'exec psql -v ON_ERROR_STOP=1 -Atq -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$2"
}

journal() {
  mkdir -p "$BACKUP_DIR" 2>/dev/null || return 0
  printf '%s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$1" "$2" >> "$BACKUP_DIR/journal.log" 2>/dev/null || true
}

last_backup() {
  [ -d "$BACKUP_DIR" ] || return 0
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' 2>/dev/null \
    | sort | while IFS= read -r dir; do
        [ -f "$dir/SHA256SUMS" ] && printf '%s\n' "$dir"
      done | tail -n 1
}

age_of_backup() {
  local name stamp epoch now minutes
  name=$(basename -- "$1")
  stamp="${name:0:4}-${name:4:2}-${name:6:2} ${name:9:2}:${name:11:2}:${name:13:2}"
  epoch=$(date -d "$stamp" +%s 2>/dev/null) || { printf '%s' "${name:0:15}"; return; }
  now=$(date +%s)
  minutes=$(( (now - epoch) / 60 ))
  if [ "$minutes" -lt 60 ]; then printf '%s мин назад' "$minutes"
  elif [ "$minutes" -lt 2880 ]; then printf '%s ч назад' "$(( minutes / 60 ))"
  else printf '%s дн назад' "$(( minutes / 1440 ))"
  fi
}

# ─── Сводка в шапке меню ────────────────────────────────────────────────────

summary_component() {
  local label name=$2 detail=$3 state
  label=$(pad "$1" 11)
  if ! docker_ok; then
    printf '  %s %s?%s Docker недоступен\n' "$label" "$C_YELLOW" "$C_RESET"
    return
  fi
  if ! container_exists "$name"; then
    printf '  %s %s○ не установлен%s\n' "$label" "$C_DIM" "$C_RESET"
    return
  fi
  state=$(container_field "$name" '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}')
  case "$state" in
    running/healthy|running/) printf '  %s %s● работает%s   %s\n' "$label" "$C_GREEN" "$C_RESET" "$detail" ;;
    running/starting) printf '  %s %s● запускается%s   %s\n' "$label" "$C_YELLOW" "$C_RESET" "$detail" ;;
    *) printf '  %s %s● проблема: %s%s   %s\n' "$label" "$C_RED" "$state" "$C_RESET" "$detail" ;;
  esac
}

print_summary() {
  local app='' rev='' rs_rev='' backup free
  if docker_ok; then
    app=$(cp_container app)
    [ -z "$app" ] || rev=$(short "$(container_revision "$app")")
    rs_rev=$(short "$(container_revision "$RS_API")")
  fi
  summary_component 'Clean Pay' "$app" "${rev:+версия $rev}"
  summary_component 'Remnashop' "$RS_API" "${rs_rev:+версия $rs_rev}"
  free=$(free_mb "$ROOT_DIR")
  backup=$(last_backup)
  if [ -n "$backup" ]; then backup=$(age_of_backup "$backup"); else backup='нет'; fi
  printf '  %s %s свободно · последняя копия: %s\n' "$(pad 'Сервер' 11)" "$(human_mb "${free:-0}")" "$backup"
}

# ─── 1. Подробное состояние ─────────────────────────────────────────────────

show_status() {
  title 'Состояние Clean Pay и Remnashop'
  local head='' dirty='' url code alembic image_head app
  printf '\n  %sClean Pay%s\n' "$C_BOLD" "$C_RESET"
  kv 'Каталог' "$ROOT_DIR"
  if have git && head=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null); then
    dirty=$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all 2>/dev/null)
    kv 'Код (git)' "$(short "$head") $(git -C "$ROOT_DIR" log -1 --format='%cs %s' 2>/dev/null | cut -c1-60)"
    [ -z "$dirty" ] || kv '' "${C_YELLOW}есть незафиксированные изменения${C_RESET}"
  fi
  if cp_installed; then
    url=$(cp_env APP_URL)
    kv 'Адрес' "${url:-не задан}"
    kv 'Релиз' "$(cp_env CLEAN_PAY_RELEASE local)"
  else
    kv 'Настройки' "${C_YELLOW}deploy/prod/.env не найден — Clean Pay не установлен${C_RESET}"
  fi
  if docker_ok; then
    printf '  Контейнеры:\n'
    app=$(cp_container app)
    status_line app "$app" "$( [ -n "$app" ] && printf 'ревизия %s' "$(short "$(container_revision "$app")")" )"
    status_line retention-worker "$(cp_container retention-worker)"
    status_line reconciliation-worker "$(cp_container reconciliation-worker)"
    status_line postgres "$(cp_container postgres)"
    status_line redis "$(cp_container redis)"
  fi
  if [ -n "${url:-}" ] && have curl; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${url%/}/api/health/readiness" || true)
    if [ "$code" = 200 ]; then kv 'Readiness (внешняя)' "${C_GREEN}200 OK${C_RESET}"
    else kv 'Readiness (внешняя)' "${C_RED}${code:-нет ответа}${C_RESET}"
    fi
  fi

  printf '\n  %sRemnashop%s\n' "$C_BOLD" "$C_RESET"
  kv 'Каталог' "$REMNASHOP_DIR"
  if docker_ok; then
    status_line "$RS_API" "$RS_API" "$( container_exists "$RS_API" && printf 'ревизия %s' "$(short "$(container_revision "$RS_API")")" )"
    status_line "$RS_WORKER" "$RS_WORKER"
    status_line "$RS_SCHEDULER" "$RS_SCHEDULER"
    status_line "$RS_DB" "$RS_DB"
    status_line remnashop-redis remnashop-redis
    if container_running "$RS_DB"; then
      alembic=$(db_query "$RS_DB" 'SELECT version_num FROM alembic_version' 2>/dev/null || true)
      if container_exists "$RS_API"; then
        image_head=$(alembic_head "$(container_field "$RS_API" '{{.Image}}')")
      fi
      kv 'Схема БД (Alembic)' "${alembic:-?}${image_head:+ (в образе: $image_head)}"
    fi
  fi

  printf '\n  %sСервер%s\n' "$C_BOLD" "$C_RESET"
  kv 'Хост' "$(hostname 2>/dev/null)"
  local backup free min
  free=$(free_mb "$ROOT_DIR"); min=$(cp_env CLEAN_PAY_MIN_FREE_DISK_MB 8192)
  if [ "${free:-0}" -ge "$min" ]; then
    kv 'Свободно на диске' "$(human_mb "${free:-0}") (для сборки нужно ≥ $(human_mb "$min"))"
  else
    kv 'Свободно на диске' "${C_YELLOW}$(human_mb "${free:-0}") — меньше $(human_mb "$min"), нужных для сборки${C_RESET}"
  fi
  backup=$(last_backup)
  if [ -n "$backup" ]; then
    kv 'Последняя копия' "$(basename -- "$backup") ($(age_of_backup "$backup"))"
  else
    kv 'Последняя копия' 'нет'
  fi
}

# ─── 2. Проверка сервера ────────────────────────────────────────────────────

check_server() {
  title 'Проверка сервера' 'Ничего не меняет — только проверяет готовность'
  local problems=0 tool free min overcommit
  for tool in docker git curl openssl; do
    if have "$tool"; then ok "$tool установлен"; else err "$tool не найден"; problems=$((problems + 1)); fi
  done
  if have screen || have tmux; then ok 'screen/tmux есть — долгие операции переживут обрыв SSH'
  else warn 'Нет screen или tmux: при обрыве SSH долгая операция прервётся (apt install screen)'
  fi
  if docker_ok; then
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) работает"
    if docker compose version >/dev/null 2>&1; then ok 'Docker Compose v2 есть'; else err 'Нет Docker Compose v2'; problems=$((problems + 1)); fi
    if docker network inspect "$(cp_env CLEAN_PAY_EDGE_NETWORK remnawave-network)" >/dev/null 2>&1; then
      ok "Docker-сеть $(cp_env CLEAN_PAY_EDGE_NETWORK remnawave-network) существует"
    else
      warn "Docker-сети $(cp_env CLEAN_PAY_EDGE_NETWORK remnawave-network) пока нет (установщик создаст её)"
    fi
  else
    err 'Docker недоступен'; problems=$((problems + 1))
  fi
  free=$(free_mb "$ROOT_DIR"); min=$(cp_env CLEAN_PAY_MIN_FREE_DISK_MB 8192)
  if [ "${free:-0}" -ge "$min" ]; then ok "Свободно $(human_mb "$free") (нужно ≥ $(human_mb "$min"))"
  else
    warn "Свободно только $(human_mb "${free:-0}"), для сборки нужно ≥ $(human_mb "$min")."
    note '    deploy.sh сначала сам удалит кэш сборки и висящие образы; если не хватит — освободите место.'
  fi
  overcommit=$(cat /proc/sys/vm/overcommit_memory 2>/dev/null || printf '?')
  if [ "$overcommit" = 1 ]; then ok 'vm.overcommit_memory=1'
  else warn "vm.overcommit_memory=$overcommit (Redis требует 1: sysctl -w vm.overcommit_memory=1)"
  fi
  if cp_installed; then
    if [ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null)" = 600 ]; then ok 'deploy/prod/.env защищён (права 600)'
    else err 'deploy/prod/.env должен иметь права 600'; problems=$((problems + 1))
    fi
    if docker_ok && container_exists "$RS_API"; then
      note 'Проверка совместимости Remnashop (образ, схема, API)…'
      if sh "$REMNASHOP_CHECK_SCRIPT" "$ENV_FILE" check; then ok 'Remnashop совместим с Clean Pay'
      else err 'Remnashop не прошёл проверку совместимости'; problems=$((problems + 1))
      fi
    fi
  else
    note 'Clean Pay ещё не настроен — проверка Remnashop будет выполнена мастером установки.'
  fi
  if [ "$problems" -eq 0 ]; then say ''; ok 'Сервер готов.'; else say ''; err "Найдено проблем: $problems"; return 1; fi
}

# ─── 3. Логи ────────────────────────────────────────────────────────────────

show_logs() {
  need_docker
  title 'Логи сервисов' 'Ctrl+C — вернуться в меню'
  local choice name
  say '    1  Clean Pay — приложение (app)'
  say '    2  Clean Pay — retention-worker'
  say '    3  Clean Pay — reconciliation-worker'
  say "    4  Remnashop — API ($RS_API)"
  say "    5  Remnashop — worker ($RS_WORKER)"
  say "    6  Remnashop — scheduler ($RS_SCHEDULER)"
  say '    0  Назад'
  choice=$(ask_value 'Выберите' 1)
  case "$choice" in
    1) name=$(cp_container app) ;;
    2) name=$(cp_container retention-worker) ;;
    3) name=$(cp_container reconciliation-worker) ;;
    4) name=$RS_API ;;
    5) name=$RS_WORKER ;;
    6) name=$RS_SCHEDULER ;;
    *) return 0 ;;
  esac
  container_exists "$name" || die 'Контейнер не найден.'
  trap ':' INT
  docker logs --tail 200 -f "$name" 2>&1 || true
  trap - INT
}

# ─── Резервные копии ────────────────────────────────────────────────────────

detect_caddyfile() {
  [ -z "$CADDYFILE" ] || { printf '%s' "$CADDYFILE"; return; }
  local name
  { docker ps --format '{{.Names}}' 2>/dev/null || true; } | { grep -i caddy || true; } | while IFS= read -r name; do
    docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$name" 2>/dev/null
  done | head -n 1
}

copy_config() {
  local destination=$1 file
  shift
  mkdir -p "$destination"
  for file in "$@"; do
    case "$file" in *.example) continue ;; esac
    if [ -f "$file" ] && [ ! -L "$file" ]; then
      cp -p -- "$file" "$destination/" && note "  + $file"
    fi
  done
}

dump_database() {
  local container=$1 output=$2
  docker exec "$container" sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-password' > "$output"
}

dump_roles() {
  docker exec "$1" sh -c 'exec pg_dumpall -U "$POSTGRES_USER" --roles-only --no-password' > "$2"
}

verify_dump() {
  local container=$1 dump=$2 entries
  [ -s "$dump" ] || return 1
  entries=$(docker exec -i "$container" pg_restore --list < "$dump" 2>/dev/null | grep -cv '^;') || return 1
  [ "$entries" -gt 0 ] || return 1
  printf '%s' "$entries"
}

database_size_mb() {
  local bytes
  bytes=$(db_query "$1" 'SELECT pg_database_size(current_database())' 2>/dev/null || printf 0)
  printf '%d' "$(( ${bytes:-0} / 1048576 ))"
}

write_manifest() {
  local dir=$1 reason=$2 app rs_image
  app=$(cp_container app)
  rs_image=$(container_field "$RS_API" '{{.Config.Image}}')
  {
    printf 'created_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    printf 'reason=%s\n' "$reason"
    printf 'host=%s\n' "$(hostname 2>/dev/null)"
    printf 'machine_id=%s\n' "$(cat /etc/machine-id 2>/dev/null)"
    printf 'clean_pay_dir=%s\n' "$ROOT_DIR"
    printf 'clean_pay_git_head=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null)"
    printf 'clean_pay_release=%s\n' "$(cp_env CLEAN_PAY_RELEASE)"
    printf 'clean_pay_revision=%s\n' "$(cp_env CLEAN_PAY_REVISION)"
    printf 'clean_pay_image=%s\n' "$(cp_env CLEAN_PAY_IMAGE)"
    printf 'clean_pay_migration_image=%s\n' "$(cp_env CLEAN_PAY_MIGRATION_IMAGE)"
    [ -z "$app" ] || printf 'clean_pay_running_image_id=%s\n' "$(container_field "$app" '{{.Image}}')"
    printf 'remnashop_dir=%s\n' "$REMNASHOP_DIR"
    [ -z "$rs_image" ] || printf 'remnashop_image=%s\n' "$rs_image"
    [ -z "$rs_image" ] || printf 'remnashop_image_id=%s\n' "$(container_field "$RS_API" '{{.Image}}')"
    [ -z "$rs_image" ] || printf 'remnashop_revision=%s\n' "$(container_revision "$RS_API")"
    if container_running "$RS_DB"; then
      printf 'remnashop_alembic=%s\n' "$(db_query "$RS_DB" 'SELECT version_num FROM alembic_version' 2>/dev/null)"
    fi
  } > "$dir/manifest.txt"
}

# Creates a complete, verified backup. Sets LAST_BACKUP_DIR on success.
backup_create() {
  local reason=${1:-manual} stamp dir cp_pg rs_db need free entries caddyfile checksums items=0
  need_docker
  reason=$(printf '%s' "$reason" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-48)
  stamp=$(date +%Y%m%d-%H%M%S)
  dir="$BACKUP_DIR/${stamp}_${reason}"

  title 'Резервная копия' "$dir"
  cp_pg=''; cp_installed && cp_pg=$(cp_container postgres)
  rs_db=''; container_running "$RS_DB" && rs_db=$RS_DB

  need=512
  if container_running "$cp_pg"; then need=$(( need + $(database_size_mb "$cp_pg") )); fi
  if [ -n "$rs_db" ]; then need=$(( need + $(database_size_mb "$rs_db") )); fi
  if ! mkdir -p "$BACKUP_DIR" || ! chmod 700 "$BACKUP_DIR"; then die "Не удалось создать $BACKUP_DIR"; fi
  free=$(free_mb "$BACKUP_DIR")
  [ "${free:-0}" -ge "$need" ] \
    || die "Мало места: свободно $(human_mb "${free:-0}"), для копии нужно около $(human_mb "$need")."
  mkdir -m 700 "$dir" || die "Не удалось создать $dir"

  if container_running "$cp_pg"; then
    say '  Clean Pay: база данных…'
    dump_database "$cp_pg" "$dir/clean-pay.dump" || { mv -- "$dir" "$dir.FAILED"; die 'pg_dump Clean Pay завершился ошибкой.'; }
    entries=$(verify_dump "$cp_pg" "$dir/clean-pay.dump") \
      || { mv -- "$dir" "$dir.FAILED"; die 'Дамп Clean Pay не читается (pg_restore --list).'; }
    ok "clean-pay.dump — $(human_size "$dir/clean-pay.dump"), объектов: $entries"
    if dump_roles "$cp_pg" "$dir/clean-pay-roles.sql" 2>/dev/null; then ok 'роли PostgreSQL Clean Pay сохранены'
    else rm -f -- "$dir/clean-pay-roles.sql"; warn 'роли PostgreSQL не сохранены (нет прав суперпользователя) — их пересоздаст deploy.sh'
    fi
    items=$((items + 1))
  elif cp_installed; then
    warn 'PostgreSQL Clean Pay не запущен — дамп базы пропущен'
  fi
  if cp_installed; then
    say '  Clean Pay: настройки…'
    copy_config "$dir/config/clean-pay" "$ENV_FILE" "$ENV_FILE".* "$MENU_CONF"
    items=$((items + 1))
  fi

  if [ -n "$rs_db" ]; then
    say '  Remnashop: база данных…'
    dump_database "$rs_db" "$dir/remnashop.dump" || { mv -- "$dir" "$dir.FAILED"; die 'pg_dump Remnashop завершился ошибкой.'; }
    entries=$(verify_dump "$rs_db" "$dir/remnashop.dump") \
      || { mv -- "$dir" "$dir.FAILED"; die 'Дамп Remnashop не читается (pg_restore --list).'; }
    ok "remnashop.dump — $(human_size "$dir/remnashop.dump"), объектов: $entries"
    items=$((items + 1))
  fi
  if [ -f "$RS_COMPOSE" ] || [ -f "$REMNASHOP_DIR/.env" ]; then
    say '  Remnashop: настройки…'
    copy_config "$dir/config/remnashop" "$REMNASHOP_DIR/.env" "$RS_COMPOSE"
    items=$((items + 1))
  fi

  caddyfile=$(detect_caddyfile)
  if [ -n "$caddyfile" ] && [ -f "$caddyfile" ]; then
    say '  Caddy: конфигурация reverse proxy…'
    copy_config "$dir/config/caddy" "$caddyfile"
  fi

  write_manifest "$dir" "$reason"
  if [ "$items" -eq 0 ]; then
    note 'Сохранять пока нечего: Clean Pay и Remnashop не найдены. Записан только manifest.'
  fi
  checksums=$(cd "$dir" && find . -type f -print0 | sort -z | xargs -0 sha256sum) \
    || { mv -- "$dir" "$dir.FAILED"; die 'Не удалось посчитать контрольные суммы.'; }
  printf '%s\n' "$checksums" > "$dir/SHA256SUMS"
  ok "Контрольные суммы: SHA256SUMS ($(wc -l < "$dir/SHA256SUMS") файлов)"
  journal backup "$dir"
  LAST_BACKUP_DIR=$dir
  say ''
  ok "Копия готова: $dir ($(human_size "$dir"))"
  free=$(free_mb "$BACKUP_DIR")
  note "Свободно после копии: $(human_mb "${free:-0}")"
  note 'Копии содержат секреты (.env) — храните каталог только у root и вынесите копию за пределы сервера.'
}

# Mandatory gate in front of every global action.
require_backup() {
  local reason=$1
  say ''
  printf '  %sПеред этим действием обязательна полная резервная копия.%s\n' "$C_BOLD" "$C_RESET"
  note 'Базы Clean Pay и Remnashop, все .env, compose-файлы и Caddyfile.'
  backup_create "$reason" || die 'Резервная копия не создана — действие отменено, ничего не изменено.'
}

backup_verify() {
  local dir=${1:-} dump container failed=0
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then die "Каталог копии не найден: ${dir:-не указан}"; fi
  title 'Проверка копии' "$dir"
  if (cd "$dir" && sha256sum --quiet -c SHA256SUMS); then ok 'Контрольные суммы совпадают'
  else err 'Контрольные суммы НЕ совпадают — копия повреждена'; failed=1
  fi
  for dump in "$dir"/*.dump; do
    [ -f "$dump" ] || continue
    case "$(basename -- "$dump")" in
      clean-pay.dump) container=$(cp_container postgres) ;;
      remnashop.dump) container=$RS_DB ;;
      *) continue ;;
    esac
    if container_running "$container"; then
      if verify_dump "$container" "$dump" >/dev/null; then ok "$(basename -- "$dump") читается (pg_restore --list)"
      else err "$(basename -- "$dump") не читается"; failed=1
      fi
    else
      warn "$(basename -- "$dump"): контейнер PostgreSQL не запущен, проверка формата пропущена"
    fi
  done
  [ ! -f "$dir/manifest.txt" ] || { say ''; sed 's/^/    /' "$dir/manifest.txt"; }
  [ "$failed" -eq 0 ]
}

list_backups() {
  title 'Резервные копии' "$BACKUP_DIR"
  [ -d "$BACKUP_DIR" ] || { note 'Копий пока нет.'; return 0; }
  local dirs=() dir i=0 choice
  while IFS= read -r dir; do dirs+=("$dir"); done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r)
  [ "${#dirs[@]}" -gt 0 ] || { note 'Копий пока нет.'; return 0; }
  for dir in "${dirs[@]}"; do
    i=$((i + 1))
    local mark="$C_GREEN✔$C_RESET"
    [ -f "$dir/SHA256SUMS" ] || mark="$C_RED✘$C_RESET"
    printf '   %2d  %s %-44s %6s  %s\n' "$i" "$mark" "$(basename -- "$dir")" "$(human_size "$dir")" "$(age_of_backup "$dir")"
  done
  note "Всего: $(human_size "$BACKUP_DIR") · свободно: $(human_mb "$(free_mb "$BACKUP_DIR")")"
  note 'Старые копии меню не удаляет — удаляйте их вручную, когда уверены, что они не нужны.'
  is_interactive || return 0
  choice=$(ask_value 'Номер копии для проверки (Enter — назад)' '')
  [ -n "$choice" ] || return 0
  case "$choice" in *[!0-9]*) die 'Нужно ввести номер.' ;; esac
  if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#dirs[@]}" ]; then die 'Нет копии с таким номером.'; fi
  backup_verify "${dirs[$((choice - 1))]}"
}

choose_backup() {
  local dirs=() dir i=0 choice
  [ -d "$BACKUP_DIR" ] || die 'Копий нет.'
  while IFS= read -r dir; do dirs+=("$dir"); done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.FAILED' | sort -r)
  [ "${#dirs[@]}" -gt 0 ] || die 'Копий нет.'
  for dir in "${dirs[@]}"; do
    i=$((i + 1))
    printf '   %2d  %-44s %s\n' "$i" "$(basename -- "$dir")" "$(age_of_backup "$dir")" >&2
  done
  choice=$(ask_value 'Номер копии' 1)
  case "$choice" in ''|*[!0-9]*) die 'Нужно ввести номер.' ;; esac
  if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#dirs[@]}" ]; then die 'Нет копии с таким номером.'; fi
  printf '%s' "${dirs[$((choice - 1))]}"
}

# Prints exact restore commands for the chosen backup. Restoring overwrites
# live data, so the menu deliberately does not run these commands itself.
show_restore() {
  title 'Восстановление из копии' 'Меню только показывает команды: восстановление перезаписывает рабочие данные'
  local dir pg app_head
  dir=$(choose_backup)
  backup_verify "$dir" || die 'Копия не прошла проверку — восстанавливать из неё нельзя.'
  app_head=$(env_get "$dir/manifest.txt" clean_pay_git_head)
  pg=$(cp_container postgres); pg=${pg:-clean-pay-prod-postgres-1}
  say ''
  printf '  %sПорядок действий (выполняйте по одному шагу, проверяя результат):%s\n' "$C_BOLD" "$C_RESET"
  if [ -f "$dir/clean-pay.dump" ]; then
    cat <<EOF

  ${C_CYAN}Clean Pay${C_RESET}
  1. Остановите приложение и workers (PostgreSQL продолжает работать):
     docker stop $(cp_container app) $(cp_container retention-worker) $(cp_container reconciliation-worker)
  2. Восстановите базу:
     docker exec -i $pg sh -c 'exec pg_restore -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" --clean --if-exists --single-transaction' < $dir/clean-pay.dump
  3. Верните код и настройки той же версии:
     git -C $ROOT_DIR checkout --detach ${app_head:-<SHA из manifest.txt>}
     cp -p $dir/config/clean-pay/.env* $ROOT_DIR/deploy/prod/
  4. Запустите: cd $ROOT_DIR && ./deploy.sh install
EOF
  fi
  if [ -f "$dir/remnashop.dump" ]; then
    cat <<EOF

  ${C_CYAN}Remnashop${C_RESET}
  1. Остановите сервисы (база продолжает работать):
     docker stop $RS_API $RS_WORKER $RS_SCHEDULER
  2. Восстановите базу:
     docker exec -i $RS_DB sh -c 'exec pg_restore -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" --clean --if-exists --single-transaction' < $dir/remnashop.dump
  3. Верните настройки и образ из копии:
     cp -p $dir/config/remnashop/.env $dir/config/remnashop/docker-compose.yml $REMNASHOP_DIR/
  4. Запустите: cd $REMNASHOP_DIR && docker compose up -d
EOF
  fi
  say ''
  warn 'Перед восстановлением сделайте свежую копию текущего состояния (пункт меню «Создать копию»).'
  warn 'Сначала отрепетируйте восстановление на тестовом стенде.'
}

# ─── Изменение .env (только через проверенные инструменты) ──────────────────

set_cp_env() {
  local name=$1 value=$2
  if [ -f "$NODE_TOOLING_SCRIPT" ]; then
    printf '%s' "$value" | sh "$NODE_TOOLING_SCRIPT" credential-env-set "$ENV_FILE" "$name"
  elif have node && [ -f "$CREDENTIAL_GUARD_SCRIPT" ]; then
    printf '%s' "$value" | node "$CREDENTIAL_GUARD_SCRIPT" env-set "$ENV_FILE" "$name"
  else
    die "Нет инструмента для безопасной записи $name в .env (node-tooling.sh)."
  fi
}

# ─── Clean Pay: установка ───────────────────────────────────────────────────

cp_install() {
  title 'Установка Clean Pay' 'Мастер: настройки → проверка Compose → сборка и запуск'
  if cp_installed && docker_ok && [ -n "$(cp_container app)" ]; then
    warn 'Clean Pay уже установлен на этом сервере.'
    note 'Для новой версии используйте «Обновить Clean Pay», для настроек — «Изменить настройки».'
    ask_yes_no 'Всё равно запустить мастер установки?' no || return 0
  fi
  need_docker
  need_git
  check_server || ask_yes_no 'Есть проблемы. Продолжить всё равно?' no || return 1
  if ! container_exists "$RS_API"; then
    warn 'Remnashop на этом сервере не найден. Clean Pay работает только вместе с Remnashop.'
    note 'Сначала установите его пунктом «Установить Remnashop с нуля».'
    ask_yes_no 'Продолжить установку Clean Pay?' no || return 0
  fi
  if container_running "$RS_DB" || cp_installed; then
    require_backup before-clean-pay-install
  fi
  note 'Дальше работает стандартный мастер ./deploy.sh setup.'
  sh "$DEPLOY_SCRIPT" setup
  journal clean-pay-install "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null)"
}

# ─── Clean Pay: обновление ──────────────────────────────────────────────────

show_remote_refs() {
  local git_dir=$1 remote=$2
  printf '  %sПоследние теги:%s ' "$C_DIM" "$C_RESET" >&2
  { git --git-dir="$git_dir" ls-remote --tags --refs "$remote" 2>/dev/null || true; } \
    | awk '{sub("refs/tags/", "", $2); print $2}' | sort -V | tail -n 5 | tr '\n' ' ' >&2
  printf '\n  %sВетки:%s ' "$C_DIM" "$C_RESET" >&2
  { git --git-dir="$git_dir" ls-remote --heads "$remote" 2>/dev/null || true; } \
    | awk '{sub("refs/heads/", "", $2); print $2}' | head -n 8 | tr '\n' ' ' >&2
  printf '\n' >&2
}

# Fetches exactly one ref (tag, branch or 40-hex SHA) and prints its commit SHA.
fetch_ref() {
  local git_dir=$1 remote=$2 ref=$3 spec
  case "$ref" in
    '') return 1 ;;
    *[!A-Za-z0-9._/-]*) err 'Недопустимые символы в имени версии.'; return 1 ;;
  esac
  if printf '%s' "$ref" | grep -Eq '^[0-9a-f]{40}$'; then
    spec=$ref
  elif git --git-dir="$git_dir" ls-remote --exit-code --tags --refs "$remote" "refs/tags/$ref" >/dev/null 2>&1; then
    spec="refs/tags/$ref"
  else
    spec="refs/heads/$ref"
  fi
  git --git-dir="$git_dir" fetch --no-tags --quiet "$remote" "$spec" || return 1
  git --git-dir="$git_dir" rev-parse 'FETCH_HEAD^{commit}'
}

cp_update() {
  title 'Обновление Clean Pay' 'Копия → новая версия кода → сборка (сайт работает) → установка (короткий простой)'
  cp_installed || die 'Clean Pay не установлен (нет deploy/prod/.env). Используйте установку.'
  need_docker
  need_git
  local git_dir head dirty ref target subject migrations changed ancestor min free
  git_dir=$(git -C "$ROOT_DIR" rev-parse --absolute-git-dir)
  head=$(git -C "$ROOT_DIR" rev-parse HEAD)
  dirty=$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all)
  [ -z "$dirty" ] || { printf '%s\n' "$dirty" | head -n 10 | sed 's/^/    /'; die 'В каталоге есть незафиксированные изменения — обновление из «грязного» checkout запрещено.'; }

  step 1 6 'Выбор версии'
  kv 'Сейчас установлено' "$(short "$head") $(git -C "$ROOT_DIR" log -1 --format='%cs %s' | cut -c1-60)"
  show_remote_refs "$git_dir" origin
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$git_dir" origin "$ref") || die "Версия «$ref» не найдена в origin."
  if [ "$target" = "$head" ]; then
    ok 'Эта версия уже установлена.'
    return 0
  fi
  subject=$(git -C "$ROOT_DIR" log -1 --format='%cs %s' "$target" | cut -c1-70)
  changed=$(git -C "$ROOT_DIR" diff --name-only "$head" "$target" | wc -l | tr -d ' ')
  migrations=$(git -C "$ROOT_DIR" diff --name-only --diff-filter=A "$head" "$target" -- prisma/migrations \
    | grep -c '/migration\.sql$' || true)
  if git -C "$ROOT_DIR" merge-base --is-ancestor "$head" "$target" 2>/dev/null; then ancestor=yes; else ancestor=no; fi
  say ''
  kv 'Новая версия' "$(short "$target") $subject"
  if [ "$ancestor" = yes ]; then
    note 'Изменения:'
    git -C "$ROOT_DIR" log --oneline --no-merges "$head..$target" | head -n 15 | sed 's/^/      /'
  fi
  kv 'Изменено файлов' "$changed"
  if [ "$migrations" -gt 0 ]; then kv 'Новые миграции БД' "${C_YELLOW}$migrations — схема базы изменится${C_RESET}"
  else kv 'Новые миграции БД' 'нет'
  fi
  if [ "$ancestor" = no ]; then
    warn 'Новая версия НЕ является продолжением текущей истории (другая ветка или переписанная история).'
    warn 'Убедитесь, что это именно тот код, который проверен на тестовом стенде.'
  fi

  step 2 6 'Проверки перед обновлением'
  min=$(cp_env CLEAN_PAY_MIN_FREE_DISK_MB 8192)
  free=$(free_mb "$ROOT_DIR")
  if [ "${free:-0}" -ge "$min" ]; then
    ok "Свободно $(human_mb "$free")"
  else
    warn "Свободно $(human_mb "${free:-0}"), для сборки нужно ≥ $(human_mb "$min"): deploy.sh попробует очистить кэш сборки."
  fi
  ask_yes_no "Обновить Clean Pay до $(short "$target")?" no || { note 'Отменено, ничего не изменено.'; return 0; }

  step 3 6 'Резервная копия'
  require_backup "before-clean-pay-$(short "$target")"

  step 4 6 'Переключение кода на новую версию'
  local old_revision old_release old_image old_migration_image traceable=no
  old_revision=$(cp_env CLEAN_PAY_REVISION local)
  old_release=$(cp_env CLEAN_PAY_RELEASE local)
  old_image=$(cp_env CLEAN_PAY_IMAGE clean-pay-prod-app:local)
  old_migration_image=$(cp_env CLEAN_PAY_MIGRATION_IMAGE clean-pay-prod-migration:local)
  git -C "$ROOT_DIR" checkout --quiet --detach "$target"
  [ "$(git -C "$ROOT_DIR" rev-parse HEAD)" = "$target" ] || die 'git checkout не переключил версию.'
  ok "Код переключён на $(short "$target")"
  if [ "$old_revision" != local ]; then
    traceable=yes
  else
    note 'Сейчас образы собираются как local/local (без привязки к коммиту).'
    if ask_yes_no 'Перейти на образы с SHA в имени (старый образ останется для быстрого отката)?' yes; then traceable=yes; fi
  fi
  if [ "$traceable" = yes ]; then
    set_cp_env CLEAN_PAY_IMAGE "${old_image%:*}:$target"
    set_cp_env CLEAN_PAY_MIGRATION_IMAGE "${old_migration_image%:*}:$target"
    set_cp_env CLEAN_PAY_RELEASE "prod-$(date +%Y%m%d)-$target"
    set_cp_env CLEAN_PAY_REVISION "$target"
    ok 'Релизные поля .env обновлены (образы, релиз, ревизия)'
  fi

  cp_restore_code() {
    warn "Возвращаю код и релизные поля .env к $(short "$head")…"
    if [ "$traceable" = yes ]; then
      set_cp_env CLEAN_PAY_IMAGE "$old_image" || true
      set_cp_env CLEAN_PAY_MIGRATION_IMAGE "$old_migration_image" || true
      set_cp_env CLEAN_PAY_RELEASE "$old_release" || true
      set_cp_env CLEAN_PAY_REVISION "$old_revision" || true
    fi
    git -C "$ROOT_DIR" checkout --quiet --detach "$head"
  }

  step 5 6 'Сборка и проверка образов — сайт продолжает работать'
  if ! sh "$DEPLOY_SCRIPT" build; then
    cp_restore_code
    journal clean-pay-update-failed "build $(short "$head") -> $(short "$target")"
    die 'Сборка не удалась. Работающая версия не затронута, код возвращён.'
  fi
  ok 'Образы собраны и проверены'

  step 6 6 'Установка: миграции и перезапуск'
  warn 'Clean Pay будет недоступен ~1–3 минуты: остановка → миграции → запуск → проверки.'
  if ! type_to_confirm ОБНОВИТЬ; then
    cp_restore_code
    note 'Отменено. Работающая версия не затронута; собранные образы остались на диске.'
    return 0
  fi
  if sh "$DEPLOY_SCRIPT" install; then
    journal clean-pay-update "$(short "$head") -> $(short "$target") ok; backup $LAST_BACKUP_DIR"
    ok "Clean Pay обновлён до $(short "$target")"
    note 'Проверьте вход, создание платежа и выдачу подписки.'
    return 0
  fi

  journal clean-pay-update-failed "install $(short "$head") -> $(short "$target")"
  err 'Установка не удалась. Приложение остановлено намеренно — старый код поверх новой схемы опасен.'
  if [ "$migrations" -eq 0 ]; then
    if ask_yes_no 'Новых миграций не было. Вернуть предыдущую версию и запустить её?' yes; then
      cp_restore_code
      sh "$DEPLOY_SCRIPT" install && { ok 'Предыдущая версия снова работает.'; return 1; }
      err 'Предыдущая версия тоже не запустилась.'
    fi
  else
    warn 'В новой версии есть миграции БД — автоматический откат кода запрещён.'
  fi
  note "Резервная копия: $LAST_BACKUP_DIR"
  note 'Дальше: исправьте причину и повторите ./deploy.sh install, либо восстановите БД (пункт «Как восстановить»).'
  return 1
}

cp_configure() {
  cp_installed || die 'Clean Pay ещё не установлен — используйте мастер установки.'
  title 'Настройки Clean Pay' 'Секреты на экране не отображаются; Enter оставляет текущее значение'
  sh "$DEPLOY_SCRIPT" configure
  note 'Чтобы новые значения начали работать, выберите «Применить настройки (перезапуск)».'
}

cp_restart() {
  cp_installed || die 'Clean Pay не установлен.'
  title 'Применение настроек' 'Пересоздаёт app и workers с текущим .env на том же образе'
  warn 'Clean Pay будет недоступен ~1 минуту.'
  ask_yes_no 'Перед перезапуском сделать резервную копию? (рекомендуется)' yes && backup_create before-restart
  ask_yes_no 'Перезапустить сейчас?' no || return 0
  sh "$DEPLOY_SCRIPT" restart
  journal clean-pay-restart ok
}

cp_stop() {
  cp_installed || die 'Clean Pay не установлен.'
  title 'Остановка Clean Pay' 'Контейнеры останавливаются, данные и тома сохраняются'
  warn 'Сайт оплаты станет недоступен до следующего запуска (./deploy.sh install).'
  type_to_confirm ОСТАНОВИТЬ || { note 'Отменено.'; return 0; }
  sh "$DEPLOY_SCRIPT" down
  journal clean-pay-stop ok
}

# ─── Remnashop ──────────────────────────────────────────────────────────────

rs_compose() { docker compose --project-directory "$REMNASHOP_DIR" -f "$RS_COMPOSE" "$@"; }

rs_service_of() {
  local name=$1 fallback=$2 service
  service=$(container_field "$name" '{{index .Config.Labels "com.docker.compose.service"}}')
  printf '%s' "${service:-$fallback}"
}

rs_has_service() { rs_compose config --services 2>/dev/null | grep -qx "$1"; }

alembic_head() {
  [ -n "$1" ] || return 0
  docker run --rm --network none --entrypoint alembic "$1" \
    -c src/infrastructure/database/alembic.ini heads 2>/dev/null | awk 'NR == 1 { print $1 }'
}

rs_prepare_sources() {
  need_git
  if [ ! -d "$REMNASHOP_SOURCES" ]; then
    note "Локального зеркала исходников нет: $REMNASHOP_SOURCES"
    ask_yes_no "Создать его из $REMNASHOP_REPO?" yes || die 'Без исходников собрать Remnashop нельзя.'
    mkdir -p "$(dirname -- "$REMNASHOP_SOURCES")"
    git clone --bare --quiet "$REMNASHOP_REPO" "$REMNASHOP_SOURCES"
    ok 'Зеркало создано'
  fi
}

# Builds the image for a commit and prints its local reference.
rs_build_image() {
  local target=$1 staging image revision free
  image="$REMNASHOP_IMAGE:$REMNASHOP_TAG_PREFIX$target"
  if docker image inspect "$image" >/dev/null 2>&1; then
    revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
    if [ "$revision" = "$target" ]; then
      ok "Образ $image уже собран — пересборка не нужна" >&2
      printf '%s' "$image"
      return 0
    fi
  fi
  free=$(free_mb /var/lib/docker)
  [ "${free:-0}" -ge 3072 ] || die "Для сборки Remnashop нужно ≥ 3 ГБ свободного места, сейчас $(human_mb "${free:-0}")."
  staging="$REMNASHOP_STAGING/remnashop-$target"
  mkdir -p "$staging"
  rm -rf -- "${staging:?}/source"
  mkdir -m 700 "$staging/source"
  git --git-dir="$REMNASHOP_SOURCES" archive "$target" | tar -x -C "$staging/source"
  note "Сборка образа (журнал: $staging/build.log)…" >&2
  if ! docker build --label "org.opencontainers.image.revision=$target" -t "$image" "$staging/source" > "$staging/build.log" 2>&1; then
    tail -n 20 "$staging/build.log" | sed 's/^/    /' >&2
    die 'Сборка образа Remnashop не удалась.'
  fi
  revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  [ "$revision" = "$target" ] || die 'У собранного образа неверная метка ревизии.'
  ok "Образ собран: $image" >&2
  printf '%s' "$image"
}

rs_wait_healthy() {
  local i states
  for i in $(seq 1 60); do
    states=$({ docker inspect "$RS_API" "$RS_WORKER" "$RS_SCHEDULER" \
      --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true; } \
      | sort -u | tr '\n' ' ')
    printf '\r  Ожидание готовности (%s/60): %s   ' "$i" "$states"
    if [ "$states" = 'running/healthy ' ]; then printf '\n'; return 0; fi
    case "$states" in *exited*|*unhealthy*|*dead*) printf '\n'; return 1 ;; esac
    sleep 10
  done
  printf '\n'
  return 1
}

rs_update() {
  title 'Обновление Remnashop' 'Копия → сборка образа → миграции (если есть) → перезапуск API, worker и scheduler'
  need_docker
  [ -f "$RS_COMPOSE" ] || die "Не найден $RS_COMPOSE. Для новой установки используйте «Установить Remnashop с нуля»."
  container_exists "$RS_API" || die "Контейнер $RS_API не найден."
  local current_image current_id current_rev ref target image image_id db_version new_head pending=no
  local api_svc worker_svc scheduler_svc migrated=0 compose_before replaced
  current_image=$(container_field "$RS_API" '{{.Config.Image}}')
  current_id=$(container_field "$RS_API" '{{.Image}}')
  current_rev=$(container_revision "$RS_API")
  api_svc=$(rs_service_of "$RS_API" remnashop)
  worker_svc=$(rs_service_of "$RS_WORKER" remnashop-taskiq-worker)
  scheduler_svc=$(rs_service_of "$RS_SCHEDULER" remnashop-taskiq-scheduler)

  step 1 6 'Выбор версии'
  kv 'Сейчас работает' "$current_image"
  rs_prepare_sources
  show_remote_refs "$REMNASHOP_SOURCES" origin
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$REMNASHOP_SOURCES" origin "$ref") || die "Версия «$ref» не найдена."
  [ "$target" != "$current_rev" ] || { ok 'Эта версия уже работает.'; return 0; }
  kv 'Новая версия' "$(short "$target") $(git --git-dir="$REMNASHOP_SOURCES" log -1 --format='%cs %s' "$target" | cut -c1-60)"
  if [ -n "$current_rev" ] && git --git-dir="$REMNASHOP_SOURCES" cat-file -e "$current_rev^{commit}" 2>/dev/null; then
    note 'Изменения:'
    git --git-dir="$REMNASHOP_SOURCES" log --oneline --no-merges "$current_rev..$target" | head -n 15 | sed 's/^/      /'
  fi

  step 2 6 'Сборка образа (сервисы продолжают работать)'
  image=$(rs_build_image "$target")
  image_id=$(docker image inspect -f '{{.Id}}' "$image")

  step 3 6 'Проверка миграций базы'
  db_version=$(db_query "$RS_DB" 'SELECT version_num FROM alembic_version' 2>/dev/null || true)
  new_head=$(alembic_head "$image")
  kv 'Схема в базе' "${db_version:-?}"
  kv 'Схема в новом образе' "${new_head:-?}"
  [ -n "$new_head" ] || die 'Не удалось прочитать Alembic head из нового образа.'
  if [ "$db_version" != "$new_head" ]; then
    pending=yes
    warn 'Будут применены миграции: на ~1–2 минуты бот и API остановятся.'
  else
    ok 'Новых миграций нет — перезапуск займёт ~30 секунд'
  fi
  ask_yes_no "Обновить Remnashop до $(short "$target")?" no || { note 'Отменено. Работающие сервисы не затронуты.'; return 0; }

  step 4 6 'Резервная копия'
  require_backup "before-remnashop-$(short "$target")"
  compose_before="$LAST_BACKUP_DIR/config/remnashop/docker-compose.yml"
  [ -f "$compose_before" ] || die 'В копии нет compose-файла Remnashop — откат был бы невозможен.'

  rs_rollback() {
    warn 'Возвращаю предыдущий образ…'
    cp -p -- "$compose_before" "$RS_COMPOSE"
    rs_compose up -d --no-deps --force-recreate "$api_svc" "$worker_svc" "$scheduler_svc" || true
    if rs_wait_healthy; then warn "Предыдущая версия ($current_image) снова работает."
    else err 'Предыдущая версия не стала healthy — нужна ручная проверка.'
    fi
  }

  step 5 6 'Переключение compose на новый образ'
  replaced=$(grep -cF "image: $current_image" "$RS_COMPOSE" || true)
  [ "$replaced" = 1 ] || die "В $RS_COMPOSE ожидалась ровно одна строка «image: $current_image» (найдено: $replaced). Обновите вручную."
  awk -v old="image: $current_image" -v new="image: $image" \
    '{ i = index($0, old); if (i) { $0 = substr($0, 1, i - 1) new substr($0, i + length(old)) } print }' \
    "$compose_before" > "$RS_COMPOSE.new"
  chmod --reference="$compose_before" "$RS_COMPOSE.new" 2>/dev/null || true
  mv -f -- "$RS_COMPOSE.new" "$RS_COMPOSE"
  if ! rs_compose config --quiet; then cp -p -- "$compose_before" "$RS_COMPOSE"; die 'Новый compose не прошёл проверку — возвращён прежний.'; fi
  ok "compose указывает на $image"

  step 6 6 'Перезапуск'
  if [ "$pending" = yes ]; then
    note 'Остановка API, worker и scheduler…'
    rs_compose stop "$api_svc" "$worker_svc" "$scheduler_svc"
    if rs_has_service remnashop-storage-init; then rs_compose run --rm --no-deps remnashop-storage-init; fi
    note 'Применение миграций Alembic…'
    migrated=1
    if ! rs_compose run --rm --no-deps remnashop-migration; then
      err 'Миграция завершилась ошибкой.'
      warn 'Схема могла измениться частично: сервисы оставлены остановленными.'
      note "Копия базы: $LAST_BACKUP_DIR/remnashop.dump — см. «Как восстановить»."
      journal remnashop-update-failed "migration $(short "$current_rev") -> $(short "$target")"
      return 1
    fi
    ok 'Миграции применены'
  fi
  rs_compose up -d --no-deps --force-recreate "$api_svc" "$worker_svc" "$scheduler_svc"
  if rs_wait_healthy \
    && [ "$(container_field "$RS_API" '{{.Image}}')" = "$image_id" ] \
    && [ "$(container_field "$RS_WORKER" '{{.Image}}')" = "$image_id" ] \
    && [ "$(container_field "$RS_SCHEDULER" '{{.Image}}')" = "$image_id" ]; then
    ok 'API, worker и scheduler работают на новом образе'
  else
    err 'Сервисы не стали healthy на новом образе.'
    if [ "$migrated" -eq 0 ] || ask_yes_no 'Миграции уже применены. Всё равно вернуть прежний образ?' no; then rs_rollback; fi
    journal remnashop-update-failed "start $(short "$current_rev") -> $(short "$target")"
    return 1
  fi
  if cp_installed && [ -f "$REMNASHOP_CHECK_SCRIPT" ]; then
    note 'Проверка совместимости с Clean Pay…'
    if sh "$REMNASHOP_CHECK_SCRIPT" "$ENV_FILE" check; then ok 'Clean Pay и Remnashop совместимы'
    else warn 'Проверка совместимости с Clean Pay не прошла — посмотрите вывод выше.'
    fi
  fi
  journal remnashop-update "$(short "$current_rev") -> $(short "$target") ok; previous image $current_id; backup $LAST_BACKUP_DIR"
  ok "Remnashop обновлён до $(short "$target"). Прежний образ сохранён: $current_image"
}

# Sets KEY=value in a Remnashop .env (replacing a commented or placeholder line).
rs_env_set() {
  local file=$1 key=$2 value=$3 tmp
  case "$value" in *$'\n'*|*'"'*) die "Недопустимое значение для $key." ;; esac
  tmp=$(mktemp "$file.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^[#[:space:]]*" key "=" { if (!done) { print key "=" value; done = 1 }; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" > "$tmp"
  chmod 600 "$tmp" && mv -f -- "$tmp" "$file"
}

rs_env_placeholder() {
  local value
  value=$(env_get "$1" "$2")
  case "$value" in ''|change_me|replace_with_*) return 0 ;; *) return 1 ;; esac
}

rs_install() {
  title 'Установка Remnashop с нуля' 'Исходники → образ → .env → база → миграции → запуск'
  need_docker
  if [ -f "$RS_COMPOSE" ] || [ -f "$REMNASHOP_DIR/.env" ] || container_exists "$RS_API"; then
    die "Remnashop уже есть ($REMNASHOP_DIR или контейнер $RS_API). Используйте «Обновить Remnashop»."
  fi
  [ "$(id -u)" -eq 0 ] || die 'Установку Remnashop нужно запускать от root (права на каталоги для uid 10001).'
  local ref target image source env_file key value

  step 1 7 'Резервная копия того, что уже есть на сервере'
  require_backup before-remnashop-install

  step 2 7 'Исходники и версия'
  rs_prepare_sources
  show_remote_refs "$REMNASHOP_SOURCES" origin
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$REMNASHOP_SOURCES" origin "$ref") || die "Версия «$ref» не найдена."
  kv 'Версия' "$(short "$target") $(git --git-dir="$REMNASHOP_SOURCES" log -1 --format='%cs %s' "$target" | cut -c1-60)"

  step 3 7 'Сборка образа'
  image=$(rs_build_image "$target")
  source="$REMNASHOP_STAGING/remnashop-$target/source"
  if [ ! -f "$source/docker-compose.prod.internal.yml" ] || [ ! -f "$source/.env.example" ]; then
    die 'В исходниках нет docker-compose.prod.internal.yml или .env.example.'
  fi

  step 4 7 'Каталог и compose'
  mkdir -p "$REMNASHOP_DIR"
  mkdir -p "$REMNASHOP_DIR/logs" "$REMNASHOP_DIR/assets" "$REMNASHOP_DIR/backups"
  chown 10001:10001 "$REMNASHOP_DIR/logs" "$REMNASHOP_DIR/assets" "$REMNASHOP_DIR/backups"
  [ "$(grep -c '^  image: ghcr.io/' "$source/docker-compose.prod.internal.yml")" = 1 ] \
    || die 'Шаблон compose изменился: не найдена единственная строка образа ghcr.io.'
  awk -v image="$image" '/^  image: ghcr.io\// { print "  image: " image; next } { print }' \
    "$source/docker-compose.prod.internal.yml" > "$RS_COMPOSE"
  chmod 600 "$RS_COMPOSE"
  ok "$RS_COMPOSE (образ $image)"

  step 5 7 'Настройки .env'
  env_file="$REMNASHOP_DIR/.env"
  cp -- "$source/.env.example" "$env_file"
  chmod 600 "$env_file"
  have openssl || die 'Нужен openssl для генерации секретов.'
  rs_env_set "$env_file" APP_CRYPT_KEY "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n')"
  for key in APP_JWT_SECRET APP_API_KEY APP_AUTH_SERVICE_KEY REMNAWAVE_WEBHOOK_SECRET; do
    rs_env_set "$env_file" "$key" "$(openssl rand -hex 32)"
  done
  rs_env_set "$env_file" BOT_SECRET_TOKEN "$(openssl rand -hex 64)"
  rs_env_set "$env_file" DATABASE_PASSWORD "$(openssl rand -hex 24)"
  rs_env_set "$env_file" REDIS_PASSWORD "$(openssl rand -hex 24)"
  rs_env_set "$env_file" TASKIQ_DEPLOYMENT_ID "$(openssl rand -hex 12)"
  ok 'Внутренние секреты сгенерированы'
  value=$(ask_value 'Домен бота для webhook (без https://)' ''); rs_env_set "$env_file" APP_DOMAIN "$value"
  value=$(ask_secret 'Токен Telegram-бота от @BotFather'); rs_env_set "$env_file" BOT_TOKEN "$value"
  value=$(ask_value 'Telegram ID владельца (число)' ''); rs_env_set "$env_file" BOT_OWNER_ID "$value"
  value=$(ask_value 'Username поддержки без @' ''); rs_env_set "$env_file" BOT_SUPPORT_USERNAME "$value"
  value=$(ask_value 'Адрес Remnawave (имя контейнера или домен, без https://)' remnawave); rs_env_set "$env_file" REMNAWAVE_HOST "$value"
  value=$(ask_secret 'API-токен Remnawave'); rs_env_set "$env_file" REMNAWAVE_TOKEN "$value"
  if ask_yes_no 'Включить HTTP API для Clean Pay (WEB_ENABLED=true)?' yes; then rs_env_set "$env_file" WEB_ENABLED true; fi
  for key in APP_DOMAIN BOT_TOKEN BOT_OWNER_ID BOT_SUPPORT_USERNAME REMNAWAVE_TOKEN; do
    rs_env_placeholder "$env_file" "$key" && die "$key не заполнен. Повторите установку или допишите значение в $env_file."
  done
  if ask_yes_no 'Открыть .env в редакторе для дополнительных настроек (SMTP, платежи)?' no; then
    "${EDITOR:-$(command -v nano || command -v vi)}" "$env_file"
  fi

  step 6 7 'База данных и миграции'
  docker network inspect remnawave-network >/dev/null 2>&1 || docker network create remnawave-network >/dev/null
  rs_compose config --quiet || die 'compose-файл не прошёл проверку.'
  rs_compose up -d --wait remnashop-db remnashop-redis
  if rs_has_service remnashop-storage-init; then rs_compose run --rm --no-deps remnashop-storage-init; fi
  rs_compose run --rm --no-deps remnashop-migration
  ok 'Схема базы создана'

  step 7 7 'Запуск сервисов'
  rs_compose up -d
  rs_wait_healthy || die 'Сервисы не стали healthy. Логи: пункт «Логи сервисов».'
  journal remnashop-install "$(short "$target") ok"
  ok "Remnashop $(short "$target") установлен и работает"
  cat <<EOF

  ${C_BOLD}Дальше — подключение Clean Pay:${C_RESET}
  • APP_API_KEY из $env_file → REMNASHOP_API_KEY в настройках Clean Pay;
  • после настройки Clean Pay скопируйте его REMNASHOP_AUTH_SERVICE_KEY
    в APP_AUTH_SERVICE_KEY файла $env_file и выполните «Обновить Remnashop»
    или docker compose up -d в $REMNASHOP_DIR.
EOF
}

# ─── Справка и настройки ────────────────────────────────────────────────────

show_zdt() {
  title 'Обновление без простоя (zero-downtime)' 'Для релизов без изменений схемы БД'
  cat <<'EOF'
  Обычное обновление из меню останавливает Clean Pay на 1–3 минуты: так
  безопасно применяются миграции. Если в новой версии миграций нет, можно
  обновиться вообще без простоя: новая версия запускается рядом (canary),
  Caddy плавно переключает трафик, при ошибке всё возвращается автоматически.

  Это ручная процедура из нескольких проверяемых блоков — она описана в
  deploy/prod/zero-downtime-production-runbook.md. Перед ней всё равно
  создайте резервную копию пунктом меню.
EOF
  if is_interactive && have less && ask_yes_no 'Открыть runbook?' yes; then less -R "$RUNBOOK"; fi
}

edit_settings() {
  title 'Настройки меню' "Файл: $MENU_CONF"
  local choice value
  while :; do
    say ''
    kv '1  Каталог копий' "$BACKUP_DIR"
    kv '2  Каталог Remnashop' "$REMNASHOP_DIR"
    kv '3  Репозиторий Remnashop' "$REMNASHOP_REPO"
    kv '4  Зеркало исходников' "$REMNASHOP_SOURCES"
    kv '5  Каталог сборок' "$REMNASHOP_STAGING"
    kv '6  Имя образа Remnashop' "$REMNASHOP_IMAGE:$REMNASHOP_TAG_PREFIX<sha>"
    kv '7  Caddyfile для копий' "${CADDYFILE:-авто: $(detect_caddyfile 2>/dev/null || true)}"
    kv '0  Назад' ''
    choice=$(ask_value 'Что изменить' 0)
    case "$choice" in
      1) value=$(ask_value 'Каталог копий (абсолютный путь)' "$BACKUP_DIR"); valid_abs_path "$value" && BACKUP_DIR=$value ;;
      2) value=$(ask_value 'Каталог Remnashop' "$REMNASHOP_DIR"); valid_abs_path "$value" && REMNASHOP_DIR=$value ;;
      3) value=$(ask_value 'URL репозитория' "$REMNASHOP_REPO"); [ -n "$value" ] && REMNASHOP_REPO=$value ;;
      4) value=$(ask_value 'Зеркало (bare git)' "$REMNASHOP_SOURCES"); valid_abs_path "$value" && REMNASHOP_SOURCES=$value ;;
      5) value=$(ask_value 'Каталог сборок' "$REMNASHOP_STAGING"); valid_abs_path "$value" && REMNASHOP_STAGING=$value ;;
      6) value=$(ask_value 'Имя образа' "$REMNASHOP_IMAGE"); [ -n "$value" ] && REMNASHOP_IMAGE=$value
         value=$(ask_value 'Префикс тега' "$REMNASHOP_TAG_PREFIX"); REMNASHOP_TAG_PREFIX=$value ;;
      7) value=$(ask_value 'Путь к Caddyfile (пусто — авто)' "$CADDYFILE"); { [ -z "$value" ] || valid_abs_path "$value"; } && CADDYFILE=$value ;;
      *) break ;;
    esac || warn 'Значение не принято: нужен абсолютный путь без пробелов.'
    save_settings && ok 'Сохранено' && RS_COMPOSE="$REMNASHOP_DIR/docker-compose.yml"
  done
}

# ─── Главное меню ───────────────────────────────────────────────────────────

offer_screen() {
  is_interactive || return 0
  [ -z "${STY:-}" ] && [ -z "${TMUX:-}" ] || return 0
  have screen || return 0
  if screen -ls 2>/dev/null | grep -q "[.]${SCREEN_SESSION}[[:space:]]"; then
    say ''
    warn "Меню уже открыто в screen-сессии «$SCREEN_SESSION» (возможно, после обрыва SSH)."
    if ask_yes_no 'Подключиться к ней?' yes; then exec screen -r "$SCREEN_SESSION"; fi
    return 0
  fi
  say ''
  note 'SSH может оборваться посреди обновления. В screen операция продолжится,'
  note "а вернуться можно командой: screen -r $SCREEN_SESSION"
  if ask_yes_no 'Открыть меню внутри screen? (рекомендуется)' yes; then
    exec screen -S "$SCREEN_SESSION" env CLEAN_PAY_MENU_ROOT="$ROOT_DIR" CLEAN_PAY_MENU_COPY="${CLEAN_PAY_MENU_COPY:-}" bash "${BASH_SOURCE[0]}"
  fi
}

menu_item() {
  if [ -n "${3:-}" ]; then
    printf '   %s%2s%s  %s %s[%s]%s\n' "$C_BOLD" "$1" "$C_RESET" "$(pad "$2" 50)" "$C_YELLOW" "$3" "$C_RESET"
  else
    printf '   %s%2s%s  %s\n' "$C_BOLD" "$1" "$C_RESET" "$2"
  fi
}
menu_section() { printf '\n  %s%s%s\n' "$C_CYAN" "$1" "$C_RESET"; }

main_menu() {
  local choice
  offer_screen
  while :; do
    load_settings
    [ -z "${C_RESET}" ] || printf '\033[H\033[2J'
    printf '%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
    printf '  %sCLEAN PAY · центр управления%s   %s%s%s\n' "$C_BOLD" "$C_RESET" "$C_DIM" "$(hostname 2>/dev/null)" "$C_RESET"
    printf '%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
    print_summary
    menu_section 'СОСТОЯНИЕ'
    menu_item 1 'Подробное состояние и здоровье'
    menu_item 2 'Проверка сервера перед установкой'
    menu_item 3 'Логи сервисов'
    menu_section 'CLEAN PAY'
    menu_item 4 'Установить Clean Pay (мастер первой установки)' 'копия'
    menu_item 5 'Обновить Clean Pay до новой версии' 'копия'
    menu_item 6 'Изменить настройки (.env)'
    menu_item 7 'Применить настройки (перезапуск)'
    menu_item 8 'Остановить Clean Pay'
    menu_section 'REMNASHOP'
    menu_item 9 'Обновить Remnashop' 'копия'
    menu_item 10 'Установить Remnashop с нуля' 'копия'
    menu_section 'РЕЗЕРВНЫЕ КОПИИ'
    menu_item 11 'Создать полную резервную копию сейчас'
    menu_item 12 'Список копий и проверка'
    menu_item 13 'Как восстановить из копии'
    menu_section 'СПРАВКА'
    menu_item 14 'Обновление без простоя (zero-downtime)'
    menu_item 15 'Настройки меню'
    printf '\n'
    menu_item 0 'Выход'
    printf '\n'
    printf '  %sВыберите пункт:%s ' "$C_BOLD" "$C_RESET"
    IFS= read -r choice || { say ''; exit 0; }
    case "$choice" in
      1) run_view show_status ;;
      2) run_view check_server ;;
      3) run_view show_logs ;;
      4) run_action cp_install ;;
      5) run_action cp_update ;;
      6) run_action cp_configure ;;
      7) run_action cp_restart ;;
      8) run_action cp_stop ;;
      9) run_action rs_update ;;
      10) run_action rs_install ;;
      11) run_action backup_create manual ;;
      12) run_view list_backups ;;
      13) run_view show_restore ;;
      14) run_view show_zdt ;;
      15) edit_settings ;;
      0|q|й|exit|выход) say ''; exit 0 ;;
      '') continue ;;
      *) warn 'Нет такого пункта.' ;;
    esac
    pause
  done
}

usage() {
  cat <<'EOF'
Clean Pay — меню установки, обновления и резервного копирования.

  ./menu.sh                    интерактивное меню
  ./menu.sh status             состояние Clean Pay и Remnashop
  ./menu.sh check              проверка сервера
  ./menu.sh backup [ПРИЧИНА]   полная проверенная резервная копия (подходит для cron)
  ./menu.sh verify КАТАЛОГ     проверить копию
  ./menu.sh restore-help       команды восстановления из выбранной копии

  Пункты меню можно запускать и напрямую (вопросы задаются так же):
  ./menu.sh install            установить Clean Pay
  ./menu.sh update             обновить Clean Pay
  ./menu.sh remnashop-update   обновить Remnashop
  ./menu.sh remnashop-install  установить Remnashop с нуля
EOF
}

load_settings
case "${1:-menu}" in
  menu) is_interactive || { usage; exit 1; }; main_menu ;;
  status) show_status ;;
  check) run_view check_server ;;
  backup) run_action backup_create "${2:-manual}" ;;
  verify) run_view backup_verify "${2:-}" ;;
  restore-help) run_view show_restore ;;
  install) run_action cp_install ;;
  update) run_action cp_update ;;
  remnashop-update) run_action rs_update ;;
  remnashop-install) run_action rs_install ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
