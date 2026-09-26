# Append-only window challenge mapping

Preserve all existing SideBetType names and indices 0..14. Map 15 FIRST_RETURN,
16 COLOR_MIRROR, 17 STRICT_ASCENT, 18 SUM_RANGE, 19 COLOR_MAJORITY, 20 EXACT_DOZEN.
SideBet/SideBetConfig retain raw targetNumber, targetCount, redRatioBps and windowSpins.
For SUM_RANGE only, targetNumber is the lower sum and redRatioBps is the upper sum,
both inclusive. Do not interpret this field as a percentage across all rule families.
No event signature or ABI tuple changed. Index contract-reported statuses/payments;
never evaluate or fabricate settlement in the mapping. Deploy this schema/mapping
before creating new configs. Follow the existing staged deployment/reconciliation process.
