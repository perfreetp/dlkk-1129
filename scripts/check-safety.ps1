# ==============================================
# SAFETY CHECK SCRIPT - DATA PROTECTION
# ==============================================
# WARNING: This script is for safety verification only.
# DO NOT modify this script to delete production data.
# ==============================================

Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "  DATA SAFETY CHECK" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host ""

$DataPath = Join-Path (Get-Location) "data"
$DbPath = Join-Path $DataPath "macos_community.db"

Write-Host "Checking data directory..." -ForegroundColor Cyan
if (Test-Path $DataPath) {
    Write-Host "  [OK] Data directory exists: $DataPath" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] Data directory does not exist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Checking database file..." -ForegroundColor Cyan
if (Test-Path $DbPath) {
    $DbSize = (Get-Item $DbPath).Length / 1MB
    Write-Host "  [OK] Database file exists: $DbPath" -ForegroundColor Green
    Write-Host "  [INFO] Database size: $([math]::Round($DbSize, 2)) MB" -ForegroundColor Cyan
} else {
    Write-Host "  [WARNING] Database file does not exist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Scanning for destructive scripts..." -ForegroundColor Cyan
$DestructivePatterns = @(
    "Remove-Item.*Recurse.*Force.*data",
    "rm\s+-rf\s+data",
    "rimraf.*data",
    "fs\.rm.*data",
    "fs\.unlink.*\.db"
)

$FoundIssues = $false
Get-ChildItem -Path (Get-Location) -Include *.ps1,*.sh,*.bat,*.cmd,*.js -Recurse -Exclude node_modules | ForEach-Object {
    $Content = Get-Content $_.FullName -Raw
    foreach ($Pattern in $DestructivePatterns) {
        if ($Content -match $Pattern) {
            Write-Host "  [DANGER] Found destructive pattern in: $($_.FullName)" -ForegroundColor Red
            Write-Host "           Pattern: $Pattern" -ForegroundColor Red
            $FoundIssues = $true
        }
    }
}

if (-not $FoundIssues) {
    Write-Host "  [OK] No destructive data deletion scripts found" -ForegroundColor Green
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "  SAFETY REMINDERS" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "1. NEVER run 'Remove-Item -Recurse -Force data'" -ForegroundColor Red
Write-Host "2. NEVER run 'rm -rf data'" -ForegroundColor Red
Write-Host "3. Always backup the database before maintenance" -ForegroundColor Yellow
Write-Host "4. All destructive API operations require admin role" -ForegroundColor Cyan
Write-Host "5. All destructive operations are logged in audit_logs" -ForegroundColor Cyan
Write-Host ""
