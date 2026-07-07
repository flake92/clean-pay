$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$common = Get-Content -LiteralPath "$repo\src\application\common\dao\user_merge.py" -Raw
$common = $common -replace '@dataclass\(frozen=True\)\r?\nclass UserMergeTargetSnapshot:', "class UserMergeNotFoundError(Exception): ...`r`n`r`n`r`n@dataclass(frozen=True)`r`nclass UserMergeTargetSnapshot:"
[System.IO.File]::WriteAllText("$repo\src\application\common\dao\user_merge.py", $common.TrimEnd() + "`r`n", $utf8NoBom)

$commonInit = Get-Content -LiteralPath "$repo\src\application\common\dao\__init__.py" -Raw
$commonInit = $commonInit -replace 'from \.user_merge import UserMergeDao, UserMergePlan, UserMergeTargetSnapshot', 'from .user_merge import UserMergeDao, UserMergeNotFoundError, UserMergePlan, UserMergeTargetSnapshot'
$commonInit = $commonInit -replace '    "UserMergeDao",', "    `"UserMergeDao`",`r`n    `"UserMergeNotFoundError`","
[System.IO.File]::WriteAllText("$repo\src\application\common\dao\__init__.py", $commonInit.TrimEnd() + "`r`n", $utf8NoBom)

$infra = Get-Content -LiteralPath "$repo\src\infrastructure\database\dao\user_merge.py" -Raw
$infra = $infra -replace '    UserMergeDao,\r?\n', "    UserMergeDao,`r`n    UserMergeNotFoundError,`r`n"
$infra = $infra -replace '\r?\n\r?\nclass UserMergeNotFoundError\(Exception\): \.\.\.\r?\n', "`r`n"
[System.IO.File]::WriteAllText("$repo\src\infrastructure\database\dao\user_merge.py", $infra.TrimEnd() + "`r`n", $utf8NoBom)

$useCase = Get-Content -LiteralPath "$repo\src\application\use_cases\user\commands\merge.py" -Raw
$useCase = $useCase -replace 'from src\.application\.common\.dao import UserMergeDao, UserMergePlan', 'from src.application.common.dao import UserMergeDao, UserMergeNotFoundError, UserMergePlan'
$useCase = $useCase -replace 'from src\.infrastructure\.database\.dao\.user_merge import UserMergeNotFoundError\r?\n', ''
[System.IO.File]::WriteAllText("$repo\src\application\use_cases\user\commands\merge.py", $useCase.TrimEnd() + "`r`n", $utf8NoBom)

