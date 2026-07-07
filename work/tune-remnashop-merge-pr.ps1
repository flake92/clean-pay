$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$mergePath = "$repo\src\application\use_cases\user\commands\merge.py"
$merge = Get-Content -LiteralPath $mergePath -Raw
$merge = $merge -replace 'from src\.core\.enums import AuthType\r?\n', ''
$merge = $merge -replace '        target\.auth_type = AuthType\.EMAIL\r?\n', ''
$merge = $merge -replace '            "referrals_as_referrer": await self\._count\(Referral, Referral\.referrer_id == source_user_id\),', @'
            "referrals_as_referrer": await self._count(
                Referral, Referral.referrer_id == source_user_id
            ),
'@
$merge = $merge -replace '            "referrals_as_referred": await self\._count\(Referral, Referral\.referred_id == source_user_id\),', @'
            "referrals_as_referred": await self._count(
                Referral, Referral.referred_id == source_user_id
            ),
'@
$merge = $merge -replace '            "referral_rewards": await self\._count\(ReferralReward, ReferralReward\.user_id == source_user_id\),', @'
            "referral_rewards": await self._count(
                ReferralReward, ReferralReward.user_id == source_user_id
            ),
'@
$merge = $merge -replace '            "oauth_providers": await self\._count\(UserOAuthProvider, UserOAuthProvider\.user_id == source_user_id\),', @'
            "oauth_providers": await self._count(
                UserOAuthProvider, UserOAuthProvider.user_id == source_user_id
            ),
'@
$merge = $merge -replace '    async def _move_simple_fk\(self, model: type\[object\], source_user_id: int, target_user_id: int\) -> int:', @'
    async def _move_simple_fk(
        self, model: type[object], source_user_id: int, target_user_id: int
    ) -> int:
'@
[System.IO.File]::WriteAllText($mergePath, $merge, $utf8NoBom)

