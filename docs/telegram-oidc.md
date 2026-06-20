# Telegram OIDC login

Clean Pay supports Telegram login through authorization code flow.

## Routes

- `GET /auth/telegram/start`
- `GET /auth/telegram/callback`
- `GET /api/me`
- `POST /api/logout`

## Flow

1. User opens `/auth/telegram/start`.
2. Backend creates `state`, `nonce`, and `code_verifier`.
3. Backend stores only their hashes in `TelegramAuthState`.
4. Backend stores raw values in temporary HttpOnly cookies.
5. Backend redirects to Telegram with `response_type=code` and `code_challenge_method=S256`.
6. Telegram redirects back to `/auth/telegram/callback`.
7. Backend checks `state`, exchanges `code` for `id_token`, and verifies:
   - JWT signature through JWKS;
   - `iss`;
   - `aud`;
   - `exp`;
   - `nonce`.
8. Backend creates or updates `WebUser` by `telegramId`.
9. Backend creates Clean Pay web session cookies.

## Stored User Fields

- `telegramId`
- `telegramUsername`
- `fullName`
- `photoUrl`
- `lastLoginAt`

Telegram ID alone is not trusted as proof of login. Proof is a successfully verified `id_token`.
