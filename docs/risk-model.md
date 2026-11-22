# Phase 2a file risk score

Each file receives a score from 0 to 100. Every signal is divided by its saturation threshold, clamped to the interval `[0, 1]`, multiplied by its weight, and converted to points. The file score is the sum of those contributions:

`score = 100 × Σ(weightᵢ × min(max(rawᵢ, 0) / saturationᵢ, 1))`

| Factor | Weight | Saturation | Raw value |
|---|---:|---:|---|
| Complexity | 0.25 | 30 | Maximum per-function CCN |
| Churn | 0.20 | 20 | Commits touching the file in the last 90 days |
| Bug-fix history | 0.20 | 5 | Matching bug-fix commits in the available history |
| Static findings | 0.15 | 20 | Critical × 8 + high × 4 + medium × 2 + low × 1 |
| Authors | 0.10 | 8 | Distinct contributors in available history |
| Size | 0.10 | 1000 | Lizard NLOC |

For a worked example, use max CCN 15, 10 recent commits, 2 bug-fix commits, 1 critical + 2 medium + 2 low findings, 4 authors, and 500 NLOC. Normalized signals are `0.5, 0.5, 0.4, 0.7, 0.5, 0.5`; their weighted contributions are `12.5, 10, 8, 10.5, 5, 5` points. The resulting file score is **51**.

The scan summary risk score is the mean of the five highest file scores, or the mean of all file scores when there are fewer than five files. An empty scan has a summary score of 0. This highlights the riskiest portion of a repository rather than letting many low-risk files wash out a smaller set of risky files.

Git history is best-effort: shallow clones truncate the available history, and renames are not followed. These limitations affect churn, authors, and bug-fix signals.
