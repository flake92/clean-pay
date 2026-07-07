$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$credentialInput = "protocol=https`nhost=github.com`n`n"
$credentialOutput = $credentialInput | git -c safe.directory=C:/code/remnashop-pr -C $repo credential fill
$passwordLine = $credentialOutput | Where-Object { $_ -like 'password=*' } | Select-Object -First 1

if (-not $passwordLine) {
    throw 'GitHub credential password/token was not available from git credential manager.'
}

$token = $passwordLine.Substring('password='.Length)
$headers = @{
    Authorization = "Bearer $token"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}

$body = @{
    title = 'Add safe admin user merge endpoint'
    head = 'codex/user-merge-endpoint'
    base = 'codex/password-reset-webapp-cabinet'
    body = @'
## Summary
- add a transactional Remnashop user merge workflow for Telegram/email account reconciliation
- archive the source account instead of deleting it, preserving auditability and avoiding cascade data loss
- move subscriptions, transactions, referrals, promocode activations, and OAuth links to the target account
- expose `POST /api/v1/admin/users/merge` protected by `X-API-Key`, with `dry_run=true` by default

## Safety
- locks source and target users with `SELECT ... FOR UPDATE`
- requires source email to be verified
- requires target user to own a Telegram account
- preserves `target.current_subscription_id`; uses source current subscription only when target has none
- increments `token_version` for both accounts so existing sessions must be refreshed/reissued
- writes `user_merge_audit`

## Tests
- `python -m compileall -q C:\code\remnashop-pr\src`
- `git diff --check HEAD~2..HEAD`

## Notes
This is a stacked PR based on `codex/password-reset-webapp-cabinet`.
'@
} | ConvertTo-Json

$response = Invoke-RestMethod `
    -Method Post `
    -Uri 'https://api.github.com/repos/flake92/remnashop/pulls' `
    -Headers $headers `
    -Body $body `
    -ContentType 'application/json'

$response.html_url

