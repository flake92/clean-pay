$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$mergePath = "$repo\src\application\use_cases\user\commands\merge.py"
$merge = Get-Content -LiteralPath $mergePath -Raw
$merge = $merge -replace '    async def _collect_moved_counts\(self, source_user_id: int, target_user_id: int\) -> dict\[str, int\]:', @'
    async def _collect_moved_counts(
        self, source_user_id: int, target_user_id: int
    ) -> dict[str, int]:
'@
[System.IO.File]::WriteAllText($mergePath, $merge.TrimEnd() + "`r`n", $utf8NoBom)

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
        [System.IO.File]::WriteAllText($file, $content.TrimEnd() + "`r`n", $utf8NoBom)
    }
}

