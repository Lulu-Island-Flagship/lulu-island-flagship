import re

# Each entry: (filepath, [lines_to_remove])
# Lines are exact matches to remove
remove_lines = {
    "src/lib/compliance-feed.ts": [
        "  _isRuleActiveAt as isRuleActiveAt,\n",
        "  _versionsOverlap as versionsOverlap,\n",
        "  type _VersionStatus as VersionStatus,\n",
    ],
    "src/lib/compliance-resolver.ts": [
        "  _isRuleActiveAt as isRuleActiveAt,\n",
    ],
    "src/lib/payroll-engine.ts": [
        "  type PayrollLineaRow,\n",
        "  type JournalEntryRow,\n",
    ],
    "src/lib/period-guard.ts": [
        "  getCurrentPeriodo,\n",
    ],
    "src/lib/tax-filing.ts": [
        "  MONTHLY_FILING_THRESHOLD_CAD,\n",
    ],
    "src/lib/compliance-engine.ts": [
        # Fix createdBy param
    ],
}

for fpath, lines_to_remove in remove_lines.items():
    with open(fpath) as f:
        content = f.readlines()
    
    new_lines = [l for l in content if l not in lines_to_remove]
    
    if len(new_lines) != len(content):
        with open(fpath, "w") as f:
            f.writelines(new_lines)
        print(f"Fixed {fpath}: removed {len(content) - len(new_lines)} lines")
    else:
        print(f"Skipped {fpath}: no lines matched")
