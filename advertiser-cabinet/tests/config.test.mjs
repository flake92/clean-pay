import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";

const passwordHash = `scrypt$16384$8$1$${"a".repeat(22)}$${"b".repeat(86)}`;
function env(overrides = {}) {
  return {
    REMNASHOP_STATS_DATABASE_URL: "postgresql://readonly:secret@db/remnashop",
    ADVERTISER_SESSION_SECRET: "s".repeat(64),
    ADVERTISER_CAMPAIGNS_JSON: JSON.stringify([{ id: "lopez", name: "Lopez", adLinkCode: "lopez", telegramUrl: "https://t.me/clean_vpn_bot?start=ad_lopez" }]),
    ADVERTISER_ACCOUNTS_JSON: JSON.stringify([
      { login: "admin", name: "Admin", role: "admin", passwordHash, campaignIds: [] },
      { login: "lopez", name: "Lopez", role: "advertiser", passwordHash, campaignIds: ["lopez"] },
    ]),
    ...overrides,
  };
}

test("loads multiple roles and a Telegram campaign", () => {
  const config = loadConfig(env());
  assert.equal(config.basePath, "/partners");
  assert.equal(config.attributionDays, 30);
  assert.equal(config.accounts.length, 2);
  assert.equal(config.campaigns[0].adLinkCode, "lopez");
});

test("rejects an advertiser with an unknown campaign", () => {
  const source = env();
  source.ADVERTISER_ACCOUNTS_JSON = JSON.stringify([
    { login: "admin", name: "Admin", role: "admin", passwordHash, campaignIds: [] },
    { login: "other", name: "Other", role: "advertiser", passwordHash, campaignIds: ["missing"] },
  ]);
  assert.throws(() => loadConfig(source), /must reference existing campaigns/);
});

test("rejects non-Telegram campaign links", () => {
  assert.throws(() => loadConfig(env({ ADVERTISER_CAMPAIGNS_JSON: JSON.stringify([{ id: "lopez", name: "Lopez", adLinkCode: "lopez", telegramUrl: "https://example.com" }]) })), /t\.me/);
});
