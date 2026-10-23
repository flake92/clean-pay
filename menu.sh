#!/usr/bin/env bash
# Clean Pay: interactive menu for installation, updates and backups.
#
#   ./menu.sh                 open the interactive menu
#   ./menu.sh status          print the status of Clean Pay, Remnashop and Remnawave
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
  *) if locale -a 2>/dev/null | grep -iE '^c[.]utf-?8$' >/dev/null; then export LC_ALL=C.UTF-8; fi ;;
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
# Clean Pay and Remnashop use the panel API of this version; the nodes must match it.
REMNAWAVE_MIN_VERSION=2.8.0
REMNANODE_MIN_VERSION=2.8.0
LAST_BACKUP_DIR=''
# deploy.sh's fail-closed lock; the menu inspects it before an update.
OPERATION_LOCK_FILE="$ROOT_DIR/deploy/prod/.production-operation.lock"
# deploy.sh checks CLEAN_PAY_MIN_FREE_DISK_MB before the build and again before
# install, when the new image pair (~1.5 GB) already exists.
CP_BUILD_SPACE_MB=1536
CLEAN_PAY_UPSTREAM_DEFAULT=https://github.com/flake92/clean-pay.git

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
  CLEAN_PAY_UPSTREAM=$(env_get "$MENU_CONF" CLEAN_PAY_UPSTREAM "$CLEAN_PAY_UPSTREAM_DEFAULT")
  RS_API=$(cp_env REMNASHOP_API_CONTAINER remnashop)
  RS_WORKER=$(cp_env REMNASHOP_WORKER_CONTAINER remnashop-taskiq-worker)
  RS_SCHEDULER=$(cp_env REMNASHOP_SCHEDULER_CONTAINER remnashop-taskiq-scheduler)
  RS_DB=$(cp_env REMNASHOP_POSTGRES_CONTAINER remnashop-db)
  RS_COMPOSE="$REMNASHOP_DIR/docker-compose.yml"
  RW_CONTAINER=$(env_get "$MENU_CONF" REMNAWAVE_CONTAINER remnawave)
  RW_DB=$(env_get "$MENU_CONF" REMNAWAVE_DB_CONTAINER remnawave-db)
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
    printf 'CLEAN_PAY_UPSTREAM=%s\n' "$CLEAN_PAY_UPSTREAM"
    printf 'REMNAWAVE_CONTAINER=%s\n' "$RW_CONTAINER"
    printf 'REMNAWAVE_DB_CONTAINER=%s\n' "$RW_DB"
  } > "$tmp" && chmod 600 "$tmp" && mv -f -- "$tmp" "$MENU_CONF"
}

valid_abs_path() { case "$1" in /*) [ "$1" != / ] && ! printf '%s' "$1" | grep '[[:space:]]' >/dev/null ;; *) return 1 ;; esac; }

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
    --format '{{.Names}}' 2>/dev/null | sed -n '1p'
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
  local app='' rev='' rs_rev='' rw_ver='' backup free
  if docker_ok; then
    app=$(cp_container app)
    [ -z "$app" ] || rev=$(short "$(container_revision "$app")")
    rs_rev=$(short "$(container_revision "$RS_API")")
    ! container_running "$RW_CONTAINER" || rw_ver=$(rw_version "$RW_CONTAINER")
  fi
  summary_component 'Clean Pay' "$app" "${rev:+версия $rev}"
  summary_component 'Remnashop' "$RS_API" "${rs_rev:+версия $rs_rev}"
  if docker_ok && container_exists "$RW_CONTAINER"; then
    summary_component 'Remnawave' "$RW_CONTAINER" "$(rw_version_text "$rw_ver")"
  fi
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

  printf '\n  %sRemnawave%s\n' "$C_BOLD" "$C_RESET"
  kv 'Требуется' "панель ≥ $REMNAWAVE_MIN_VERSION, ноды (remnanode) ≥ $REMNANODE_MIN_VERSION"
  if docker_ok && container_exists "$RW_CONTAINER"; then
    status_line "$RW_CONTAINER" "$RW_CONTAINER" "образ $(container_field "$RW_CONTAINER" '{{.Config.Image}}')"
    status_line "$RW_DB" "$RW_DB"
    kv 'Версия панели' "$(rw_version_text "$(rw_version "$RW_CONTAINER")")"
  else
    kv 'Панель' "не на этом сервере (контейнер $RW_CONTAINER не найден) — проверьте версию в самой панели"
  fi
  note 'Версии нод видны в панели (раздел «Ноды»); обновляются на серверах нод.'

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
  local rw_ver
  if docker_ok && container_running "$RW_CONTAINER"; then
    rw_ver=$(rw_version "$RW_CONTAINER")
    if [ -n "$rw_ver" ] && version_ge "$rw_ver" "$REMNAWAVE_MIN_VERSION"; then ok "Remnawave $rw_ver (нужно ≥ $REMNAWAVE_MIN_VERSION)"
    else err "Remnawave ${rw_ver:-?}: нужна $REMNAWAVE_MIN_VERSION или новее (пункт «Обновить Remnawave»)"; problems=$((problems + 1))
    fi
  else
    note "Remnawave не на этом сервере: убедитесь, что панель ≥ $REMNAWAVE_MIN_VERSION."
  fi
  note "Ноды (remnanode) должны быть ≥ $REMNANODE_MIN_VERSION — проверьте в панели, раздел «Ноды»."
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
  done | sed -n '1p'
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
    if container_running "$RW_CONTAINER"; then
      printf 'remnawave_image=%s\n' "$(container_field "$RW_CONTAINER" '{{.Config.Image}}')"
      printf 'remnawave_image_id=%s\n' "$(container_field "$RW_CONTAINER" '{{.Image}}')"
      printf 'remnawave_version=%s\n' "$(rw_version "$RW_CONTAINER")"
    fi
    if container_running "$RS_DB"; then
      printf 'remnashop_alembic=%s\n' "$(db_query "$RS_DB" 'SELECT version_num FROM alembic_version' 2>/dev/null)"
    fi
  } > "$dir/manifest.txt"
}

# Creates a complete, verified backup. Sets LAST_BACKUP_DIR on success.
backup_create() {
  local reason=${1:-manual} stamp dir cp_pg rs_db rw_dir need free entries caddyfile checksums items=0
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
  if container_running "$RW_DB"; then need=$(( need + $(database_size_mb "$RW_DB") )); fi
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
    if [ -d "$ROOT_DIR/public/brand" ] && [ ! -L "$ROOT_DIR/public/brand" ]; then
      cp -pR -- "$ROOT_DIR/public/brand" "$dir/config/clean-pay/brand" && note '  + public/brand/ (файлы бренда)'
    fi
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

  if container_running "$RW_DB"; then
    say '  Remnawave: база данных панели…'
    dump_database "$RW_DB" "$dir/remnawave.dump" || { mv -- "$dir" "$dir.FAILED"; die 'pg_dump Remnawave завершился ошибкой.'; }
    entries=$(verify_dump "$RW_DB" "$dir/remnawave.dump") \
      || { mv -- "$dir" "$dir.FAILED"; die 'Дамп Remnawave не читается (pg_restore --list).'; }
    ok "remnawave.dump — $(human_size "$dir/remnawave.dump"), объектов: $entries"
    rw_dir=$(container_field "$RW_CONTAINER" '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
    if [ -n "$rw_dir" ]; then
      say '  Remnawave: настройки…'
      copy_config "$dir/config/remnawave" "$rw_dir/.env" "$rw_dir/docker-compose.yml"
    fi
    items=$((items + 1))
  fi

  caddyfile=$(detect_caddyfile)
  if [ -n "$caddyfile" ] && [ -f "$caddyfile" ]; then
    say '  Caddy: конфигурация reverse proxy…'
    copy_config "$dir/config/caddy" "$caddyfile"
  fi

  write_manifest "$dir" "$reason"
  if [ "$items" -eq 0 ]; then
    note 'Сохранять пока нечего: Clean Pay, Remnashop и Remnawave не найдены. Записан только manifest.'
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
  note 'Базы Clean Pay, Remnashop и Remnawave (если она на этом сервере), все .env, compose-файлы и Caddyfile.'
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
      remnawave.dump) container=$RW_DB ;;
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
    # Before 0.3.2 the role provisioner rejected a catalog restored from a dump
    # (PostgreSQL flattens a nested CHECK), so install from such a revision fails.
    if [ -n "$app_head" ] && git -C "$ROOT_DIR" cat-file -e "$app_head^{commit}" 2>/dev/null \
      && ! git -C "$ROOT_DIR" show "$app_head:deploy/prod/database-privilege-manifest.mjs" 2>/dev/null \
        | grep restoredDefinitionSha256 >/dev/null; then
      say ''
      warn "Код копии ($(short "$app_head")) старше 0.3.2: его установщик не примет базу, восстановленную из дампа."
      if git -C "$ROOT_DIR" diff --quiet "$app_head" HEAD -- prisma/migrations 2>/dev/null; then
        note "  В шаге 3 оставьте текущий код ($(short "$(git -C "$ROOT_DIR" rev-parse HEAD)")): миграции те же. Настройки копируйте как указано."
      else
        note '  В шаге 3 возьмите 0.3.2 или новее с тем же набором prisma/migrations, что в копии.'
      fi
    fi
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
  if [ -f "$dir/remnawave.dump" ]; then
    cat <<EOF

  ${C_CYAN}Remnawave${C_RESET} (версия в копии: $(env_get "$dir/manifest.txt" remnawave_version '?'))
  1. Остановите панель (база продолжает работать):
     docker stop $RW_CONTAINER
  2. Восстановите базу:
     docker exec -i $RW_DB sh -c 'exec pg_restore -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" --clean --if-exists --single-transaction' < $dir/remnawave.dump
  3. Верните ту же версию панели: тег образа в docker-compose.yml панели —
     $(env_get "$dir/manifest.txt" remnawave_version '<версия из manifest.txt>'); прежние настройки — $dir/config/remnawave/
  4. Запустите: docker compose up -d в каталоге панели
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
  note 'Дальше — стандартные шаги deploy.sh: настройки (configure), затем установка (install).'
  sh "$DEPLOY_SCRIPT" configure || die 'Настройка не завершена — ничего не установлено.'
  load_settings
  # the key Clean Pay just generated must reach Remnashop before the compatibility check
  if container_exists "$RS_API"; then
    rs_secure_env
    rs_sync_auth_key restart \
      || warn 'Ключ не перенесён — установка остановится на проверке совместимости Remnashop.'
  fi
  if ! ask_yes_no 'DNS и HTTPS reverse proxy уже направляют домен Clean Pay на этот сервер?' no; then
    note 'Настройки сохранены. Когда будет готово, повторите этот пункт или выполните ./deploy.sh install'
    return 0
  fi
  ask_yes_no 'Собрать образы и запустить Clean Pay сейчас?' yes \
    || { note 'Настройки сохранены. Для продолжения: ./deploy.sh install'; return 0; }
  sh "$DEPLOY_SCRIPT" install || die 'Установка не прошла — причина в выводе выше.'
  journal clean-pay-install "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null)"
}

# ─── Clean Pay: обновление ──────────────────────────────────────────────────

# "branches" skips the tag list: the Remnashop fork only carries the upstream tags.
show_remote_refs() {
  local git_dir=$1 remote=$2 only=${3:-}
  if [ "$only" != branches ]; then
    printf '  %sПоследние теги:%s ' "$C_DIM" "$C_RESET" >&2
    { git --git-dir="$git_dir" ls-remote --tags --refs "$remote" 2>/dev/null || true; } \
      | awk '{sub("refs/tags/", "", $2); print $2}' | sort -V | tail -n 5 | tr '\n' ' ' >&2
    printf '\n' >&2
  fi
  printf '  %sВетки:%s ' "$C_DIM" "$C_RESET" >&2
  { git --git-dir="$git_dir" ls-remote --heads "$remote" 2>/dev/null || true; } \
    | awk '{sub("refs/heads/", "", $2); print $2}' | sed -n '1,8p' | tr '\n' ' ' >&2
  printf '\n' >&2
}

# Fetches exactly one ref (tag, branch or 40-hex SHA) and prints its commit SHA.
fetch_ref() {
  local git_dir=$1 remote=$2 ref=$3 spec
  case "$ref" in
    '') return 1 ;;
    *[!A-Za-z0-9._/-]*) err 'Недопустимые символы в имени версии.'; return 1 ;;
  esac
  if printf '%s' "$ref" | grep -E '^[0-9a-f]{40}$' >/dev/null; then
    spec=$ref
  elif git --git-dir="$git_dir" ls-remote --exit-code --tags --refs "$remote" "refs/tags/$ref" >/dev/null 2>&1; then
    spec="refs/tags/$ref"
  else
    spec="refs/heads/$ref"
  fi
  git --git-dir="$git_dir" fetch --no-tags --quiet "$remote" "$spec" || return 1
  git --git-dir="$git_dir" rev-parse 'FETCH_HEAD^{commit}'
}

# Owners who rebrand by editing public/ make the checkout dirty, and a later
# build from a clean tree drops their files. public/brand/ is the supported
# place: git ignores it, updates keep it and the image build copies it.
cp_brand_assets_hint() {
  say ''
  warn 'Похоже, в public/ лежат ваши файлы бренда (логотип, иконки).'
  note 'Их место — каталог public/brand/: git его не отслеживает, обновления его не трогают,'
  note 'а сборка образа его забирает. Перенесите туда свои файлы, затем верните штатные:'
  note "  mkdir -p $ROOT_DIR/public/brand && mv <ваши файлы> $ROOT_DIR/public/brand/"
  note "  git -C $ROOT_DIR checkout -- public"
  note 'и укажите путь к логотипу в .env: NEXT_PUBLIC_BRAND_LOGO_URL=/brand/<файл> (пункт 6).'
  note 'Имена иконок (favicon.ico, apple-touch-icon.png, icon-192.png, …) — в README, раздел «Свой бренд».'
}

# "0.4.1 (64d9e05)": the release version of a commit, read from its package.json.
cp_version_at() {
  local version
  version=$(git -C "$ROOT_DIR" show "$1:package.json" 2>/dev/null \
    | sed -n 's/^  "version": "\([^"]*\)",*$/\1/p' | sed -n '1p')
  printf '%s (%s)' "${version:-?}" "$(short "$1")"
}

# Newest vX.Y.Z tag in origin when it is newer than the checkout; empty otherwise.
cp_newer_release() {
  local current latest
  current=$(git -C "$ROOT_DIR" show HEAD:package.json 2>/dev/null \
    | sed -n 's/^  "version": "\([^"]*\)",*$/\1/p' | sed -n '1p')
  latest=$({ timeout 8 git -C "$ROOT_DIR" ls-remote --tags --refs origin 2>/dev/null || true; } \
    | sed -n 's#.*refs/tags/v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' | sort -V | tail -n 1)
  if [ -n "$current" ] && [ -n "$latest" ] && ! version_ge "$current" "$latest"; then
    printf '%s' "$latest"
  fi
}

# A local-path origin (such as /opt/deploy-sources/clean-pay.git) is a mirror
# nothing else keeps current; offer to refresh it before listing versions.
cp_refresh_local_origin() {
  local url mirror upstream updated age
  url=$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null) || return 0
  mirror=${url#file://}
  [ -d "$mirror" ] || return 0
  upstream=$(git --git-dir="$mirror" remote get-url origin 2>/dev/null || true)
  [ -n "$upstream" ] || upstream=$CLEAN_PAY_UPSTREAM
  updated=$(stat -c %Y "$mirror/FETCH_HEAD" 2>/dev/null || stat -c %Y "$mirror" 2>/dev/null || date +%s)
  age=$(( ($(date +%s) - updated) / 86400 ))
  note "Версии берутся из локального зеркала $mirror (обновлялось $age дн. назад)."
  ask_yes_no "Обновить зеркало из $upstream?" yes || return 0
  if git --git-dir="$mirror" fetch --prune --quiet "$upstream" \
    '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'; then
    ok 'Зеркало обновлено'
  else
    warn 'Зеркало обновить не удалось — показаны версии, которые в нём уже есть.'
  fi
}

lock_field() { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p" "$1" | sed -n '1p'; }

# deploy.sh refuses to start while its fail-closed operation lock exists. Check
# it before the backup and offer the reviewed recovery for a lock whose owner is
# gone (for example a configure run killed days ago): the lock is released by
# the reviewed helper with its own token, never deleted blindly.
cp_check_operation_lock() {
  [ -f "$OPERATION_LOCK_FILE" ] || return 0
  local operation owner started token
  operation=$(lock_field "$OPERATION_LOCK_FILE" operation)
  owner=$(lock_field "$OPERATION_LOCK_FILE" ownerPid)
  started=$(lock_field "$OPERATION_LOCK_FILE" startedAt)
  token=$(lock_field "$OPERATION_LOCK_FILE" token)
  warn "Найден замок операции «${operation:-?}» от ${started:-?} (процесс ${owner:-?})."
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    die "Операция «$operation» ещё выполняется (процесс $owner) — дождитесь её завершения."
  fi
  if have pgrep && pgrep -f 'deploy[.]sh' >/dev/null 2>&1; then
    die 'Сейчас выполняется deploy.sh — дождитесь его завершения и повторите.'
  fi
  note 'Процесса-владельца уже нет: замок остался от прерванной операции.'
  ask_yes_no 'Снять брошенный замок (копия сохранится в каталоге копий)?' no \
    || die 'Замок оставлен — пока он есть, deploy.sh не начнёт обновление.'
  mkdir -p "$BACKUP_DIR"
  cp -p -- "$OPERATION_LOCK_FILE" "$BACKUP_DIR/stale-operation-lock-$(date +%Y%m%d-%H%M%S)"
  CLEAN_PAY_PRODUCTION_OPERATION_LOCK_PATH=$OPERATION_LOCK_FILE \
    sh "$NODE_TOOLING_SCRIPT" operation-lock release "$token" \
    || die 'Штатно снять замок не удалось — проверьте его вручную.'
  journal operation-lock-recovered "${operation:-?} ${started:-?} pid ${owner:-?}"
  ok 'Брошенный замок снят'
}

# Checks, before the backup, the space deploy.sh will demand at install time:
# its threshold plus the new images. Runs the same safe cleanup deploy.sh would
# and drops older release images (keeping the running one), so an update never
# starts unless it can finish.
cp_ensure_disk_space() {
  local current_image=$1 min need free
  min=$(cp_env CLEAN_PAY_MIN_FREE_DISK_MB 8192)
  need=$((min + CP_BUILD_SPACE_MB))
  free=$(free_mb "$ROOT_DIR")
  if [ "${free:-0}" -lt "$need" ]; then
    note "Свободно $(human_mb "${free:-0}"), нужно ≥ $(human_mb "$need") — очищаю кэш сборки и старые образы…"
    docker builder prune -af --filter until=24h >/dev/null 2>&1 || true
    docker image prune -f >/dev/null 2>&1 || true
    cp_prune_release_images "${current_image##*:}" "${current_image##*:}" \
      "${current_image%:*}" "$(cp_env CLEAN_PAY_MIGRATION_IMAGE clean-pay-prod-migration:local | sed 's/:[^:]*$//')"
    free=$(free_mb "$ROOT_DIR")
  fi
  if [ "${free:-0}" -ge "$need" ]; then
    ok "Свободно $(human_mb "$free") (нужно ≥ $(human_mb "$need"))"
    return 0
  fi
  err "Свободно $(human_mb "${free:-0}"), а для сборки и установки нужно ≥ $(human_mb "$need"):"
  note "порог CLEAN_PAY_MIN_FREE_DISK_MB=$min плюс ~$(human_mb "$CP_BUILD_SPACE_MB") на новые образы."
  docker system df 2>/dev/null | sed 's/^/    /' || true
  die 'Освободите место (или уменьшите порог в .env) и повторите — ничего не изменено.'
}

# deploy.sh install stops nothing until its preflight checks pass. When the app
# still runs the previous image, the failure happened before any change.
cp_runtime_untouched() {
  local app
  app=$(cp_container app)
  [ -n "$app" ] && container_running "$app" \
    && [ "$(container_field "$app" '{{.Config.Image}}')" = "$1" ]
}

# The running menu is a private copy of the menu.sh checked out when it started.
# After an update switched the checkout, restart into the new menu so its fixes
# apply at once instead of the old code driving the next update.
menu_reload_if_updated() {
  local before=$1 now
  now=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null) || return 0
  [ "$now" != "$before" ] || return 0
  pause
  note 'Код обновлён — перезапускаю меню новой версии…'
  [ -z "${CLEAN_PAY_MENU_COPY:-}" ] || rm -f -- "$CLEAN_PAY_MENU_COPY"
  exec env CLEAN_PAY_MENU_ROOT= CLEAN_PAY_MENU_COPY= bash "$ROOT_DIR/menu.sh"
}

# Every update builds a new pair of SHA-tagged images (~1.4 GB). After a
# successful install, remove the SHA-tagged images of older updates so the disk
# does not fill up. The new release and the one it replaced (quick rollback)
# stay; other tags and images still used by a container are never removed.
cp_prune_release_images() {
  local keep_new=$1 keep_previous=$2 repository image tag removed=0
  shift 2
  for repository in "$@"; do
    for image in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository" 2>/dev/null); do
      tag=${image##*:}
      printf '%s' "$tag" | grep -E '^[0-9a-f]{40}$' >/dev/null || continue
      [ "$tag" != "$keep_new" ] && [ "$tag" != "$keep_previous" ] || continue
      if docker image rm "$image" >/dev/null 2>&1; then removed=$((removed + 1)); fi
    done
  done
  [ "$removed" -eq 0 ] && return 0
  if [ "$keep_new" = "$keep_previous" ]; then
    ok "Удалены образы старых версий: $removed (оставлена работающая)"
  else
    ok "Удалены образы старых версий: $removed (оставлены текущая и предыдущая для отката)"
  fi
}

cp_update() {
  title 'Обновление Clean Pay' 'Копия → новая версия кода → сборка (сайт работает) → установка (короткий простой)'
  cp_installed || die 'Clean Pay не установлен (нет deploy/prod/.env). Используйте установку.'
  need_docker
  need_git
  local git_dir head dirty ref target subject migrations changed ancestor
  git_dir=$(git -C "$ROOT_DIR" rev-parse --absolute-git-dir)
  head=$(git -C "$ROOT_DIR" rev-parse HEAD)
  dirty=$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all)
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" | sed -n '1,10p' | sed 's/^/    /'
    if printf '%s\n' "$dirty" | grep -E '^.. public/' >/dev/null; then
      cp_brand_assets_hint
    fi
    die 'В каталоге есть незафиксированные изменения — обновление из «грязного» checkout запрещено.'
  fi

  step 1 6 'Выбор версии'
  kv 'Сейчас установлено' "$(cp_version_at "$head") $(git -C "$ROOT_DIR" log -1 --format='%cs %s' | cut -c1-50)"
  cp_refresh_local_origin
  show_remote_refs "$git_dir" origin
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$git_dir" origin "$ref") || die "Версия «$ref» не найдена в origin."
  if [ "$target" = "$head" ]; then
    ok 'Эта версия уже установлена.'
    # The logo path and public/ files are baked into the image, so brand changes
    # need a rebuild of the same version.
    ask_yes_no 'Пересобрать её (например, после изменения файлов в public/brand/)?' no || return 0
  fi
  subject=$(git -C "$ROOT_DIR" log -1 --format='%cs %s' "$target" | cut -c1-70)
  changed=$(git -C "$ROOT_DIR" diff --name-only "$head" "$target" | wc -l | tr -d ' ')
  migrations=$(git -C "$ROOT_DIR" diff --name-only --diff-filter=A "$head" "$target" -- prisma/migrations \
    | grep -c '/migration\.sql$' || true)
  if git -C "$ROOT_DIR" merge-base --is-ancestor "$head" "$target" 2>/dev/null; then ancestor=yes; else ancestor=no; fi
  say ''
  kv 'Новая версия' "$(cp_version_at "$target") $subject"
  if [ "$ancestor" = yes ]; then
    note 'Изменения:'
    git -C "$ROOT_DIR" log --oneline --no-merges "$head..$target" | sed -n '1,15p' | sed 's/^/      /'
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
  cp_check_operation_lock
  cp_ensure_disk_space "$(cp_env CLEAN_PAY_IMAGE clean-pay-prod-app:local)"
  ask_yes_no "Обновить Clean Pay до $(short "$target")?" no || { note 'Отменено, ничего не изменено.'; return 0; }

  step 3 6 'Резервная копия'
  require_backup "before-clean-pay-$(short "$target")"
  if container_exists "$RS_API"; then
    rs_secure_env
    rs_sync_auth_key restart || die 'Без общего ключа установка не пройдёт проверку Remnashop. Код ещё не переключён.'
  fi

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
    if [ "$traceable" = yes ]; then
      cp_prune_release_images "$target" "${old_image##*:}" "${old_image%:*}" "${old_migration_image%:*}"
    fi
    note 'Проверьте вход, создание платежа и выдачу подписки.'
    return 0
  fi

  journal clean-pay-update-failed "install $(short "$head") -> $(short "$target")"
  if cp_runtime_untouched "$old_image"; then
    cp_restore_code
    err 'Установка не началась: не прошли проверки перед установкой (подробности выше).'
    ok "Сайт работает на прежней версии $(cp_version_at "$head"); код и релизные поля .env возвращены."
    note "Резервная копия: $LAST_BACKUP_DIR"
    return 1
  fi
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

rs_has_service() { rs_compose config --services 2>/dev/null | grep -x "$1" >/dev/null; }

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

# Rejects a Remnashop commit without the Clean Pay integration before anything is built.
# The upstream tags (v0.8.x) predate it, and deploy.sh would then fail its compatibility
# preflight; the floor is the one prepare-remnashop-rollout.sh enforces.
rs_check_compatible() {
  local target=$1 floor head
  floor=$(sed -n 's/^repository_minimum_revision=\([0-9][0-9]*\)$/\1/p' \
    "$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh")
  [ -n "$floor" ] || die 'Не удалось прочитать минимальную ревизию Remnashop из prepare-remnashop-rollout.sh.'
  head=$(git --git-dir="$REMNASHOP_SOURCES" ls-tree --name-only "$target" \
      src/infrastructure/database/migrations/versions/ \
    | sed -n 's#.*/\([0-9][0-9]*\)_[^/]*\.py$#\1#p' | sort -n | tail -n 1)
  if [ -z "$head" ] || [ "$((10#$head))" -lt "$((10#$floor))" ] \
    || ! git --git-dir="$REMNASHOP_SOURCES" grep -q 'notification-preferences' "$target" -- src; then
    err "Версия $(short "$target") не совместима с Clean Pay: миграции до ${head:-?}, нужна $floor и API notification-preferences."
    note 'Теги v0.x — это релизы апстрима snoups без интеграции с Clean Pay. Выберите ветку main.'
    return 1
  fi
}

# Builds the image for a commit and prints its local reference.
# Copies the Remnashop container health checks (web / taskiq) from the compose template
# of the release being installed into an existing compose file. Only the healthcheck
# timing keys that follow those test lines are replaced, at the existing indentation; the
# rest of the file is printed unchanged. Templates without these blocks change nothing.
# $1 template compose, $2 current compose, $3 = 1 to drop start_interval (Engine < 25).
rs_sync_healthchecks() {
  awk -v drop_start_interval="${3:-0}" '
    function kind(line) {
      if (index(line, "src.infrastructure.healthcheck\", \"web\"]")) return "web"
      if (index(line, "src.infrastructure.healthcheck\", \"taskiq\"]")) return "taskiq"
      return ""
    }
    function indent(line) { match(line, /^ */); return RLENGTH }
    function timing_key(line, ind,   rest) {
      if (indent(line) != ind) return 0
      rest = substr(line, ind + 1)
      return rest ~ /^(interval|timeout|retries|start_period|start_interval):/
    }
    function block_comment(line, ind) { return indent(line) == ind && substr(line, ind + 1) ~ /^#/ }
    FNR == NR {
      if (cur != "" && block_comment($0, curind)) next
      if (cur != "" && timing_key($0, curind)) {
        if (!(drop_start_interval == 1 && substr($0, curind + 1) ~ /^start_interval:/)) {
          n[cur]++; blk[cur, n[cur]] = substr($0, curind + 1)
        }
        next
      }
      cur = ""
      k = kind($0)
      if (k != "" && !(k in n)) { cur = k; curind = indent($0); n[k] = 0 }
      next
    }
    {
      if (skip && (timing_key($0, skipind) || block_comment($0, skipind))) next
      skip = 0
      print
      k = kind($0)
      if (k != "" && (k in n) && n[k] > 0) {
        ind = indent($0); pad = sprintf("%" ind "s", "")
        for (i = 1; i <= n[k]; i++) print pad blk[k, i]
        skip = 1; skipind = ind
      }
    }
  ' "$1" "$2"
}

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

# Containers without a health check (the upstream compose) count as ready once
# they have kept running, without a restart, for a minute (six polls): a crashing
# app restarts well within that window.
rs_wait_healthy() {
  local i states restarts last_restarts='' running_polls=0
  for i in $(seq 1 60); do
    states=$({ docker inspect "$RS_API" "$RS_WORKER" "$RS_SCHEDULER" \
      --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true; } \
      | sort -u | tr '\n' ' ')
    restarts=$({ docker inspect "$RS_API" "$RS_WORKER" "$RS_SCHEDULER" --format '{{.RestartCount}}' 2>/dev/null || true; } | tr '\n' ' ')
    printf '\r  Ожидание готовности (%s/60): %s   ' "$i" "$states"
    if [ "$states" = 'running/healthy ' ]; then printf '\n'; return 0; fi
    case "$states" in *exited*|*unhealthy*|*dead*) printf '\n'; return 1 ;; esac
    case "$states" in
      'running/none '|'running/healthy running/none ')
        if [ "$restarts" = "$last_restarts" ]; then running_polls=$((running_polls + 1)); else running_polls=1; fi
        if [ "$running_polls" -ge 6 ]; then printf '\n'; return 0; fi ;;
      *) running_polls=0 ;;
    esac
    last_restarts=$restarts
    sleep 10
  done
  printf '\n'
  return 1
}

# 1 when the Docker Engine predates healthcheck start_interval (Engine 25).
rs_drop_start_interval() {
  local major
  major=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
  case "$major" in ''|*[!0-9]*) printf 1 ;; *) if [ "$major" -ge 25 ]; then printf 0; else printf 1; fi ;; esac
}

# An install made from the upstream snoups compose (image ghcr.io/snoups/remnashop,
# migrations inside the app container) has no remnashop-migration service. Moving it
# to this build writes the release compose and adds the keys it requires to a copy
# of the existing .env; the database and Redis volumes keep their names.
rs_adopt_files() {
  local target=$1 image=$2 compose_out=$3 env_out=$4 web=$5 key template
  template=$(mktemp)
  git --git-dir="$REMNASHOP_SOURCES" show "$target:docker-compose.prod.internal.yml" > "$template" \
    || { rm -f -- "$template"; return 1; }
  [ "$(grep -c '^  image: ghcr.io/' "$template")" = 1 ] \
    || { rm -f -- "$template"; err 'Шаблон compose изменился: не найдена единственная строка образа ghcr.io.'; return 1; }
  awk -v image="$image" '/^  image: ghcr.io\// { print "  image: " image; next } { print }' "$template" > "$compose_out"
  if [ "$(rs_drop_start_interval)" = 1 ]; then
    rs_sync_healthchecks "$template" "$compose_out" 1 > "$template.synced" && mv -f -- "$template.synced" "$compose_out"
  fi
  rm -f -- "$template" "$template.synced"
  chmod 600 "$compose_out"
  cp -p -- "$REMNASHOP_DIR/.env" "$env_out"
  chmod 600 "$env_out"
  rs_env_placeholder "$env_out" TASKIQ_DEPLOYMENT_ID && rs_env_set "$env_out" TASKIQ_DEPLOYMENT_ID "$(openssl rand -hex 12)"
  rs_env_placeholder "$env_out" REDIS_PASSWORD && rs_env_set "$env_out" REDIS_PASSWORD "$(openssl rand -hex 24)"
  for key in APP_JWT_SECRET APP_API_KEY APP_AUTH_SERVICE_KEY; do
    rs_env_placeholder "$env_out" "$key" && rs_env_set "$env_out" "$key" "$(openssl rand -hex 32)"
  done
  [ -z "$web" ] || rs_env_set "$env_out" WEB_ENABLED "$web"
  return 0
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
  local layout=build env_before='' web=''
  rs_compose config --quiet || die "$RS_COMPOSE не проходит docker compose config — исправьте его, ничего не изменено."
  rs_has_service remnashop-migration || layout=upstream

  step 1 6 'Выбор версии'
  kv 'Сейчас работает' "$current_image"
  if [ "$layout" = upstream ]; then
    warn 'Remnashop установлен по compose апстрима snoups (нет сервиса remnashop-migration).'
    note 'Обновление переведёт его на сборку Clean Pay: новый compose из выбранной версии,'
    note 'в .env добавятся недостающие ключи (старые значения сохраняются), база и Redis'
    note 'остаются в тех же томах. Пока не начались миграции, всё возвращается как было.'
    have openssl || die 'Нужен openssl для генерации недостающих ключей.'
    [ "$(id -u)" -eq 0 ] || die 'Перевод на сборку Clean Pay нужно запускать от root (права на каталоги для uid 10001).'
  fi
  rs_prepare_sources
  show_remote_refs "$REMNASHOP_SOURCES" origin branches
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$REMNASHOP_SOURCES" origin "$ref") || die "Версия «$ref» не найдена."
  [ "$target" != "$current_rev" ] || { ok 'Эта версия уже работает.'; return 0; }
  kv 'Новая версия' "$(short "$target") $(git --git-dir="$REMNASHOP_SOURCES" log -1 --format='%cs %s' "$target" | cut -c1-60)"
  rs_check_compatible "$target" || die 'Обновление отменено, ничего не изменено.'
  if [ -n "$current_rev" ] && git --git-dir="$REMNASHOP_SOURCES" cat-file -e "$current_rev^{commit}" 2>/dev/null; then
    note 'Изменения:'
    git --git-dir="$REMNASHOP_SOURCES" log --oneline --no-merges "$current_rev..$target" | sed -n '1,15p' | sed 's/^/      /'
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
  if [ "$pending" = yes ] && [ "$layout" = build ] && ! rs_has_service remnashop-migration; then
    die "В $RS_COMPOSE нет сервиса remnashop-migration — миграции применить нечем. Ничего не изменено."
  fi
  if [ "$layout" = upstream ] && [ -z "$(env_get "$REMNASHOP_DIR/.env" WEB_ENABLED)" ]; then
    if ask_yes_no 'Включить HTTP API для Clean Pay (WEB_ENABLED=true)?' yes; then web=true; else web=false; fi
  fi
  if [ "$layout" = upstream ]; then
    ask_yes_no "Перевести Remnashop на сборку Clean Pay $(short "$target")?" no || { note 'Отменено. Работающие сервисы не затронуты.'; return 0; }
  else
    ask_yes_no "Обновить Remnashop до $(short "$target")?" no || { note 'Отменено. Работающие сервисы не затронуты.'; return 0; }
  fi

  step 4 6 'Резервная копия'
  require_backup "before-remnashop-$(short "$target")"
  rs_secure_env
  compose_before="$LAST_BACKUP_DIR/config/remnashop/docker-compose.yml"
  [ -f "$compose_before" ] || die 'В копии нет compose-файла Remnashop — откат был бы невозможен.'
  if [ "$layout" = upstream ]; then
    env_before="$LAST_BACKUP_DIR/config/remnashop/.env"
    [ -f "$env_before" ] || die 'В копии нет .env Remnashop — откат был бы невозможен.'
  fi

  rs_rollback() {
    warn 'Возвращаю предыдущую версию…'
    cp -p -- "$compose_before" "$RS_COMPOSE"
    if [ -n "$env_before" ]; then
      cp -p -- "$env_before" "$REMNASHOP_DIR/.env"
      rs_compose up -d --force-recreate --remove-orphans || true
    else
      rs_compose up -d --no-deps --force-recreate "$api_svc" "$worker_svc" "$scheduler_svc" || true
    fi
    if rs_wait_healthy; then warn "Предыдущая версия ($current_image) снова работает."
    else err 'Предыдущая версия не стала healthy — нужна ручная проверка.'
    fi
  }

  if [ "$layout" = upstream ]; then
    step 5 6 'Новый compose и .env (сервисы ещё работают)'
    if ! rs_adopt_files "$target" "$image" "$RS_COMPOSE.new" "$REMNASHOP_DIR/.env.new" "$web" \
      || ! docker compose --project-directory "$REMNASHOP_DIR" -f "$RS_COMPOSE.new" \
        --env-file "$REMNASHOP_DIR/.env.new" config --quiet; then
      rm -f -- "$RS_COMPOSE.new" "$REMNASHOP_DIR/.env.new"
      die 'Новый compose или .env не прошли проверку. Ничего не изменено.'
    fi
    mkdir -p "$REMNASHOP_DIR/logs" "$REMNASHOP_DIR/assets" "$REMNASHOP_DIR/backups"
    chown -R 10001:10001 "$REMNASHOP_DIR/logs" "$REMNASHOP_DIR/assets" "$REMNASHOP_DIR/backups"
    mv -f -- "$REMNASHOP_DIR/.env.new" "$REMNASHOP_DIR/.env"
    mv -f -- "$RS_COMPOSE.new" "$RS_COMPOSE"
    api_svc=remnashop; worker_svc=remnashop-taskiq-worker; scheduler_svc=remnashop-taskiq-scheduler
    ok "compose и .env переведены на сборку Clean Pay (прежние — в $LAST_BACKUP_DIR/config/remnashop)"

    step 6 6 'Перезапуск: база и Redis → миграции → сервисы'
    note 'Остановка API, worker и scheduler…'
    rs_compose stop "$api_svc" "$worker_svc" "$scheduler_svc"
    if ! rs_compose up -d --wait --wait-timeout 180 remnashop-db remnashop-redis; then
      err 'База или Redis не запустились в новой конфигурации.'
      rs_rollback
      journal remnashop-update-failed "adopt db/redis $(short "$target")"
      return 1
    fi
    rs_compose run --rm --no-deps remnashop-storage-init
    pending=yes
  else
  step 5 6 'Переключение compose на новый образ'
  replaced=$(grep -cF "image: $current_image" "$RS_COMPOSE" || true)
  [ "$replaced" = 1 ] || die "В $RS_COMPOSE ожидалась ровно одна строка «image: $current_image» (найдено: $replaced). Обновите вручную."
  awk -v old="image: $current_image" -v new="image: $image" \
    '{ i = index($0, old); if (i) { $0 = substr($0, 1, i - 1) new substr($0, i + length(old)) } print }' \
    "$compose_before" > "$RS_COMPOSE.new"
  chmod --reference="$compose_before" "$RS_COMPOSE.new" 2>/dev/null || true
  mv -f -- "$RS_COMPOSE.new" "$RS_COMPOSE"
  # health checks follow the new release (e.g. intervals), the rest of compose stays as is
  local hc_template engine_major drop_start_interval=0
  hc_template=$(mktemp)
  if git --git-dir="$REMNASHOP_SOURCES" show "$target:docker-compose.prod.internal.yml" > "$hc_template" 2>/dev/null \
    && [ -s "$hc_template" ]; then
    engine_major=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
    case "$engine_major" in ''|*[!0-9]*) drop_start_interval=1 ;; *) [ "$engine_major" -ge 25 ] || drop_start_interval=1 ;; esac
    if ! rs_sync_healthchecks "$hc_template" "$RS_COMPOSE" "$drop_start_interval" > "$RS_COMPOSE.new"; then
      rm -f -- "$RS_COMPOSE.new" "$hc_template"; cp -p -- "$compose_before" "$RS_COMPOSE"
      die 'Не удалось перенести проверки здоровья — возвращён прежний compose.'
    fi
    chmod --reference="$compose_before" "$RS_COMPOSE.new" 2>/dev/null || true
    if cmp -s -- "$RS_COMPOSE" "$RS_COMPOSE.new"; then
      rm -f -- "$RS_COMPOSE.new"
    else
      mv -f -- "$RS_COMPOSE.new" "$RS_COMPOSE"
      ok "Проверки здоровья обновлены по версии $(short "$target")"
    fi
  fi
  rm -f -- "$hc_template"
  if ! rs_compose config --quiet; then cp -p -- "$compose_before" "$RS_COMPOSE"; die 'Новый compose не прошёл проверку — возвращён прежний.'; fi
  ok "compose указывает на $image"

  step 6 6 'Перезапуск'
  if [ "$pending" = yes ]; then
    note 'Остановка API, worker и scheduler…'
    rs_compose stop "$api_svc" "$worker_svc" "$scheduler_svc"
    if rs_has_service remnashop-storage-init; then rs_compose run --rm --no-deps remnashop-storage-init; fi
  fi
  fi
  if [ "$pending" = yes ]; then
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
  rs_sync_auth_key || true
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
    else warn 'Проверка совместимости с Clean Pay не прошла — посмотрите вывод выше и пункт «Связать с Clean Pay».'
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

# Clean Pay reads the Remnashop .env only from a private root directory
# (700/750) and a private file (600/400); mkdir and the upstream installer leave 755/644.
rs_secure_env() {
  local mode
  [ -d "$REMNASHOP_DIR" ] || return 0
  mode=$(stat -c '%a' "$REMNASHOP_DIR" 2>/dev/null) || return 0
  case "$mode" in 700|750) ;; *) chmod 750 "$REMNASHOP_DIR" && ok "Права каталога $REMNASHOP_DIR: $mode → 750" ;; esac
  [ -f "$REMNASHOP_DIR/.env" ] || return 0
  mode=$(stat -c '%a' "$REMNASHOP_DIR/.env" 2>/dev/null) || return 0
  case "$mode" in 600|400) ;; *) chmod 600 "$REMNASHOP_DIR/.env" && ok "Права $REMNASHOP_DIR/.env: $mode → 600" ;; esac
  return 0
}

# Clean Pay authenticates to Remnashop with one shared key: REMNASHOP_AUTH_SERVICE_KEY
# in deploy/prod/.env must equal APP_AUTH_SERVICE_KEY in the Remnashop .env, otherwise
# Remnashop answers 401. Copies the Clean Pay value over; with "restart" it also
# recreates API, worker and scheduler so they read it. Values are never printed.
rs_sync_auth_key() {
  local restart=${1:-} rs_env="$REMNASHOP_DIR/.env" cp_key rs_key api_key
  cp_installed && [ -f "$rs_env" ] || return 0
  cp_key=$(cp_env REMNASHOP_AUTH_SERVICE_KEY)
  case "$cp_key" in ''|*change-me*|*change_me*) return 0 ;; esac
  rs_key=$(env_get "$rs_env" APP_AUTH_SERVICE_KEY)
  if [ "$cp_key" = "$rs_key" ]; then ok 'Ключ auth-сервиса Clean Pay и Remnashop совпадает'; return 0; fi
  api_key=$(env_get "$rs_env" APP_API_KEY)
  [ "$cp_key" != "$api_key" ] || { err 'REMNASHOP_AUTH_SERVICE_KEY Clean Pay совпадает с APP_API_KEY Remnashop — так нельзя, задайте другой.'; return 1; }
  warn "Ключ auth-сервиса не совпадает: REMNASHOP_AUTH_SERVICE_KEY ($ENV_FILE) ≠ APP_AUTH_SERVICE_KEY ($rs_env)."
  note 'Без этого Remnashop отвечает Clean Pay 401 и проверка совместимости не проходит.'
  if [ "$restart" = restart ]; then
    ask_yes_no 'Записать ключ Clean Pay в Remnashop и перезапустить API, worker и scheduler (~30 с)?' yes || return 1
  fi
  rs_env_set "$rs_env" APP_AUTH_SERVICE_KEY "$cp_key"
  ok "APP_AUTH_SERVICE_KEY в $rs_env обновлён"
  [ "$restart" = restart ] || return 0
  if ! rs_compose up -d --no-deps --force-recreate \
    "$(rs_service_of "$RS_API" remnashop)" \
    "$(rs_service_of "$RS_WORKER" remnashop-taskiq-worker)" \
    "$(rs_service_of "$RS_SCHEDULER" remnashop-taskiq-scheduler)" \
    || ! rs_wait_healthy; then
    err 'Remnashop не стал healthy после перезапуска — смотрите «Логи сервисов».'
    return 1
  fi
  ok 'Remnashop перезапущен с ключом Clean Pay'
}

# Menu item: everything Clean Pay needs from the local Remnashop, then the real check.
rs_link() {
  title 'Связь Clean Pay ↔ Remnashop' 'Права .env → общий ключ → проверка совместимости'
  need_docker
  cp_installed || die 'Clean Pay не установлен (нет deploy/prod/.env).'
  [ -f "$REMNASHOP_DIR/.env" ] || die "Не найден $REMNASHOP_DIR/.env."
  [ "$(id -u)" -eq 0 ] || die 'Запустите от root: нужны права на .env Remnashop.'
  rs_secure_env
  rs_sync_auth_key restart || return 1
  [ -f "$REMNASHOP_CHECK_SCRIPT" ] || return 0
  note 'Проверка совместимости с Clean Pay…'
  if sh "$REMNASHOP_CHECK_SCRIPT" "$ENV_FILE" check; then ok 'Clean Pay и Remnashop совместимы'
  else err 'Проверка не прошла — посмотрите вывод выше.'; return 1
  fi
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
  show_remote_refs "$REMNASHOP_SOURCES" origin branches
  ref=$(ask_value 'Тег, ветка или полный SHA' main)
  target=$(fetch_ref "$REMNASHOP_SOURCES" origin "$ref") || die "Версия «$ref» не найдена."
  kv 'Версия' "$(short "$target") $(git --git-dir="$REMNASHOP_SOURCES" log -1 --format='%cs %s' "$target" | cut -c1-60)"
  rs_check_compatible "$target" || die 'Установка отменена: сборка не начиналась.'

  step 3 7 'Сборка образа'
  image=$(rs_build_image "$target")
  source="$REMNASHOP_STAGING/remnashop-$target/source"
  if [ ! -f "$source/docker-compose.prod.internal.yml" ] || [ ! -f "$source/.env.example" ]; then
    die 'В исходниках нет docker-compose.prod.internal.yml или .env.example.'
  fi

  step 4 7 'Каталог и compose'
  mkdir -p "$REMNASHOP_DIR"
  chmod 750 "$REMNASHOP_DIR"
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
  rs_sync_auth_key
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
  • общий ключ REMNASHOP_AUTH_SERVICE_KEY → APP_AUTH_SERVICE_KEY меню переносит само
    при установке и обновлении Clean Pay; отдельно — пункт «Связать с Clean Pay».
EOF
}

# ─── Справка и настройки ────────────────────────────────────────────────────

# ─── Remnawave ──────────────────────────────────────────────────────────────

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | sed -n '1p')" = "$2" ]; }

# Version from the backend package; works for a running container or an image.
rw_version() {
  docker exec "$1" node -p "require('/opt/app/package.json').version" 2>/dev/null || true
}

rw_image_version() {
  docker run --rm --network none --entrypoint node "$1" \
    -p "require('/opt/app/package.json').version" 2>/dev/null || true
}

# "2.8.0 (нужно ≥ 2.8.0)" in the colour of the verdict.
rw_version_text() {
  local version=$1
  if [ -z "$version" ]; then printf '%s?%s' "$C_YELLOW" "$C_RESET"
  elif version_ge "$version" "$REMNAWAVE_MIN_VERSION"; then printf '%s' "$version"
  else printf '%s%s — нужна %s или новее%s' "$C_RED" "$version" "$REMNAWAVE_MIN_VERSION" "$C_RESET"
  fi
}

rw_compose() {
  local dir files args=() file list
  dir=$(container_field "$RW_CONTAINER" '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
  files=$(container_field "$RW_CONTAINER" '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
  [ -n "$dir" ] && [ -n "$files" ] || die "Контейнер $RW_CONTAINER запущен не через docker compose — обновите Remnawave вручную."
  IFS=',' read -r -a list <<< "$files"
  for file in "${list[@]}"; do args+=(-f "$file"); done
  docker compose --project-directory "$dir" "${args[@]}" "$@"
}

rw_wait_healthy() {
  local i state
  for i in $(seq 1 60); do
    state=$(container_field "$RW_CONTAINER" '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
    printf '\r  Ожидание готовности (%s/60): %s   ' "$i" "$state"
    case "$state" in
      running/healthy|running/none) printf '\n'; return 0 ;;
      exited/*|dead/*|*/unhealthy) printf '\n'; return 1 ;;
    esac
    sleep 5
  done
  printf '\n'
  return 1
}

rw_update() {
  title 'Обновление Remnawave' "Панель (backend) в рамках тега из compose · нужна версия ≥ $REMNAWAVE_MIN_VERSION"
  need_docker
  container_exists "$RW_CONTAINER" \
    || die "Контейнер $RW_CONTAINER не найден: Remnawave не на этом сервере. Обновите панель там, где она установлена."
  local image old_id new_id current target service backup_dump

  step 1 5 'Текущая версия'
  image=$(container_field "$RW_CONTAINER" '{{.Config.Image}}')
  old_id=$(container_field "$RW_CONTAINER" '{{.Image}}')
  service=$(container_field "$RW_CONTAINER" '{{index .Config.Labels "com.docker.compose.service"}}')
  current=$(rw_version "$RW_CONTAINER")
  kv 'Образ' "$image"
  kv 'Работает версия' "$(rw_version_text "$current")"
  rw_compose config --quiet || die 'compose-файл Remnawave не прошёл проверку.'

  step 2 5 'Загрузка образа (панель продолжает работать)'
  docker pull "$image" || die "Не удалось скачать $image."
  new_id=$(docker image inspect -f '{{.Id}}' "$image")
  if [ "$new_id" = "$old_id" ]; then
    ok "Новее $current для тега ${image##*:} нет — обновлять нечего."
    case "${image##*:}" in [0-9]*.[0-9]*.[0-9]*)
      note "Тег закреплён на версии. Для перехода на другую версию измените тег образа в compose-файле." ;;
    esac
    return 0
  fi
  target=$(rw_image_version "$image")
  kv 'Новая версия' "${target:-?}"
  # until the switch the tag keeps pointing at the running image, whatever ends the action
  # shellcheck disable=SC2064 # expanded now: the locals are gone when the trap runs
  trap "docker tag $old_id $image >/dev/null 2>&1 || true" EXIT
  if [ -z "$target" ] || ! version_ge "$target" "$REMNAWAVE_MIN_VERSION"; then
    die "Версия ${target:-?} ниже требуемой $REMNAWAVE_MIN_VERSION — обновление отменено."
  fi
  if [ -n "$current" ] && [ "${target%%.*}" != "${current%%.*}" ]; then
    die "Смена мажорной версии ($current → $target) — только по официальной инструкции Remnawave."
  fi
  if [ -n "$current" ] && ! version_ge "$target" "$current"; then
    die "Образ $target старее работающего $current — обновление отменено."
  fi
  note "Что нового: https://github.com/remnawave/backend/releases/tag/$target"
  note "Ноды (remnanode) должны быть не ниже $REMNANODE_MIN_VERSION; их обновляют на серверах нод."

  step 3 5 'Резервная копия'
  require_backup before-remnawave-update
  backup_dump="$LAST_BACKUP_DIR/remnawave.dump"

  step 4 5 'Перезапуск панели'
  warn 'Панель будет недоступна ~1 минуту; новая версия при старте сама применит миграции своей базы.'
  type_to_confirm ОБНОВИТЬ || die 'Обновление отменено, ничего не изменено.'
  journal remnawave-update "start ${current:-?} -> $target"
  trap - EXIT
  rw_compose up -d --no-deps --pull never "$service" || err 'docker compose up завершился ошибкой.'

  step 5 5 'Проверка'
  if rw_wait_healthy && [ "$(rw_version "$RW_CONTAINER")" = "$target" ]; then
    journal remnawave-update "ok $target"
    ok "Remnawave $target работает"
    return 0
  fi
  err 'Новая версия не стала healthy.'
  docker logs --tail 60 "$RW_CONTAINER" 2>&1 | sed 's/^/    /' || true
  journal remnawave-update "failed $target, rollback to ${current:-?}"
  warn "Возвращаю прежний образ ($current)…"
  docker tag "$old_id" "$image"
  rw_compose up -d --no-deps --pull never "$service" || true
  if rw_wait_healthy; then
    warn "Прежняя версия $current снова работает."
  else
    err 'Прежняя версия не запустилась: вероятно, новая уже изменила схему базы.'
    [ ! -f "$backup_dump" ] || note "Копия базы панели до обновления: $backup_dump (пункт «Как восстановить из копии»)."
  fi
  return 1
}

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
    kv '8  Контейнеры Remnawave' "$RW_CONTAINER, $RW_DB"
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
      8) value=$(ask_value 'Контейнер панели' "$RW_CONTAINER"); [ -n "$value" ] && RW_CONTAINER=$value
         value=$(ask_value 'Контейнер её PostgreSQL' "$RW_DB"); [ -n "$value" ] && RW_DB=$value ;;
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
  if screen -ls 2>/dev/null | grep "[.]${SCREEN_SESSION}[[:space:]]" >/dev/null; then
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
  local choice before newer
  newer=$(cp_newer_release)
  offer_screen
  while :; do
    load_settings
    [ -z "${C_RESET}" ] || printf '\033[H\033[2J'
    printf '%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
    printf '  %sCLEAN PAY · центр управления%s   %s%s%s\n' "$C_BOLD" "$C_RESET" "$C_DIM" "$(hostname 2>/dev/null)" "$C_RESET"
    printf '%s%s%s\n' "$C_BLUE" "$RULE" "$C_RESET"
    print_summary
    [ -z "$newer" ] || printf '  %s %sДоступна версия %s — пункт 5%s\n' "$(pad 'Обновление' 11)" "$C_YELLOW" "$newer" "$C_RESET"
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
    menu_item 11 'Связать с Clean Pay: права .env, общий ключ, проверка'
    menu_section "REMNAWAVE (панель ≥ $REMNAWAVE_MIN_VERSION, ноды ≥ $REMNANODE_MIN_VERSION)"
    menu_item 12 'Обновить Remnawave' 'копия'
    menu_section 'РЕЗЕРВНЫЕ КОПИИ'
    menu_item 13 'Создать полную резервную копию сейчас'
    menu_item 14 'Список копий и проверка'
    menu_item 15 'Как восстановить из копии'
    menu_section 'СПРАВКА'
    menu_item 16 'Обновление без простоя (zero-downtime)'
    menu_item 17 'Настройки меню'
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
      5) before=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)
         run_action cp_update
         menu_reload_if_updated "$before" ;;
      6) run_action cp_configure ;;
      7) run_action cp_restart ;;
      8) run_action cp_stop ;;
      9) run_action rs_update ;;
      10) run_action rs_install ;;
      11) run_action rs_link ;;
      12) run_action rw_update ;;
      13) run_action backup_create manual ;;
      14) run_view list_backups ;;
      15) run_view show_restore ;;
      16) run_view show_zdt ;;
      17) edit_settings ;;
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
  ./menu.sh remnashop-link     связать Remnashop с Clean Pay (права .env, общий ключ, проверка)
  ./menu.sh remnawave-update   обновить панель Remnawave

  Требования: Remnawave ≥ 2.8.0, ноды remnanode ≥ 2.8.0.
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
  remnashop-link) run_action rs_link ;;
  remnawave-update) run_action rw_update ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
