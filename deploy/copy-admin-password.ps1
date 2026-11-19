$ErrorActionPreference = 'Stop'
$protected = Join-Path $PSScriptRoot '../output/admin-access/password.dpapi'
if (-not (Test-Path -LiteralPath $protected -PathType Leaf)) {
    throw '未找到此 Windows 用户的山海知序管理员密码。'
}

$password = ConvertTo-SecureString (Get-Content -LiteralPath $protected -Raw).Trim()
$credential = [PSCredential]::new('admin', $password)
Set-Clipboard -Value $credential.GetNetworkCredential().Password
Write-Output '已将山海知序管理员密码复制到剪贴板。用户名为 admin。'
