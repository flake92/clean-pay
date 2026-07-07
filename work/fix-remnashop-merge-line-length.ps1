$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$path = "$repo\src\application\use_cases\user\commands\merge.py"
$content = Get-Content -LiteralPath $path -Raw
$content = $content -replace '            "subscriptions": await self\._count\(Subscription, Subscription\.user_id == source_user_id\),', @'
            "subscriptions": await self._count(
                Subscription, Subscription.user_id == source_user_id
            ),
'@
$content = $content -replace '            "transactions": await self\._count\(Transaction, Transaction\.user_id == source_user_id\),', @'
            "transactions": await self._count(
                Transaction, Transaction.user_id == source_user_id
            ),
'@
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)

