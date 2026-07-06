import { Pool, type PoolClient } from "pg";

import { getEnv } from "@/backend/config/env";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { BffError } from "@/backend/integrations/remnashop/errors";

type RemnashopUserRow = {
  id: number;
  telegram_id: string | null;
  email: string | null;
  password_hash: string | null;
  is_email_verified: boolean;
  current_subscription_id: number | null;
};

const globalForRemnashopPg = globalThis as unknown as {
  remnashopMergePool?: Pool;
};

function getPool() {
  const connectionString = getEnv().remnashopDatabaseUrl;

  if (!connectionString) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "REMNASHOP_DATABASE_URL is required to merge Remnashop accounts.",
    );
  }

  globalForRemnashopPg.remnashopMergePool ??= new Pool({
    connectionString,
    max: 3,
  });

  return globalForRemnashopPg.remnashopMergePool;
}

function parseRemnashopUserId(value: string) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BffError("INTERNAL_ERROR", 500, "Invalid Remnashop user id.");
  }

  return id;
}

async function oneUser(client: PoolClient, sql: string, values: unknown[]) {
  const result = await client.query<RemnashopUserRow>(sql, values);

  return result.rows[0] ?? null;
}

async function transferReferralRows(client: PoolClient, sourceUserId: number, targetUserId: number) {
  await client.query(
    `
      delete from referrals
      where referrer_id = $1 and referred_id = $2
    `,
    [sourceUserId, targetUserId],
  );
  await client.query(
    `
      update referrals
      set referrer_id = $2, updated_at = timezone('UTC', now())
      where referrer_id = $1 and referred_id <> $2
    `,
    [sourceUserId, targetUserId],
  );
  await client.query(
    `
      update referrals
      set referred_id = $2, updated_at = timezone('UTC', now())
      where referred_id = $1
        and referrer_id <> $2
        and not exists (
          select 1 from referrals existing where existing.referred_id = $2
        )
    `,
    [sourceUserId, targetUserId],
  );
  await client.query(
    `
      delete from referrals
      where referred_id = $1
    `,
    [sourceUserId],
  );
}

async function transferChildRows(client: PoolClient, sourceUserId: number, targetUserId: number) {
  await client.query("update transactions set user_id = $2, updated_at = timezone('UTC', now()) where user_id = $1", [
    sourceUserId,
    targetUserId,
  ]);
  await client.query("update subscriptions set user_id = $2, updated_at = timezone('UTC', now()) where user_id = $1", [
    sourceUserId,
    targetUserId,
  ]);
  await client.query("update promocode_activations set user_id = $2 where user_id = $1", [
    sourceUserId,
    targetUserId,
  ]);
  await client.query("update broadcast_messages set user_id = $2 where user_id = $1", [
    sourceUserId,
    targetUserId,
  ]);
  await client.query("update referral_rewards set user_id = $2, updated_at = timezone('UTC', now()) where user_id = $1", [
    sourceUserId,
    targetUserId,
  ]);
  await transferReferralRows(client, sourceUserId, targetUserId);
  await client.query(
    `
      update user_oauth_providers source
      set user_id = $2, updated_at = timezone('UTC', now())
      where source.user_id = $1
        and not exists (
          select 1
          from user_oauth_providers target
          where target.user_id = $2 and target.provider = source.provider
        )
    `,
    [sourceUserId, targetUserId],
  );
  await client.query("delete from user_oauth_providers where user_id = $1", [sourceUserId]);
}

async function mergeVerifiedEmailSourceIntoTelegramUser({
  emailRemnashopUserId,
  email,
  telegramId,
}: {
  emailRemnashopUserId?: string;
  email?: string;
  telegramId: string | number;
}) {
  const sourceUserId = emailRemnashopUserId ? parseRemnashopUserId(emailRemnashopUserId) : null;
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const source = sourceUserId
      ? await oneUser(
          client,
          "select id, telegram_id::text, email, password_hash, is_email_verified, current_subscription_id from users where id = $1 for update",
          [sourceUserId],
        )
      : await oneUser(
          client,
          "select id, telegram_id::text, email, password_hash, is_email_verified, current_subscription_id from users where email = $1 for update",
          [email],
        );
    const target = await oneUser(
      client,
      "select id, telegram_id::text, email, password_hash, is_email_verified, current_subscription_id from users where telegram_id = $1 for update",
      [String(telegramId)],
    );

    if (!source || !target) {
      throw new BffError("CONFLICT", 409, "Remnashop accounts to merge were not found.");
    }

    if (source.id === target.id) {
      await client.query("commit");
      return { merged: false, targetUserId: String(target.id), sourceUserId: String(source.id) };
    }

    if (!source.email || !source.is_email_verified) {
      throw new BffError("EMAIL_NOT_VERIFIED", 409, "Source Remnashop e-mail is not verified.");
    }

    if (source.telegram_id && source.telegram_id !== String(telegramId)) {
      throw new BffError("CONFLICT", 409, "Source Remnashop account is linked to another Telegram.");
    }

    if (target.email && target.email !== source.email) {
      throw new BffError("CONFLICT", 409, "Target Remnashop account already has another e-mail.");
    }

    authDebugLog("remnashop_db_merge_started", {
      sourceUserId: source.id,
      targetUserId: target.id,
      telegramId: String(telegramId),
      sourceEmail: source.email,
      targetHasSubscription: Boolean(target.current_subscription_id),
      sourceHasSubscription: Boolean(source.current_subscription_id),
    });

    await client.query(
      `
        update users
        set email = null,
            pending_email = null,
            email_verification_code_hash = null,
            email_verification_expires_at = null,
            updated_at = timezone('UTC', now())
        where id = $1
      `,
      [source.id],
    );
    await transferChildRows(client, source.id, target.id);
    await client.query(
      `
        update users target
        set email = $2,
            password_hash = coalesce($3, target.password_hash),
            is_email_verified = true,
            pending_email = null,
            email_verification_code_hash = null,
            email_verification_expires_at = null,
            current_subscription_id = coalesce(target.current_subscription_id, $4),
            updated_at = timezone('UTC', now())
        where target.id = $1
      `,
      [target.id, source.email, source.password_hash, source.current_subscription_id],
    );
    await client.query("delete from users where id = $1", [source.id]);
    await client.query("commit");

    authDebugLog("remnashop_db_merge_completed", {
      sourceUserId: source.id,
      targetUserId: target.id,
      telegramId: String(telegramId),
      email: source.email,
    });

    return { merged: true, targetUserId: String(target.id), sourceUserId: String(source.id) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    authDebugLog("remnashop_db_merge_failed", {
      sourceUserId,
      email,
      telegramId: String(telegramId),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function mergeVerifiedEmailRemnashopUserIntoTelegramUser({
  emailRemnashopUserId,
  telegramId,
}: {
  emailRemnashopUserId: string;
  telegramId: string | number;
}) {
  return mergeVerifiedEmailSourceIntoTelegramUser({ emailRemnashopUserId, telegramId });
}

export async function mergeVerifiedEmailRemnashopEmailIntoTelegramUser({
  email,
  telegramId,
}: {
  email: string;
  telegramId: string | number;
}) {
  return mergeVerifiedEmailSourceIntoTelegramUser({ email, telegramId });
}
