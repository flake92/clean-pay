#!/bin/sh
set -eu

: "${CLEAN_PAY_BROWSER_DB_SCOPE:?CLEAN_PAY_BROWSER_DB_SCOPE is required}"
: "${CLEAN_PAY_BROWSER_DB_OBSERVER_USER:?CLEAN_PAY_BROWSER_DB_OBSERVER_USER is required}"
: "${CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD:?CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

case "$CLEAN_PAY_BROWSER_DB_SCOPE" in
  clean-pay-browser-journey-*) ;;
  *) echo "invalid disposable journey project scope" >&2; exit 1 ;;
esac
case "$CLEAN_PAY_BROWSER_DB_SCOPE" in
  *[!a-z0-9-]* | *--* | *-) echo "invalid disposable journey project scope" >&2; exit 1 ;;
esac
test "${#CLEAN_PAY_BROWSER_DB_SCOPE}" -le 86
test "$CLEAN_PAY_BROWSER_DB_OBSERVER_USER" = "clean_pay_browser_observer"
test "$PGHOST" = "postgres"
test "$PGPORT" = "5432"
test "$PGDATABASE" = "clean_pay"
test "$PGUSER" = "clean_pay_bootstrap"
test "${#CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD}" -eq 106
case "$CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD" in
  browser-journey-database-browser-observer-*) ;;
  *) echo "invalid synthetic observer credential" >&2; exit 1 ;;
esac
observer_digest=${CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD#browser-journey-database-browser-observer-}
case "$observer_digest" in
  *[!a-f0-9]*) echo "invalid synthetic observer credential" >&2; exit 1 ;;
esac

# Fixed non-secret failure contract: 20/21 base connection, 22 session
# connection, 23 SQL execution, 24 another bounded psql failure.
PGCONNECT_TIMEOUT=5
export PGCONNECT_TIMEOUT
unset PGOPTIONS
base_status=0
psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --command='SELECT 1' \
  >/dev/null 2>&1 || base_status=$?
case "$base_status" in
  0) ;;
  2) exit 20 ;;
  *) exit 21 ;;
esac

PGOPTIONS="-c clean_pay.browser_observer_password=${CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD} -c statement_timeout=15000 -c lock_timeout=5000"
export PGOPTIONS
provision_status=0
psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || provision_status=$?
DO \$clean_pay_browser_observer\$
DECLARE
  observer_password text := current_setting('clean_pay.browser_observer_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'clean_pay_browser_observer') THEN
    EXECUTE format(
      'CREATE ROLE clean_pay_browser_observer LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4',
      observer_password
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE clean_pay_browser_observer LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4',
      observer_password
    );
  END IF;
END
\$clean_pay_browser_observer\$;
REVOKE ALL ON DATABASE clean_pay FROM clean_pay_browser_observer;
REVOKE ALL ON SCHEMA public FROM clean_pay_browser_observer;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM clean_pay_browser_observer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM clean_pay_browser_observer;
GRANT CONNECT ON DATABASE clean_pay TO clean_pay_browser_observer;
GRANT USAGE ON SCHEMA public TO clean_pay_browser_observer;
SELECT format(
  'GRANT SELECT, TRUNCATE ON TABLE %I.%I TO clean_pay_browser_observer',
  schemaname,
  tablename
)
FROM pg_catalog.pg_tables
WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
ORDER BY tablename
\gexec
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO clean_pay_browser_observer;
SQL
case "$provision_status" in
  0) ;;
  2) exit 22 ;;
  3) exit 23 ;;
  *) exit 24 ;;
esac
