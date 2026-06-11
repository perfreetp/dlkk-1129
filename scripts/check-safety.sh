#!/bin/bash
# ==============================================
# SAFETY CHECK SCRIPT - DATA PROTECTION
# ==============================================
# WARNING: This script is for safety verification only.
# DO NOT modify this script to delete production data.
# ==============================================

echo "=============================================="
echo "  DATA SAFETY CHECK"
echo "=============================================="
echo ""

DATA_PATH="$(pwd)/data"
DB_PATH="$DATA_PATH/macos_community.db"

echo "Checking data directory..."
if [ -d "$DATA_PATH" ]; then
    echo "  [OK] Data directory exists: $DATA_PATH"
else
    echo "  [WARNING] Data directory does not exist"
fi

echo ""
echo "Checking database file..."
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(du -m "$DB_PATH" | cut -f1)
    echo "  [OK] Database file exists: $DB_PATH"
    echo "  [INFO] Database size: $DB_SIZE MB"
else
    echo "  [WARNING] Database file does not exist"
fi

echo ""
echo "Scanning for destructive scripts..."
DESTRUCTIVE_PATTERNS=(
    "Remove-Item.*Recurse.*Force.*data"
    "rm\s+-rf\s+data"
    "rimraf.*data"
    "fs\.rm.*data"
    "fs\.unlink.*\.db"
)

FOUND_ISSUES=false
while IFS= read -r -d '' file; do
    for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
        if grep -q "$pattern" "$file" 2>/dev/null; then
            echo "  [DANGER] Found destructive pattern in: $file"
            echo "           Pattern: $pattern"
            FOUND_ISSUES=true
        fi
    done
done < <(find . -type f \( -name "*.ps1" -o -name "*.sh" -o -name "*.bat" -o -name "*.cmd" -o -name "*.js" \) -not -path "*/node_modules/*" -print0)

if [ "$FOUND_ISSUES" = false ]; then
    echo "  [OK] No destructive data deletion scripts found"
fi

echo ""
echo "=============================================="
echo "  SAFETY REMINDERS"
echo "=============================================="
echo "1. NEVER run 'rm -rf data'" 
echo "2. NEVER run 'Remove-Item -Recurse -Force data'"
echo "3. Always backup the database before maintenance"
echo "4. All destructive API operations require admin role"
echo "5. All destructive operations are logged in audit_logs"
echo ""
