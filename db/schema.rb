# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_07_21_020000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  # Custom types defined in this database.
  # Note that some types may not work with other database engines. Be careful if changing database.
  create_enum "AccountMergeConfirmationStatus", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]
  create_enum "AuditSeverity", ["INFO", "WARN", "ERROR"]
  create_enum "IntegrationStatusKind", ["UNKNOWN", "OK", "DEGRADED", "DOWN"]
  create_enum "PaymentOperationKind", ["PURCHASE", "EXTEND"]
  create_enum "PaymentOperationStatus", ["READY", "DISPATCHING", "OUTCOME_UNKNOWN", "SUCCEEDED", "FAILED_FINAL"]
  create_enum "PaymentRecordStatus", ["PENDING", "COMPLETED", "FAILED", "CANCELED", "REFUNDED", "UNKNOWN"]
  create_enum "WebAuthnChallengeType", ["REGISTRATION", "AUTHENTICATION"]
  create_enum "WebSessionAssuranceLevel", ["BOOTSTRAP", "FULL"]
  create_enum "WebSessionAuthMethod", ["EMAIL", "TELEGRAM", "PASSKEY"]
  create_enum "integration_status", ["UNKNOWN", "OK", "DEGRADED", "DOWN"]
  create_enum "merge_confirmation_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]
  create_enum "payment_operation_kind", ["PURCHASE", "EXTEND"]
  create_enum "payment_operation_status", ["READY", "DISPATCHING", "SUCCEEDED", "FAILED_FINAL", "OUTCOME_UNKNOWN", "MANUAL_REQUIRED"]
  create_enum "payment_purchase_type", ["NEW", "RENEW", "CHANGE"]
  create_enum "payment_status", ["PENDING", "COMPLETED", "FAILED", "CANCELED", "REFUNDED", "UNKNOWN"]
  create_enum "session_assurance_level", ["BOOTSTRAP", "FULL"]
  create_enum "session_auth_method", ["EMAIL", "TELEGRAM", "PASSKEY"]
  create_enum "webauthn_challenge_type", ["REGISTRATION", "AUTHENTICATION"]

  create_table "AccountMergeConfirmation", id: :text, force: :cascade do |t|
    t.integer "attemptCount", default: 0, null: false
    t.datetime "completedAt", precision: 3
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "expiresAt", precision: 3, null: false
    t.text "lastErrorCode"
    t.datetime "leaseExpiresAt", precision: 3
    t.text "sourceEmail"
    t.text "sourceRemnashopUserId", null: false
    t.enum "status", default: "PENDING", null: false, enum_type: "\"AccountMergeConfirmationStatus\""
    t.text "targetEmail", null: false
    t.text "targetRemnashopUserId", null: false
    t.text "telegramId", null: false
    t.text "telegramUsername"
    t.text "tokenHash", null: false
    t.datetime "updatedAt", precision: 3, null: false
    t.text "userId", null: false
    t.index ["expiresAt"], name: "AccountMergeConfirmation_expiresAt_idx"
    t.index ["status", "leaseExpiresAt"], name: "AccountMergeConfirmation_status_leaseExpiresAt_idx"
    t.index ["tokenHash"], name: "AccountMergeConfirmation_tokenHash_key", unique: true
    t.index ["userId", "status"], name: "AccountMergeConfirmation_userId_status_idx"
  end

  create_table "AppSetting", primary_key: "key", id: :text, force: :cascade do |t|
    t.datetime "updatedAt", precision: 3, null: false
    t.jsonb "value", null: false
  end

  create_table "AuditLog", id: :text, force: :cascade do |t|
    t.text "action", null: false
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "ipHash"
    t.jsonb "metadata"
    t.enum "severity", default: "INFO", null: false, enum_type: "\"AuditSeverity\""
    t.text "userId"
    t.index ["action"], name: "AuditLog_action_idx"
    t.index ["createdAt"], name: "AuditLog_createdAt_idx"
    t.index ["userId"], name: "AuditLog_userId_idx"
  end

  create_table "EmailVerificationCode", id: :text, force: :cascade do |t|
    t.integer "attempts", default: 0, null: false
    t.text "codeHash", null: false
    t.datetime "consumedAt", precision: 3
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "expiresAt", precision: 3, null: false
    t.integer "maxAttempts", default: 5, null: false
    t.datetime "sentAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "updatedAt", precision: 3, null: false
    t.text "userId", null: false
    t.index ["consumedAt"], name: "EmailVerificationCode_consumedAt_idx"
    t.index ["expiresAt"], name: "EmailVerificationCode_expiresAt_idx"
    t.index ["sentAt"], name: "EmailVerificationCode_sentAt_idx"
    t.index ["userId"], name: "EmailVerificationCode_userId_idx"
  end

  create_table "IntegrationStatus", id: :text, force: :cascade do |t|
    t.datetime "checkedAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "message"
    t.text "service", null: false
    t.enum "status", default: "UNKNOWN", null: false, enum_type: "\"IntegrationStatusKind\""
    t.datetime "updatedAt", precision: 3, null: false
    t.index ["service"], name: "IntegrationStatus_service_key", unique: true
  end

  create_table "PaymentHistorySyncState", primary_key: "userId", id: :text, force: :cascade do |t|
    t.integer "attemptCount", default: 0, null: false
    t.datetime "backfillCompletedAt", precision: 3
    t.text "claimTokenHash"
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "cursor"
    t.jsonb "errorSnapshot"
    t.integer "failureCount", default: 0, null: false
    t.integer "generation", default: 0, null: false
    t.datetime "lastAttemptAt", precision: 3
    t.datetime "lastSyncedAt", precision: 3
    t.datetime "leaseExpiresAt", precision: 3
    t.datetime "nextAttemptAt", precision: 3
    t.datetime "updatedAt", precision: 3, null: false
    t.text "upstreamOwnerHash", null: false
    t.index ["nextAttemptAt", "leaseExpiresAt"], name: "PaymentHistorySyncState_nextAttemptAt_leaseExpiresAt_idx"
    t.check_constraint "(\"claimTokenHash\" IS NULL) = (\"leaseExpiresAt\" IS NULL)", name: "PaymentHistorySyncState_claim_lease_pair_check"
    t.check_constraint "generation >= 0 AND \"attemptCount\" >= 0 AND \"failureCount\" >= 0", name: "PaymentHistorySyncState_counters_nonnegative_check"
  end

  create_table "PaymentOperation", id: :text, force: :cascade do |t|
    t.integer "attemptCount", default: 0, null: false
    t.text "claimTokenHash"
    t.datetime "completedAt", precision: 3
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "dispatchedAt", precision: 3
    t.jsonb "errorSnapshot"
    t.text "idempotencyKeyHash", null: false
    t.enum "kind", null: false, enum_type: "\"PaymentOperationKind\""
    t.datetime "leaseExpiresAt", precision: 3
    t.datetime "outcomeUnknownAt", precision: 3
    t.integer "reconcileAttemptCount", default: 0, null: false
    t.text "reconcileClaimTokenHash"
    t.jsonb "reconcileErrorSnapshot"
    t.integer "reconcileFailureCount", default: 0, null: false
    t.datetime "reconcileLastAttemptAt", precision: 3
    t.datetime "reconcileLeaseExpiresAt", precision: 3
    t.datetime "reconcileNextAttemptAt", precision: 3
    t.datetime "reconciledAt", precision: 3
    t.text "requestFingerprint", null: false
    t.jsonb "requestPayload", null: false
    t.jsonb "responseSnapshot"
    t.integer "responseStatus"
    t.enum "status", default: "READY", null: false, enum_type: "\"PaymentOperationStatus\""
    t.datetime "updatedAt", precision: 3, null: false
    t.text "upstreamKey", null: false
    t.text "upstreamOwnerHash"
    t.text "userId", null: false
    t.index ["status", "leaseExpiresAt"], name: "PaymentOperation_status_leaseExpiresAt_idx"
    t.index ["status", "reconcileNextAttemptAt", "reconcileLeaseExpiresAt"], name: "PaymentOperation_status_reconcileNextAttemptAt_reconcileLeaseEx"
    t.index ["upstreamKey"], name: "PaymentOperation_upstreamKey_key", unique: true
    t.index ["userId", "createdAt"], name: "PaymentOperation_userId_createdAt_idx"
    t.index ["userId", "idempotencyKeyHash"], name: "PaymentOperation_userId_idempotencyKeyHash_key", unique: true
    t.check_constraint "(\"reconcileClaimTokenHash\" IS NULL) = (\"reconcileLeaseExpiresAt\" IS NULL)", name: "PaymentOperation_reconcile_claim_lease_pair_check"
    t.check_constraint "\"reconcileAttemptCount\" >= 0 AND \"reconcileFailureCount\" >= 0", name: "PaymentOperation_reconcile_counters_nonnegative_check"
  end

  create_table "PaymentRecord", id: :text, force: :cascade do |t|
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "currency", null: false
    t.integer "deviceLimit"
    t.integer "durationDays"
    t.decimal "finalAmount", precision: 12, scale: 2, null: false
    t.text "gatewayType", null: false
    t.boolean "isFree", default: false, null: false
    t.datetime "lastSyncedAt", precision: 3
    t.text "operationId"
    t.text "paymentId", null: false
    t.text "paymentUrl"
    t.text "planCode"
    t.text "planName"
    t.text "purchaseType", null: false
    t.jsonb "raw"
    t.enum "status", default: "PENDING", null: false, enum_type: "\"PaymentRecordStatus\""
    t.integer "trafficLimit"
    t.datetime "updatedAt", precision: 3, null: false
    t.datetime "upstreamCreatedAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "upstreamUpdatedAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "userId", null: false
    t.index ["operationId"], name: "PaymentRecord_operationId_key", unique: true
    t.index ["paymentId"], name: "PaymentRecord_paymentId_key", unique: true
    t.index ["status"], name: "PaymentRecord_status_idx"
    t.index ["userId", "createdAt"], name: "PaymentRecord_userId_createdAt_idx"
    t.index ["userId", "upstreamCreatedAt", "paymentId"], name: "PaymentRecord_userId_upstreamCreatedAt_paymentId_idx"
  end

  create_table "RateLimitEvent", id: :text, force: :cascade do |t|
    t.text "action", null: false
    t.text "key", null: false
    t.jsonb "metadata"
    t.datetime "occurredAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.index ["key", "action", "occurredAt"], name: "RateLimitEvent_key_action_occurredAt_idx"
  end

  create_table "TelegramAuthState", id: :text, force: :cascade do |t|
    t.text "codeVerifierHash", null: false
    t.datetime "consumedAt", precision: 3
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "expiresAt", precision: 3, null: false
    t.text "nonceHash", null: false
    t.text "redirectTo"
    t.text "stateHash", null: false
    t.datetime "updatedAt", precision: 3, null: false
    t.text "userId"
    t.index ["codeVerifierHash"], name: "TelegramAuthState_codeVerifierHash_key", unique: true
    t.index ["consumedAt"], name: "TelegramAuthState_consumedAt_idx"
    t.index ["expiresAt"], name: "TelegramAuthState_expiresAt_idx"
    t.index ["nonceHash"], name: "TelegramAuthState_nonceHash_key", unique: true
    t.index ["stateHash"], name: "TelegramAuthState_stateHash_key", unique: true
    t.index ["userId"], name: "TelegramAuthState_userId_idx"
  end

  create_table "WebAuthnChallenge", id: :text, force: :cascade do |t|
    t.text "challenge", null: false
    t.datetime "consumedAt", precision: 3
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "expiresAt", precision: 3, null: false
    t.enum "type", null: false, enum_type: "\"WebAuthnChallengeType\""
    t.text "userId"
    t.index ["challenge"], name: "WebAuthnChallenge_challenge_key", unique: true
    t.index ["consumedAt"], name: "WebAuthnChallenge_consumedAt_idx"
    t.index ["expiresAt"], name: "WebAuthnChallenge_expiresAt_idx"
    t.index ["type"], name: "WebAuthnChallenge_type_idx"
    t.index ["userId"], name: "WebAuthnChallenge_userId_idx"
  end

  create_table "WebAuthnCredential", id: :text, force: :cascade do |t|
    t.text "aaguid"
    t.boolean "backedUp", default: false, null: false
    t.bigint "counter", default: 0, null: false
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "credentialId", null: false
    t.text "deviceType"
    t.datetime "lastUsedAt", precision: 3
    t.text "name"
    t.binary "publicKey", null: false
    t.text "transports", array: true
    t.datetime "updatedAt", precision: 3, null: false
    t.text "userId", null: false
    t.index ["credentialId"], name: "WebAuthnCredential_credentialId_key", unique: true
    t.index ["lastUsedAt"], name: "WebAuthnCredential_lastUsedAt_idx"
    t.index ["userId"], name: "WebAuthnCredential_userId_idx"
  end

  create_table "WebRefreshToken", id: :text, force: :cascade do |t|
    t.datetime "consumedAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "graceExpiresAt", precision: 3, null: false
    t.text "sessionId", null: false
    t.text "successorTokenEncrypted", null: false
    t.text "tokenHash", null: false
    t.index ["graceExpiresAt"], name: "WebRefreshToken_graceExpiresAt_idx"
    t.index ["sessionId", "consumedAt"], name: "WebRefreshToken_sessionId_consumedAt_idx"
    t.index ["tokenHash"], name: "WebRefreshToken_tokenHash_key", unique: true
  end

  create_table "WebSession", id: :text, force: :cascade do |t|
    t.datetime "accessTokenExpiresAt", precision: 3, null: false
    t.enum "assuranceLevel", default: "FULL", null: false, enum_type: "\"WebSessionAssuranceLevel\""
    t.enum "authMethod", default: "EMAIL", null: false, enum_type: "\"WebSessionAuthMethod\""
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "ipHash"
    t.datetime "refreshExpiresAt", precision: 3, null: false
    t.datetime "refreshRotatedAt", precision: 3
    t.text "refreshTokenHash", null: false
    t.datetime "remnashopAccessExpiresAt", precision: 3
    t.text "remnashopAccessTokenEncrypted"
    t.datetime "remnashopRefreshExpiresAt", precision: 3
    t.text "remnashopRefreshTokenEncrypted"
    t.datetime "revokedAt", precision: 3
    t.datetime "updatedAt", precision: 3, null: false
    t.text "userAgent"
    t.text "userId", null: false
    t.index ["accessTokenExpiresAt"], name: "WebSession_accessTokenExpiresAt_idx"
    t.index ["assuranceLevel"], name: "WebSession_assuranceLevel_idx"
    t.index ["refreshExpiresAt"], name: "WebSession_refreshExpiresAt_idx"
    t.index ["refreshTokenHash"], name: "WebSession_refreshTokenHash_key", unique: true
    t.index ["remnashopAccessExpiresAt"], name: "WebSession_remnashopAccessExpiresAt_idx"
    t.index ["remnashopRefreshExpiresAt"], name: "WebSession_remnashopRefreshExpiresAt_idx"
    t.index ["revokedAt"], name: "WebSession_revokedAt_idx"
    t.index ["userId"], name: "WebSession_userId_idx"
  end

  create_table "WebUser", id: :text, force: :cascade do |t|
    t.boolean "authPending", default: false, null: false
    t.datetime "createdAt", precision: 3, default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.text "displayName"
    t.text "email"
    t.boolean "emailVerified", default: false, null: false
    t.text "fullName"
    t.datetime "lastLoginAt", precision: 3
    t.text "pendingRemnashopEmail"
    t.text "pendingRemnashopUserId"
    t.text "photoUrl"
    t.text "remnashopUserId"
    t.text "telegramId"
    t.text "telegramUsername"
    t.datetime "updatedAt", precision: 3, null: false
    t.index ["email"], name: "WebUser_email_key", unique: true
    t.index ["pendingRemnashopUserId"], name: "WebUser_pendingRemnashopUserId_idx"
    t.index ["remnashopUserId"], name: "WebUser_remnashopUserId_key", unique: true
    t.index ["telegramId"], name: "WebUser_telegramId_key", unique: true
  end

  create_table "_prisma_migrations", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.integer "applied_steps_count", default: 0, null: false
    t.string "checksum", limit: 64, null: false
    t.timestamptz "finished_at"
    t.text "logs"
    t.string "migration_name", limit: 255, null: false
    t.timestamptz "rolled_back_at"
    t.timestamptz "started_at", default: -> { "now()" }, null: false
  end

  create_table "account_merge_confirmations", id: :string, force: :cascade do |t|
    t.integer "attempt_count", default: 0, null: false
    t.string "claim_token"
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "last_error_code"
    t.datetime "lease_expires_at"
    t.string "source_email"
    t.string "source_remnashop_user_id", null: false
    t.enum "status", default: "PENDING", null: false, enum_type: "merge_confirmation_status"
    t.string "target_email", null: false
    t.string "target_remnashop_user_id", null: false
    t.string "telegram_id", null: false
    t.string "telegram_username"
    t.string "token_hash", null: false
    t.datetime "updated_at", null: false
    t.string "web_user_id", null: false
    t.index ["expires_at"], name: "index_account_merge_confirmations_on_expires_at"
    t.index ["lease_expires_at"], name: "index_account_merge_confirmations_on_lease_expires_at"
    t.index ["status"], name: "index_account_merge_confirmations_on_status"
    t.index ["token_hash"], name: "index_account_merge_confirmations_on_token_hash", unique: true
    t.index ["web_user_id"], name: "index_account_merge_confirmations_on_web_user_id"
    t.check_constraint "(claim_token IS NULL) = (lease_expires_at IS NULL)", name: "account_merge_confirmations_lease_pair"
    t.check_constraint "attempt_count >= 0", name: "account_merge_confirmations_nonnegative_attempts"
  end

  create_table "app_settings", primary_key: "key", id: :string, force: :cascade do |t|
    t.datetime "updated_at", null: false
    t.jsonb "value", null: false
  end

  create_table "audit_logs", id: :string, force: :cascade do |t|
    t.string "action", null: false
    t.datetime "created_at", null: false
    t.string "ip_hash"
    t.jsonb "metadata"
    t.string "severity", default: "INFO", null: false
    t.string "web_user_id"
    t.index ["action"], name: "index_audit_logs_on_action"
    t.index ["created_at"], name: "index_audit_logs_on_created_at"
    t.index ["web_user_id"], name: "index_audit_logs_on_web_user_id"
    t.check_constraint "severity::text = ANY (ARRAY['INFO'::character varying, 'WARN'::character varying, 'ERROR'::character varying]::text[])", name: "audit_logs_severity"
  end

  create_table "email_verification_codes", id: :string, force: :cascade do |t|
    t.integer "attempts", default: 0, null: false
    t.string "code_hash", null: false
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.integer "max_attempts", default: 5, null: false
    t.datetime "sent_at", null: false
    t.datetime "updated_at", null: false
    t.string "web_user_id", null: false
    t.index ["consumed_at"], name: "index_email_verification_codes_on_consumed_at"
    t.index ["expires_at"], name: "index_email_verification_codes_on_expires_at"
    t.index ["sent_at"], name: "index_email_verification_codes_on_sent_at"
    t.index ["web_user_id"], name: "index_email_verification_codes_on_web_user_id"
    t.check_constraint "attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts", name: "email_verification_codes_attempts"
  end

  create_table "integration_statuses", id: :string, force: :cascade do |t|
    t.datetime "checked_at", null: false
    t.string "message"
    t.string "service", null: false
    t.enum "status", default: "UNKNOWN", null: false, enum_type: "integration_status"
    t.datetime "updated_at", null: false
    t.index ["service"], name: "index_integration_statuses_on_service", unique: true
  end

  create_table "payment_history_sync_states", primary_key: "web_user_id", id: :string, force: :cascade do |t|
    t.integer "attempt_count", default: 0, null: false
    t.datetime "backfill_completed_at"
    t.string "claim_token"
    t.datetime "created_at", null: false
    t.string "cursor"
    t.jsonb "error_snapshot"
    t.integer "failure_count", default: 0, null: false
    t.integer "generation", default: 0, null: false
    t.datetime "last_attempt_at"
    t.datetime "lease_expires_at"
    t.datetime "next_attempt_at"
    t.datetime "synced_at"
    t.datetime "updated_at", null: false
    t.string "upstream_owner_hash", null: false
    t.index ["next_attempt_at", "lease_expires_at"], name: "index_payment_history_sync_states_on_claim_queue"
    t.check_constraint "(claim_token IS NULL) = (lease_expires_at IS NULL)", name: "payment_history_sync_states_lease_pair"
    t.check_constraint "generation >= 0 AND attempt_count >= 0 AND failure_count >= 0", name: "payment_history_sync_states_nonnegative_counters"
  end

  create_table "payment_operations", id: :string, force: :cascade do |t|
    t.string "claim_token"
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.integer "dispatch_attempt_count", default: 0, null: false
    t.datetime "dispatched_at"
    t.jsonb "error_snapshot"
    t.string "idempotency_key_hash", null: false
    t.enum "kind", null: false, enum_type: "payment_operation_kind"
    t.datetime "lease_expires_at"
    t.datetime "outcome_observed_at"
    t.datetime "reconciled_at"
    t.integer "reconciliation_attempt_count", default: 0, null: false
    t.string "reconciliation_claim_token"
    t.integer "reconciliation_failure_count", default: 0, null: false
    t.jsonb "reconciliation_last_error"
    t.datetime "reconciliation_lease_expires_at"
    t.datetime "reconciliation_next_at"
    t.string "request_fingerprint", null: false
    t.jsonb "request_payload", null: false
    t.jsonb "response_snapshot"
    t.enum "status", default: "READY", null: false, enum_type: "payment_operation_status"
    t.datetime "updated_at", null: false
    t.string "upstream_key", null: false
    t.string "upstream_owner_hash"
    t.string "web_user_id", null: false
    t.index ["reconciliation_next_at", "reconciliation_lease_expires_at"], name: "index_payment_operations_on_reconciliation_queue"
    t.index ["status", "lease_expires_at"], name: "index_payment_operations_on_dispatch_claim"
    t.index ["upstream_key"], name: "index_payment_operations_on_upstream_key", unique: true
    t.index ["web_user_id", "idempotency_key_hash"], name: "index_payment_operations_on_user_and_idempotency", unique: true
    t.index ["web_user_id"], name: "index_payment_operations_on_web_user_id"
    t.check_constraint "(claim_token IS NULL) = (lease_expires_at IS NULL)", name: "payment_operations_dispatch_lease_pair"
    t.check_constraint "(reconciliation_claim_token IS NULL) = (reconciliation_lease_expires_at IS NULL)", name: "payment_operations_reconciliation_lease_pair"
    t.check_constraint "dispatch_attempt_count >= 0", name: "payment_operations_nonnegative_dispatch_attempts"
    t.check_constraint "reconciliation_attempt_count >= 0 AND reconciliation_failure_count >= 0", name: "payment_operations_nonnegative_reconciliation_counts"
  end

  create_table "payment_records", id: :string, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "currency", null: false
    t.integer "device_limit"
    t.integer "duration_days"
    t.decimal "final_amount", precision: 12, scale: 2, null: false
    t.string "gateway_type", null: false
    t.boolean "is_free", default: false, null: false
    t.string "payment_id", null: false
    t.string "payment_operation_id"
    t.string "payment_url"
    t.string "plan_id"
    t.string "plan_name"
    t.enum "purchase_type", null: false, enum_type: "payment_purchase_type"
    t.jsonb "raw"
    t.enum "status", default: "PENDING", null: false, enum_type: "payment_status"
    t.bigint "traffic_limit_bytes"
    t.datetime "updated_at", null: false
    t.datetime "upstream_created_at"
    t.datetime "upstream_updated_at"
    t.string "web_user_id", null: false
    t.index ["payment_id"], name: "index_payment_records_on_payment_id", unique: true
    t.index ["payment_operation_id"], name: "index_payment_records_on_payment_operation_id", unique: true
    t.index ["web_user_id", "created_at"], name: "index_payment_records_on_web_user_id_and_created_at"
    t.index ["web_user_id", "upstream_created_at", "payment_id"], name: "index_payment_records_on_user_upstream_chronology"
    t.index ["web_user_id"], name: "index_payment_records_on_web_user_id"
    t.check_constraint "final_amount >= 0::numeric", name: "payment_records_nonnegative_amount"
  end

  create_table "rate_limit_events", id: :string, force: :cascade do |t|
    t.string "action", null: false
    t.string "key", null: false
    t.jsonb "metadata"
    t.datetime "occurred_at", null: false
    t.index ["key", "action", "occurred_at"], name: "index_rate_limit_events_on_key_and_action_and_occurred_at"
  end

  create_table "telegram_auth_states", id: :string, force: :cascade do |t|
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "nonce_hash", null: false
    t.string "redirect_to"
    t.string "state_hash", null: false
    t.datetime "updated_at", null: false
    t.string "verifier_hash", null: false
    t.string "web_user_id"
    t.index ["consumed_at"], name: "index_telegram_auth_states_on_consumed_at"
    t.index ["expires_at"], name: "index_telegram_auth_states_on_expires_at"
    t.index ["nonce_hash"], name: "index_telegram_auth_states_on_nonce_hash", unique: true
    t.index ["state_hash"], name: "index_telegram_auth_states_on_state_hash", unique: true
    t.index ["verifier_hash"], name: "index_telegram_auth_states_on_verifier_hash", unique: true
    t.index ["web_user_id"], name: "index_telegram_auth_states_on_web_user_id"
  end

  create_table "web_authn_challenges", id: :string, force: :cascade do |t|
    t.string "challenge", null: false
    t.enum "challenge_type", null: false, enum_type: "webauthn_challenge_type"
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "web_user_id"
    t.index ["challenge"], name: "index_web_authn_challenges_on_challenge", unique: true
    t.index ["challenge_type"], name: "index_web_authn_challenges_on_challenge_type"
    t.index ["consumed_at"], name: "index_web_authn_challenges_on_consumed_at"
    t.index ["expires_at"], name: "index_web_authn_challenges_on_expires_at"
    t.index ["web_user_id"], name: "index_web_authn_challenges_on_web_user_id"
  end

  create_table "web_authn_credentials", id: :string, force: :cascade do |t|
    t.string "aaguid"
    t.string "attestation_type"
    t.boolean "backup_eligible"
    t.boolean "backup_state"
    t.bigint "counter", default: 0, null: false
    t.datetime "created_at", null: false
    t.string "credential_id", null: false
    t.datetime "last_used_at"
    t.string "name"
    t.binary "public_key", null: false
    t.string "transports", default: [], null: false, array: true
    t.datetime "updated_at", null: false
    t.string "web_user_id", null: false
    t.index ["credential_id"], name: "index_web_authn_credentials_on_credential_id", unique: true
    t.index ["web_user_id"], name: "index_web_authn_credentials_on_web_user_id"
    t.check_constraint "counter >= 0", name: "web_authn_credentials_nonnegative_counter"
  end

  create_table "web_refresh_tokens", id: :string, force: :cascade do |t|
    t.datetime "consumed_at", null: false
    t.datetime "created_at", null: false
    t.datetime "grace_expires_at", null: false
    t.text "successor_token", null: false
    t.string "token_hash", null: false
    t.string "web_session_id", null: false
    t.index ["grace_expires_at"], name: "index_web_refresh_tokens_on_grace_expires_at"
    t.index ["token_hash"], name: "index_web_refresh_tokens_on_token_hash", unique: true
    t.index ["web_session_id"], name: "index_web_refresh_tokens_on_web_session_id"
  end

  create_table "web_sessions", id: :string, force: :cascade do |t|
    t.datetime "access_expires_at", null: false
    t.enum "assurance_level", default: "FULL", null: false, enum_type: "session_assurance_level"
    t.enum "auth_method", default: "EMAIL", null: false, enum_type: "session_auth_method"
    t.datetime "created_at", null: false
    t.string "ip_hash"
    t.datetime "refresh_expires_at", null: false
    t.datetime "refresh_rotated_at"
    t.string "refresh_token_hash", null: false
    t.text "remnashop_access_token"
    t.datetime "remnashop_access_token_expires_at"
    t.text "remnashop_refresh_token"
    t.datetime "remnashop_refresh_token_expires_at"
    t.datetime "revoked_at"
    t.datetime "updated_at", null: false
    t.string "user_agent"
    t.string "web_user_id", null: false
    t.index ["access_expires_at"], name: "index_web_sessions_on_access_expires_at"
    t.index ["assurance_level"], name: "index_web_sessions_on_assurance_level"
    t.index ["refresh_expires_at"], name: "index_web_sessions_on_refresh_expires_at"
    t.index ["refresh_token_hash"], name: "index_web_sessions_on_refresh_token_hash", unique: true
    t.index ["remnashop_access_token_expires_at"], name: "index_web_sessions_on_remnashop_access_expiry"
    t.index ["remnashop_refresh_token_expires_at"], name: "index_web_sessions_on_remnashop_refresh_expiry"
    t.index ["revoked_at"], name: "index_web_sessions_on_revoked_at"
    t.index ["web_user_id"], name: "index_web_sessions_on_web_user_id"
  end

  create_table "web_users", id: :string, force: :cascade do |t|
    t.boolean "auth_pending", default: false, null: false
    t.datetime "created_at", null: false
    t.string "display_name"
    t.string "email"
    t.boolean "email_verified", default: false, null: false
    t.string "full_name"
    t.datetime "last_login_at"
    t.string "pending_remnashop_email"
    t.string "pending_remnashop_user_id"
    t.string "photo_url"
    t.string "remnashop_user_id"
    t.string "telegram_id"
    t.string "telegram_username"
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_web_users_on_email", unique: true
    t.index ["pending_remnashop_user_id"], name: "index_web_users_on_pending_remnashop_user_id"
    t.index ["remnashop_user_id"], name: "index_web_users_on_remnashop_user_id", unique: true
    t.index ["telegram_id"], name: "index_web_users_on_telegram_id", unique: true
  end

  add_foreign_key "AccountMergeConfirmation", "WebUser", column: "userId", name: "AccountMergeConfirmation_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "AuditLog", "WebUser", column: "userId", name: "AuditLog_userId_fkey", on_update: :cascade, on_delete: :nullify
  add_foreign_key "EmailVerificationCode", "WebUser", column: "userId", name: "EmailVerificationCode_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "PaymentHistorySyncState", "WebUser", column: "userId", name: "PaymentHistorySyncState_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "PaymentOperation", "WebUser", column: "userId", name: "PaymentOperation_userId_fkey", on_update: :cascade, on_delete: :restrict
  add_foreign_key "PaymentRecord", "PaymentOperation", column: "operationId", name: "PaymentRecord_operationId_fkey", on_update: :cascade, on_delete: :nullify
  add_foreign_key "PaymentRecord", "WebUser", column: "userId", name: "PaymentRecord_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "TelegramAuthState", "WebUser", column: "userId", name: "TelegramAuthState_userId_fkey", on_update: :cascade, on_delete: :nullify
  add_foreign_key "WebAuthnChallenge", "WebUser", column: "userId", name: "WebAuthnChallenge_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "WebAuthnCredential", "WebUser", column: "userId", name: "WebAuthnCredential_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "WebRefreshToken", "WebSession", column: "sessionId", name: "WebRefreshToken_sessionId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "WebSession", "WebUser", column: "userId", name: "WebSession_userId_fkey", on_update: :cascade, on_delete: :cascade
  add_foreign_key "account_merge_confirmations", "web_users", on_delete: :cascade
  add_foreign_key "audit_logs", "web_users", on_delete: :nullify
  add_foreign_key "email_verification_codes", "web_users", on_delete: :cascade
  add_foreign_key "payment_history_sync_states", "web_users", on_delete: :cascade
  add_foreign_key "payment_operations", "web_users", on_delete: :restrict
  add_foreign_key "payment_records", "payment_operations", on_delete: :nullify
  add_foreign_key "payment_records", "web_users", on_delete: :cascade
  add_foreign_key "telegram_auth_states", "web_users", on_delete: :nullify
  add_foreign_key "web_authn_challenges", "web_users", on_delete: :cascade
  add_foreign_key "web_authn_credentials", "web_users", on_delete: :cascade
  add_foreign_key "web_refresh_tokens", "web_sessions", on_delete: :cascade
  add_foreign_key "web_sessions", "web_users", on_delete: :cascade
end
