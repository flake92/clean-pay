# Zero-downtime rollout приложения Clean Pay

Этот runbook предназначен только для обновления runtime Clean Pay без schema
change. Обычные `./deploy.sh install` и `node deploy/prod/prod.mjs up`
намеренно останавливают app/workers перед миграцией и создают maintenance
window — их нельзя выдавать за zero-downtime.

Guarded flow оставляет старый app доступным до полной readiness canary,
переключает HTTP graceful reload'ом Caddy и автоматически возвращает exact
previous app/workers и image-настройки при ошибке promotion. Он не применяет
миграции и не откатывает данные.

## Обязательная топология и ограничения

Перед каждым rollout независимо подтвердите:

- один healthy Compose app и healthy workers на одной exact image;
- отдельные private и external edge networks из authoritative env;
- выбранный Caddy container под управлением Compose;
- выбранный absolute host Caddyfile, bind-mounted read-only как
  `/etc/caddy/Caddyfile`;
- Clean Pay upstream `reverse_proxy clean-pay:4000`;
- отдельным `/partners` upstream
  `reverse_proxy clean-pay-advertiser-cabinet:4100`.

Скрипт приложения не hardcode'ит project/network: он сверяет точные Docker
labels, имена контейнеров, image IDs и уникальный canary alias. Runbook требует
явно подставить host-local absolute paths и проверяет фактический Caddy mount;
tracked файл не содержит production identifiers.

Любая pending, failed или divergent Prisma migration блокирует flow.
`migrate deploy`, `db push` и down migration здесь отсутствуют. Новая схема
требует отдельного expand/contract review, backup/restore rehearsal и
доказательства совместимости обоих runtime.

## 1. Immutable staging и release gates

Не запускайте release из существующего mutable/dirty checkout. Создайте новый
checkout внутри выбранного absolute release root, названный полным Git SHA:

```bash
release_sha='REPLACE_WITH_40_HEX_REVIEWED_GIT_SHA'
release_root='REPLACE_WITH_ABSOLUTE_RELEASE_ROOT'
release_dir="$release_root/$release_sha"
repository_url='REPLACE_WITH_CANONICAL_REPOSITORY_URL'

printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$'
test "$release_sha" != 'REPLACE_WITH_40_HEX_REVIEWED_GIT_SHA'
test "$release_root" != 'REPLACE_WITH_ABSOLUTE_RELEASE_ROOT'
case "$release_root" in /*) ;; *) exit 1 ;; esac
test "$release_root" != '/'
test -d "$release_root"
test "$repository_url" != 'REPLACE_WITH_CANONICAL_REPOSITORY_URL'
test ! -e "$release_dir"
git clone --no-checkout "$repository_url" "$release_dir"
git -C "$release_dir" fetch --depth=1 origin "$release_sha"
git -C "$release_dir" checkout --detach "$release_sha"
test "$(git -C "$release_dir" rev-parse HEAD)" = "$release_sha"
test -z "$(git -C "$release_dir" status --porcelain --untracked-files=all)"
```

До rollout:

1. Подтвердите успешный CI exact commit и совместимость Remnashop
   API/worker/scheduler.
2. Зафиксируйте digest/ID target images и image IDs текущих app/workers.
3. Проверьте порог свободного места из authoritative env. Разрешена только
   точечная очистка доказанно неиспользуемых objects с повторной проверкой
   current/previous rollback images. `docker system prune --volumes` запрещён.
4. Сохраните и проверьте чтением Clean Pay/Remnashop DB dumps и Caddyfile.
   Не удаляйте current и previous application/migration images.

Создайте приватный rollback snapshot текущего authoritative env, затем target
env в release checkout:

```bash
old_env='REPLACE_WITH_ABSOLUTE_CURRENT_ENV_FILE'
target_env="$release_dir/deploy/prod/.env"
rollback_env="$release_dir/deploy/prod/.env.rollback-before-$release_sha"

test "$old_env" != 'REPLACE_WITH_ABSOLUTE_CURRENT_ENV_FILE'
case "$old_env" in /*) ;; *) exit 1 ;; esac
test -f "$old_env"
test ! -L "$old_env"
install -m 600 "$old_env" "$rollback_env"
install -m 600 "$old_env" "$target_env"
```

В `$target_env` измените только эти пять строк:

- `CLEAN_PAY_DEPLOY_SOURCE`;
- `CLEAN_PAY_IMAGE`;
- `CLEAN_PAY_MIGRATION_IMAGE`;
- `CLEAN_PAY_RELEASE`;
- `CLEAN_PAY_REVISION`.

Все secrets и runtime-настройки должны остаться byte-equivalent по parsed
value. Guard отклонит любую другую разницу, stale rollback image или
group/world-readable env.

```bash
cd "$release_dir"
export CLEAN_PAY_ZDT_ENV_FILE="$target_env"
export CLEAN_PAY_ZDT_ROLLBACK_ENV_FILE="$rollback_env"

node deploy/prod/zero-downtime-env.mjs verify "$target_env" "$rollback_env"
./deploy.sh build
```

`./deploy.sh build` выполняет prepare/build-or-pull/provenance/image/env
preflight, но не вызывает `compose stop/down/up` и не запускает миграцию.

## 2. Stage canary

Из immutable `$release_dir` и в том же shell:

```bash
sh deploy/prod/zero-downtime-app.sh stage --require-no-pending-migrations
sh deploy/prod/zero-downtime-app.sh status
sh deploy/prod/zero-downtime-app.sh verify
```

По умолчанию создаётся отдельный owned canary с dedicated loopback health port,
private network и уникальным edge alias `clean-pay-canary`. Старый app/workers
продолжают работать. Readiness secret
не передаётся в arguments/logs: проверка выполняется внутри canary через
`process.env.READINESS_INTERNAL_SECRET`.

Canary создаётся с restart policy `unless-stopped`; topology guard проверяет
его явно. Поэтому daemon/host restart не оставляет persistent Caddy candidate
без upstream. `NODE_ENV=production` baked в runner image, а runtime-настройки,
включая `LOG_LEVEL`, приходят из того же validated target env, что и Compose.

State публикуется атомарно с mode `0600`. Existing container без точных
ownership labels не удаляется. При ошибке stage удаляется только созданный
owned canary; recursive delete и Docker volume operations отсутствуют.

## 3. Подготовить persistent Caddy candidate

Сначала задайте host-local значения и подтвердите exact file bind:

```bash
caddy_container='REPLACE_WITH_CADDY_CONTAINER_NAME'
caddy_host='REPLACE_WITH_ABSOLUTE_HOST_CADDYFILE'
caddy_state_root='REPLACE_WITH_ABSOLUTE_PRIVATE_CADDY_STATE_ROOT'

test "$caddy_container" != 'REPLACE_WITH_CADDY_CONTAINER_NAME'
test "$caddy_host" != 'REPLACE_WITH_ABSOLUTE_HOST_CADDYFILE'
test "$caddy_state_root" != 'REPLACE_WITH_ABSOLUTE_PRIVATE_CADDY_STATE_ROOT'
case "$caddy_host" in /*) ;; *) exit 1 ;; esac
case "$caddy_state_root" in /*) ;; *) exit 1 ;; esac
test "$caddy_host" != '/'
test "$caddy_state_root" != '/'

test "$(docker inspect --format '{{.Name}}' "$caddy_container")" = "/$caddy_container"
test -n "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$caddy_container")"
caddy_mount=$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{printf "%s|%s|%t" .Type .Source .RW}}{{end}}{{end}}' \
  "$caddy_container")
test "$caddy_mount" = "bind|$caddy_host|false"
```

Это file bind, поэтому `mv`/atomic rename host-файла запрещён: running
container продолжил бы читать старый inode. HTTP cutover будет атомарным на
`caddy reload`, а authoritative bytes записываются durable в тот же inode.

Подготовьте private backup и candidate, не меняя advertiser route:

```bash
caddy_state="$caddy_state_root/clean-pay-zdt-$release_sha"
caddy_backup="$caddy_state/Caddyfile.primary"
caddy_candidate="$caddy_state/Caddyfile.canary"
caddy_writer="$release_dir/deploy/prod/caddyfile-same-inode.mjs"

test -f "$caddy_host"
test ! -L "$caddy_host"
test ! -e "$caddy_state"
(umask 077 && mkdir "$caddy_state")
cp --preserve=mode,ownership,timestamps "$caddy_host" "$caddy_backup"
cp --preserve=mode,ownership,timestamps "$caddy_host" "$caddy_candidate"
chmod 600 "$caddy_backup" "$caddy_candidate"

test "$(grep -Fc 'reverse_proxy clean-pay:4000' "$caddy_backup")" -eq 1
test "$(grep -Fc 'reverse_proxy clean-pay-advertiser-cabinet:4100' "$caddy_backup")" -eq 1
sed -i 's/reverse_proxy clean-pay:4000/reverse_proxy clean-pay-canary:4000/' \
  "$caddy_candidate"
test "$(grep -Fc 'reverse_proxy clean-pay:4000' "$caddy_candidate")" -eq 0
test "$(grep -Fc 'reverse_proxy clean-pay-canary:4000' "$caddy_candidate")" -eq 1
test "$(grep -Fc 'reverse_proxy clean-pay-advertiser-cabinet:4100' "$caddy_candidate")" -eq 1

primary_sha=$(sha256sum "$caddy_backup" | awk '{print $1}')
candidate_sha=$(sha256sum "$caddy_candidate" | awk '{print $1}')
caddy_inode=$(stat -c '%d:%i' "$caddy_host")

docker cp "$caddy_backup" "$caddy_container:/tmp/Caddyfile-clean-pay-primary"
docker cp "$caddy_candidate" "$caddy_container:/tmp/Caddyfile-clean-pay-canary"
docker exec "$caddy_container" caddy validate --config /tmp/Caddyfile-clean-pay-primary
docker exec "$caddy_container" caddy validate --config /tmp/Caddyfile-clean-pay-canary
```

Оба варианта и checksums должны быть проверены до первой записи.

## 4. Persistent switch на canary

Выполните блок целиком в том же privileged shell:

```bash
(
set -eu
candidate_committed=0
restore_primary_on_failure() {
  switch_status=$?
  trap - 0 HUP INT TERM
  if [ "$candidate_committed" -eq 0 ]; then
    recovery_failed=0
    node "$caddy_writer" restore "$caddy_host" "$caddy_backup" "$primary_sha" || recovery_failed=1
    test "$(stat -c '%d:%i' "$caddy_host")" = "$caddy_inode" || recovery_failed=1
    test "$(sha256sum "$caddy_host" | awk '{print $1}')" = "$primary_sha" || recovery_failed=1
    docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile || recovery_failed=1
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile || recovery_failed=1
    if [ "$recovery_failed" -ne 0 ]; then
      printf '%s\n' 'CRITICAL: automatic primary Caddyfile recovery failed' >&2
    fi
  fi
  exit "$switch_status"
}
trap restore_primary_on_failure 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$caddy_writer" replace \
  "$caddy_host" "$caddy_candidate" "$primary_sha" "$candidate_sha"
test "$(stat -c '%d:%i' "$caddy_host")" = "$caddy_inode"
test "$(sha256sum "$caddy_host" | awk '{print $1}')" = "$candidate_sha"
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile
candidate_committed=1
trap - 0 HUP INT TERM
)
```

При write/check/validate/reload failure trap восстанавливает prevalidated
backup в тот же inode, fsync'ит его, сверяет checksum и reload'ит primary.
Caddy сохраняет уже загруженную конфигурацию до успешного graceful reload.

Same-inode write не является filesystem-atomic: между truncate/write/fsync
остаётся минимальное crash/power-loss окно. Это неизбежный компромисс
read-only file bind; helper, checksum и failure trap уменьшают риск. После
fsync candidate переживает restart Caddy. Не допускайте параллельного
редактирования или restart контейнера во время этого короткого блока.

Сразу проверьте внешний HTTPS liveness, security headers, главную страницу,
login и безопасный authenticated read-only scenario. Не выполняйте payment или
другую необратимую smoke-операцию. При ошибке верните primary блоком из раздела
6, пока старый Compose app ещё healthy.

## 5. Promote app/workers за canary

Пока Caddy обслуживает `clean-pay-canary:4000`:

```bash
sh deploy/prod/zero-downtime-app.sh promote --traffic-on-canary
```

Скрипт повторяет image preflight, сверяет immutable IDs и заменяет Compose app,
затем workers через `--no-deps --no-build --pull never --wait`. При ошибке
failure trap сохраняет canary для HTTP, восстанавливает exact previous
app/workers и атомарно возвращает в target env прежние пять image/release
строк. Поэтому последующий обычный Compose запуск не выкатит target повторно.

## 6. Persistent switch на primary alias

После healthy promotion Caddy должен вернуться на `clean-pay:4000`. При любой
ошибке этого блока authoritative file и traffic возвращаются на canary:

```bash
(
set -eu
primary_committed=0
restore_canary_on_failure() {
  switch_status=$?
  trap - 0 HUP INT TERM
  if [ "$primary_committed" -eq 0 ]; then
    recovery_failed=0
    node "$caddy_writer" restore "$caddy_host" "$caddy_candidate" "$candidate_sha" || recovery_failed=1
    test "$(stat -c '%d:%i' "$caddy_host")" = "$caddy_inode" || recovery_failed=1
    test "$(sha256sum "$caddy_host" | awk '{print $1}')" = "$candidate_sha" || recovery_failed=1
    docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile || recovery_failed=1
    docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile || recovery_failed=1
    if [ "$recovery_failed" -ne 0 ]; then
      printf '%s\n' 'CRITICAL: automatic canary Caddyfile recovery failed' >&2
    fi
  fi
  exit "$switch_status"
}
trap restore_canary_on_failure 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$caddy_writer" replace \
  "$caddy_host" "$caddy_backup" "$candidate_sha" "$primary_sha"
test "$(stat -c '%d:%i' "$caddy_host")" = "$caddy_inode"
test "$(sha256sum "$caddy_host" | awk '{print $1}')" = "$primary_sha"
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile
primary_committed=1
trap - 0 HUP INT TERM
)
```

Повторите external smoke. Сохраняйте canary, private state, оба Caddyfile и
previous images весь observation window. Только после принятого окна:

```bash
sh deploy/prod/zero-downtime-app.sh remove --traffic-off-canary
```

Удаляйте Caddy backup/candidate затем только по точным именам; не используйте
recursive delete.

## Rollback после promotion

1. Тем же guarded блоком раздела 4 направьте Caddy на всё ещё healthy canary.
2. Выполните:

   ```bash
   sh deploy/prod/zero-downtime-app.sh rollback --traffic-on-canary
   ```

3. Убедитесь, что previous app/workers healthy и target env содержит прежнюю
   image pair/release metadata.
4. Выполните guarded primary switch из раздела 6: alias `clean-pay` теперь
   указывает на previous app.
5. После external smoke и observation удалите owned canary/state.

Скрипт не откатывает БД, Remnashop, SMTP или kill switch. Additive Remnashop
revision `0058` для e-mail reminders выпускается с
`EMAIL_SUBSCRIPTION_EXPIRATION_REMINDERS_ENABLED=false`. Любая необходимость
отката schema/data требует отдельного migration/restore runbook.
