$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$path = "$repo\src\web\endpoints\admin\users.py"
$content = Get-Content -LiteralPath $path -Raw
$content = $content -replace 'from src\.web\.schemas import MergeUsersRequest, MergeUsersResponse', 'from src.web.schemas import MergeUsersRequest, MergeUsersResponse, MergeUsersTargetResponse'
$content = $content -replace '        target=result\.target,', @'
        target=MergeUsersTargetResponse(
            id=result.target.id,
            email=result.target.email,
            telegram_id=result.target.telegram_id,
            is_email_verified=result.target.is_email_verified,
            current_subscription_id=result.target.current_subscription_id,
        ),
'@
[System.IO.File]::WriteAllText($path, $content.TrimEnd() + "`r`n", $utf8NoBom)

