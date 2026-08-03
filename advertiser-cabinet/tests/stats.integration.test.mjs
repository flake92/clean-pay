import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { queryCampaignStats } from "../src/stats.mjs";

const databaseUrl = process.env.TEST_REMNASHOP_STATS_DATABASE_URL;

test("calculates monthly ad-link attribution against PostgreSQL", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c default_transaction_read_only=on -c search_path=advertiser_stats" });
  try {
    const result = await queryCampaignStats(
      pool,
      { id: "lopez", name: "Lopez", adLinkCode: "lopez", telegramUrl: "https://t.me/clean_vpn_bot?start=ad_lopez" },
      "2026-08",
      { timezone: "Europe/Moscow", attributionDays: 30 },
    );
    assert.equal(result.linkFound, true);
    assert.equal(result.registrations, 2);
    assert.equal(result.trials, 1);
    assert.equal(result.payingRegistrations, 2);
    assert.equal(result.trialBuyers, 1);
    assert.equal(result.totals.RUB.payments, 3);
    assert.equal(result.totals.RUB.firstPayments, 2);
    assert.equal(result.totals.RUB.revenue, 450);
    assert.equal(result.totals.RUB.firstRevenue, 400);
    assert.equal(result.totals.USD.revenue, 200);
  } finally {
    await pool.end();
  }
});
