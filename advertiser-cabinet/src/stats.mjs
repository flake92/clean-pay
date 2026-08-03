import pg from "pg";

const { Pool } = pg;

export function createStatsStore(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: "-c default_transaction_read_only=on -c statement_timeout=8000 -c search_path=advertiser_stats",
    application_name: "clean-pay-advertiser-cabinet",
  });

  return {
    async health() {
      const result = await pool.query("SELECT current_setting('transaction_read_only') AS read_only");
      if (result.rows[0]?.read_only !== "on") throw new Error("Statistics database connection is not read-only");
    },
    async close() { await pool.end(); },
    async campaignStats(campaign, month, options = {}) {
      return queryCampaignStats(pool, campaign, month, { ...options, ...config });
    },
  };
}

function money(value) {
  return Number.parseFloat(value || "0");
}

export function normalizeMonth(value, now = new Date()) {
  const fallback = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" })
    .format(now).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || "")) return fallback;
  return value;
}

export async function queryCampaignStats(pool, campaign, month, config) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const linkResult = await client.query(
      "SELECT id, is_active FROM ad_links WHERE code = $1 LIMIT 1",
      [campaign.adLinkCode],
    );
    const link = linkResult.rows[0];
    if (!link) {
      await client.query("COMMIT");
      return emptyStats(campaign, month);
    }

    const registrationsResult = await client.query(`
      SELECT timezone($4, u.created_at)::date::text AS day,
             count(*)::int AS registrations,
             count(*) FILTER (WHERE u.is_trial_available IS FALSE)::int AS trials
      FROM users u
      WHERE u.ad_link_id = $1
        AND timezone($4, u.created_at)::date >= $2::date
        AND timezone($4, u.created_at)::date < $3::date
      GROUP BY day ORDER BY day
    `, [link.id, start, end, config.timezone]);

    const paymentsResult = await client.query(`
      WITH attributed AS (
        SELECT t.id, t.user_id, t.created_at, t.currency::text AS currency,
               (t.pricing->>'final_amount')::numeric AS amount,
               row_number() OVER (PARTITION BY t.user_id ORDER BY t.created_at, t.id) AS payment_number
        FROM users u
        JOIN transactions t ON t.user_id = u.id
        WHERE u.ad_link_id = $1
          AND t.status::text = 'COMPLETED'
          AND t.is_test IS FALSE
          AND (t.pricing->>'final_amount')::numeric > 0
          AND t.created_at >= u.created_at
          AND t.created_at < u.created_at + ($5::text || ' days')::interval
      )
      SELECT timezone($4, created_at)::date::text AS day, currency,
             count(*)::int AS payments,
             count(*) FILTER (WHERE payment_number = 1)::int AS first_payments,
             coalesce(sum(amount), 0)::text AS revenue,
             coalesce(sum(amount) FILTER (WHERE payment_number = 1), 0)::text AS first_revenue
      FROM attributed
      WHERE timezone($4, created_at)::date >= $2::date
        AND timezone($4, created_at)::date < $3::date
      GROUP BY day, currency ORDER BY day, currency
    `, [link.id, start, end, config.timezone, config.attributionDays]);

    const cohortResult = await client.query(`
      SELECT count(*)::int AS registrations,
             count(*) FILTER (WHERE u.is_trial_available IS FALSE)::int AS trials,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM transactions t
               WHERE t.user_id = u.id
                 AND t.status::text = 'COMPLETED'
                 AND t.is_test IS FALSE
                 AND (t.pricing->>'final_amount')::numeric > 0
                 AND t.created_at >= u.created_at
                 AND t.created_at < u.created_at + ($5::text || ' days')::interval
             ))::int AS paying_registrations,
             count(*) FILTER (WHERE u.is_trial_available IS FALSE AND EXISTS (
               SELECT 1 FROM transactions t
               WHERE t.user_id = u.id
                 AND t.status::text = 'COMPLETED'
                 AND t.is_test IS FALSE
                 AND (t.pricing->>'final_amount')::numeric > 0
                 AND t.created_at >= u.created_at
                 AND t.created_at < u.created_at + ($5::text || ' days')::interval
             ))::int AS trial_buyers
      FROM users u
      WHERE u.ad_link_id = $1
        AND timezone($4, u.created_at)::date >= $2::date
        AND timezone($4, u.created_at)::date < $3::date
    `, [link.id, start, end, config.timezone, config.attributionDays]);
    await client.query("COMMIT");

    const days = new Map();
    for (const row of registrationsResult.rows) {
      days.set(row.day, { day: row.day, registrations: row.registrations, trials: row.trials, currencies: {} });
    }
    for (const row of paymentsResult.rows) {
      const item = days.get(row.day) || { day: row.day, registrations: 0, trials: 0, currencies: {} };
      item.currencies[row.currency] = {
        payments: row.payments,
        firstPayments: row.first_payments,
        revenue: money(row.revenue),
        firstRevenue: money(row.first_revenue),
      };
      days.set(row.day, item);
    }

    const totals = {};
    for (const row of paymentsResult.rows) {
      const item = totals[row.currency] || { payments: 0, firstPayments: 0, revenue: 0, firstRevenue: 0 };
      item.payments += row.payments;
      item.firstPayments += row.first_payments;
      item.revenue += money(row.revenue);
      item.firstRevenue += money(row.first_revenue);
      totals[row.currency] = item;
    }
    const cohort = cohortResult.rows[0] || { registrations: 0, trials: 0, paying_registrations: 0, trial_buyers: 0 };
    return {
      campaign, month, linkFound: true, linkActive: link.is_active,
      registrations: cohort.registrations,
      trials: cohort.trials,
      payingRegistrations: cohort.paying_registrations,
      trialBuyers: cohort.trial_buyers,
      conversion: cohort.registrations ? cohort.paying_registrations / cohort.registrations : 0,
      trialConversion: cohort.trials ? cohort.trial_buyers / cohort.trials : 0,
      totals,
      days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function emptyStats(campaign, month) {
  return { campaign, month, linkFound: false, linkActive: false, registrations: 0, trials: 0, payingRegistrations: 0, trialBuyers: 0, conversion: 0, trialConversion: 0, totals: {}, days: [] };
}
