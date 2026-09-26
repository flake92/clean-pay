[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$ForbiddenPlaintextPath
)

$ErrorActionPreference = 'Stop'

foreach ($candidate in $ForbiddenPlaintextPath) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate.IndexOfAny([char[]]"`0`r`n") -ge 0) {
        throw 'A forbidden credential-source path is empty or contains a control character.'
    }

    # Test-Path/Get-Item inspect only metadata. The preflight never opens or
    # prints the content of a credential source.
    if (Test-Path -LiteralPath $candidate) {
        $item = Get-Item -Force -LiteralPath $candidate
        throw "Unapproved plaintext credential source still exists: $($item.FullName). Migrate provisioning to the approved secret manager, retire the file, review access, and rotate affected credentials."
    }
}

Write-Output 'No prohibited plaintext operator credential source was found.'
