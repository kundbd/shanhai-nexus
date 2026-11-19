#requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+$')]
    [string]$AppId
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env.local'
$temporary = Join-Path $root ('.env.local.16688-' + [Guid]::NewGuid().ToString('N'))
$secureSecret = $null
$secretBuffer = [IntPtr]::Zero

try {
    Write-Host '16688 credentials for Shanhai Nexus'
    $secureSecret = Read-Host 'Paste the 16688 secret and press Enter (input is hidden)' -AsSecureString
    if ($null -eq $secureSecret -or $secureSecret.Length -eq 0) {
        Write-Host 'No secret entered. Credentials were not saved.'
        exit 1
    }

    $secretBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretBuffer)
    if ([string]::IsNullOrWhiteSpace($secret) -or $secret -match '[\x00\r\n]') {
        Write-Host 'The secret must be a non-empty value on one line.'
        exit 1
    }
    $quote = @("'", '"', '`') | Where-Object { !$secret.Contains($_) } | Select-Object -First 1
    if (!$quote) {
        Write-Host 'This value cannot be safely quoted in .env.local.'
        exit 1
    }

    $exists = [IO.File]::Exists($envPath)
    $previous = if ($exists) { [IO.File]::ReadAllText($envPath) } else { '' }
    $newline = if ($previous.Contains("`r`n")) { "`r`n" } else { "`n" }
    $existingKeys = '(?m)^[ \t]*(?:export[ \t]+)?(?:OPEN16688_APP_ID|OPEN16688_SECRET)[ \t]*=[^\r\n]*(?:\r?\n|$)'
    $updated = [regex]::Replace($previous, $existingKeys, '')
    if ($updated.Length -gt 0 -and !$updated.EndsWith("`n")) { $updated += $newline }
    $updated += "OPEN16688_APP_ID=$AppId${newline}OPEN16688_SECRET=$quote$secret$quote$newline"

    [IO.File]::WriteAllText($temporary, $updated, [Text.UTF8Encoding]::new($false))
    if ($exists) {
        [IO.File]::Replace($temporary, $envPath, [NullString]::Value)
    } else {
        [IO.File]::Move($temporary, $envPath)
    }
    Write-Host '16688 credentials saved to the local Shanhai Nexus .env.local.' -ForegroundColor Green
} catch {
    Write-Host 'Could not save the credentials. Check that .env.local is writable.' -ForegroundColor Red
    exit 1
} finally {
    if ($secretBuffer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretBuffer)
    }
    if ($null -ne $secureSecret) { $secureSecret.Dispose() }
    $secret = $null
    $updated = $null
    $previous = $null
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
