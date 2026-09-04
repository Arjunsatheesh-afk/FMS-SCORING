"""Re-score all 126 cached tracked JSONs with the NEW logic. No re-extraction.

Compares against the score recorded in the existing all_samples_report.json,
and dumps the raw driving metrics for the two thresholds that were not set
from exact counts (deep squat valgus/varus, rotary completeness).
"""
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Project root: the parent of analysis/, or an explicit path as argv[1].
PROJECT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

from fms_pipeline import score_tracked_file  # noqa: E402
from fms_scoring import FMS_TESTS  # noqa: E402

TRACKED = PROJECT / "fms_outputs" / "tracked"
OLD_REPORT = PROJECT / "fms_outputs" / "reports" / "all_samples_report.json"

old_scores = {}
if OLD_REPORT.exists():
    rep = json.loads(OLD_REPORT.read_text(encoding="utf-8"))
    for e in rep.get("results", []):
        old_scores[(e["test_id"], e["sampleId"])] = e["score"]

new = defaultdict(list)
detail = defaultdict(list)

for test_dir in sorted(TRACKED.iterdir()):
    if not test_dir.is_dir():
        continue
    test = test_dir.name
    for path in sorted(test_dir.glob("Sample-*.json")):
        sample = "Sample " + path.stem.split("-")[1]
        result = score_tracked_file(path, test)
        new[test].append((sample, result))
        detail[test].append((sample, result.get("measurements", {}), result.get("score"), result.get("faults", [])))


def dist(scores):
    c = Counter(s for s in scores if isinstance(s, int))
    na = sum(1 for s in scores if not isinstance(s, int))
    return c, na


print("=" * 94)
print("SCORE DISTRIBUTION: OLD vs NEW  (n=18 per test)")
print("=" * 94)
print(f"{'exercise':28}{'old 0/1/2/3':>16}{'old avg':>9}   {'new 0/1/2/3':>16}{'new avg':>9}")
print("-" * 94)
for test in FMS_TESTS:
    entries = new.get(test, [])
    if not entries:
        continue
    new_s = [r["score"] for _, r in entries]
    old_s = [old_scores.get((test, s)) for s, _ in entries]
    oc, _ = dist([s for s in old_s if s is not None])
    nc, _ = dist(new_s)
    o_valid = [s for s in old_s if isinstance(s, int)]
    n_valid = [s for s in new_s if isinstance(s, int)]
    o_avg = f"{statistics.mean(o_valid):.2f}" if o_valid else "  - "
    n_avg = f"{statistics.mean(n_valid):.2f}" if n_valid else "  - "
    o_str = f"{oc[0]}/{oc[1]}/{oc[2]}/{oc[3]}"
    n_str = f"{nc[0]}/{nc[1]}/{nc[2]}/{nc[3]}"
    flag = "  <-- CHECK" if test in ("deep_squat", "rotary_stability") else ""
    print(f"{FMS_TESTS[test]['name']:28}{o_str:>16}{o_avg:>9}   {n_str:>16}{n_avg:>9}{flag}")

print()
print("=" * 94)
print("FAULT FREQUENCY (new)")
print("=" * 94)
for test in FMS_TESTS:
    entries = new.get(test, [])
    if not entries:
        continue
    fc = Counter(f for _, r in entries for f in r.get("faults", []))
    clean = sum(1 for _, r in entries if not r.get("faults"))
    na = entries[0][1].get("measurements", {}).get("notAssessed", [])
    print(f"\n{test}  (clean={clean}/18)" + (f"   notAssessed={na}" if na else ""))
    for f, c in fc.most_common():
        print(f"    {c:3}/18  {f}")

print()
print("=" * 94)
print("THRESHOLD AUDIT 1: deep squat kneeMedialOffset  (+medial/valgus, -lateral/varus)")
print("=" * 94)
vals = sorted(m.get("kneeMedialOffset") for _, m, _, _ in detail["deep_squat"] if m.get("kneeMedialOffset") is not None)
print("  sorted values:", " ".join(f"{v:+.3f}" for v in vals))
print(f"  positives(medial)={sum(1 for v in vals if v>0)}  negatives(lateral)={sum(1 for v in vals if v<0)}")
print("\n  exact signed counts:")
for t in (0.05, 0.08, 0.10, 0.15, 0.20):
    print(f"    valgus  (> +{t:.2f}): {sum(1 for v in vals if v > t):2}/18")
for t in (0.30, 0.35, 0.40, 0.45, 0.50):
    print(f"    varus   (< -{t:.2f}): {sum(1 for v in vals if v < -t):2}/18")

print()
print("=" * 94)
print("THRESHOLD AUDIT 2: rotary elbowKneeDistanceNorm  (fault >0.25, complete <=0.45)")
print("=" * 94)
vals = sorted(m.get("elbowKneeDistanceNorm") for _, m, _, _ in detail["rotary_stability"] if m.get("elbowKneeDistanceNorm") is not None)
print("  sorted values:", " ".join(f"{v:.3f}" for v in vals))
print("\n  exact counts:")
for t in (0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60):
    print(f"    > {t:.2f}: fault {sum(1 for v in vals if v > t):2}/18   |   incomplete(> {t:.2f}) -> score 1: {sum(1 for v in vals if v > t):2}/18")
