$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$path = "$repo\src\infrastructure\database\dao\user_merge.py"
$content = Get-Content -LiteralPath $path -Raw
$content = $content -replace '    async def _collect_moved_counts\(self, source_user_id: int, target_user_id: int\) -> dict\[str, int\]:', @'
    async def _collect_moved_counts(
        self, source_user_id: int, target_user_id: int
    ) -> dict[str, int]:
'@
[System.IO.File]::WriteAllText($path, $content.TrimEnd() + "`r`n", $utf8NoBom)

