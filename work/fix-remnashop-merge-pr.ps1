$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'

function Write-NoBom {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$merge = Get-Content -LiteralPath "$repo\src\application\use_cases\user\commands\merge.py" -Raw
$merge = $merge -replace '            "subscriptions": await self\._count\(Subscription\.user_id == source_user_id\),', '            "subscriptions": await self._count(Subscription, Subscription.user_id == source_user_id),'
$merge = $merge -replace '            "transactions": await self\._count\(Transaction\.user_id == source_user_id\),', '            "transactions": await self._count(Transaction, Transaction.user_id == source_user_id),'
$merge = $merge -replace '            "referrals_as_referrer": await self\._count\(Referral\.referrer_id == source_user_id\),', '            "referrals_as_referrer": await self._count(Referral, Referral.referrer_id == source_user_id),'
$merge = $merge -replace '            "referrals_as_referred": await self\._count\(Referral\.referred_id == source_user_id\),', '            "referrals_as_referred": await self._count(Referral, Referral.referred_id == source_user_id),'
$merge = $merge -replace '            "referral_rewards": await self\._count\(ReferralReward\.user_id == source_user_id\),', '            "referral_rewards": await self._count(ReferralReward, ReferralReward.user_id == source_user_id),'
$merge = $merge -replace '            "oauth_providers": await self\._count\(UserOAuthProvider\.user_id == source_user_id\),', '            "oauth_providers": await self._count(UserOAuthProvider, UserOAuthProvider.user_id == source_user_id),'
$countReplacement = '    async def _count(self, model: type[object], *where: object) -> int:' + "`r`n" + '        stmt = select(func.count()).select_from(model).where(*where)' + "`r`n"
$moveReplacement = '    async def _move_simple_fk(self, model: type[object], source_user_id: int, target_user_id: int) -> int:' + "`r`n" + '        user_id = getattr(model, "user_id")' + "`r`n" + '        stmt = update(model).where(user_id == source_user_id).values(user_id=target_user_id)' + "`r`n"
$merge = $merge -replace '    async def _count\(self, \*where: object\) -> int:\r?\n        model = where\[0\]\.left\.class_  # type: ignore\[attr-defined\]\r?\n        stmt = select\(func\.count\(\)\)\.select_from\(model\)\.where\(\*where\)\r?\n', $countReplacement
$merge = $merge -replace '    async def _move_simple_fk\(self, model: type\[object\], source_user_id: int, target_user_id: int\) -> int:\r?\n        stmt = update\(model\)\.where\(model\.user_id == source_user_id\)\.values\(user_id=target_user_id\)\r?\n', $moveReplacement
Write-NoBom -Path "$repo\src\application\use_cases\user\commands\merge.py" -Content $merge

$files = @(
    "$repo\src\application\common\policy.py",
    "$repo\src\application\use_cases\user\__init__.py",
    "$repo\src\infrastructure\database\models\__init__.py",
    "$repo\src\infrastructure\database\models\user.py",
    "$repo\src\infrastructure\database\models\user_merge_audit.py",
    "$repo\src\web\app.py",
    "$repo\src\web\endpoints\__init__.py",
    "$repo\src\web\endpoints\admin\__init__.py",
    "$repo\src\web\endpoints\admin\users.py",
    "$repo\src\web\schemas\__init__.py",
    "$repo\src\web\schemas\admin.py",
    "$repo\src\infrastructure\database\migrations\versions\0042_add_user_merge_audit.py"
)

foreach ($file in $files) {
    if (Test-Path -LiteralPath $file) {
        $content = Get-Content -LiteralPath $file -Raw
        Write-NoBom -Path $file -Content $content
    }
}
