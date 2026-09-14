\set ON_ERROR_STOP on

\if :{?stats_password}
\else
\echo 'stats_password psql variable is required'
\quit 2
\endif

BEGIN;

SELECT format(
  'CREATE ROLE advertiser_stats_ro LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 8',
  :'stats_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'advertiser_stats_ro')
\gexec

SELECT format('ALTER ROLE advertiser_stats_ro PASSWORD %L', :'stats_password')
\gexec

ALTER ROLE advertiser_stats_ro SET default_transaction_read_only = on;
ALTER ROLE advertiser_stats_ro SET statement_timeout = '8s';
ALTER ROLE advertiser_stats_ro SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE advertiser_stats_ro SET search_path = advertiser_stats;

CREATE SCHEMA IF NOT EXISTS advertiser_stats;
REVOKE ALL ON SCHEMA advertiser_stats FROM PUBLIC;

CREATE OR REPLACE VIEW advertiser_stats.users WITH (security_barrier = true) AS
SELECT id, ad_link_id, is_trial_available, created_at
FROM public.users;

CREATE OR REPLACE VIEW advertiser_stats.ad_links WITH (security_barrier = true) AS
SELECT id, name, code, is_active, created_at
FROM public.ad_links;

CREATE OR REPLACE VIEW advertiser_stats.transactions WITH (security_barrier = true) AS
SELECT id, user_id, status, is_test, pricing, currency, created_at
FROM public.transactions;

REVOKE ALL ON ALL TABLES IN SCHEMA advertiser_stats FROM PUBLIC;
SELECT format('GRANT CONNECT ON DATABASE %I TO advertiser_stats_ro', current_database())
\gexec
GRANT USAGE ON SCHEMA advertiser_stats TO advertiser_stats_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA advertiser_stats TO advertiser_stats_ro;

COMMIT;
