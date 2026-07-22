-- The unique indexes on these columns already serve equality lookups and
-- uniqueness enforcement. Drop only the redundant non-unique copies without
-- waiting indefinitely for a production table lock. Prisma applies the whole
-- migration atomically; a busy table therefore causes a fast, complete
-- rollback that can be retried during a quieter deployment window.
SET lock_timeout = '5s';

DROP INDEX IF EXISTS "WebUser_email_idx";
DROP INDEX IF EXISTS "WebUser_telegramId_idx";
DROP INDEX IF EXISTS "PaymentRecord_paymentId_idx";
