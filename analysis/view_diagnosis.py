"""Read-only: infer the camera view of each FMS test from cached pose data.

Transverse segments (hip width, shoulder width) foreshorten to nearly zero in a
sagittal view; longitudinal segments (torso length) stay close to the image
plane. Their ratio is therefore a proxy for viewing azimuth:

    frontal view  -> hipWidth/torso ~ 0.5-0.7,  shoulderWidth/torso ~ 0.8-1.0
    sagittal view -> both collapse toward ~0.0-0.2

Nothing here modifies fms_scoring.py; it only reads the tracked JSON already
on disk.
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

# Project root: the parent of analysis/, or an explicit path as argv[1].
PROJECT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

import numpy as np  # noqa: E402

from fms_scoring import KP, SCORE_THR  # noqa: E402

TRACKED = PROJECT / "fms_outputs" / "tracked"
STRIDE = 10  # sample every Nth frame


def seg(kps, scores, a, b):
    ia, ib = KP[a], KP[b]
    if scores[ia] < SCORE_THR or scores[ib] < SCORE_THR:
        return None
    return float(np.linalg.norm(np.asarray(kps[ia]) - np.asarray(kps[ib])))


def mid(kps, scores, a, b):
    ia, ib = KP[a], KP[b]
    if scores[ia] < SCORE_THR or scores[ib] < SCORE_THR:
        return None
    return (np.asarray(kps[ia]) + np.asarray(kps[ib])) / 2.0


rows = defaultdict(lambda: {"hip": [], "sh": []})

for test_dir in sorted(TRACKED.iterdir()):
    if not test_dir.is_dir():
        continue
    for path in sorted(test_dir.glob("Sample-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        track = max(data.get("tracks", {}).values(), key=len, default=[])
        for item in track[::STRIDE]:
            kps, scores = item.get("keypoints"), item.get("scores")
            if not kps or not scores:
                continue
            sh_mid = mid(kps, scores, "left_shoulder", "right_shoulder")
            hip_mid = mid(kps, scores, "left_hip", "right_hip")
            if sh_mid is None or hip_mid is None:
                continue
            torso = float(np.linalg.norm(sh_mid - hip_mid))
            if torso < 1e-6:
                continue
            hw = seg(kps, scores, "left_hip", "right_hip")
            sw = seg(kps, scores, "left_shoulder", "right_shoulder")
            if hw is not None:
                rows[test_dir.name]["hip"].append(hw / torso)
            if sw is not None:
                rows[test_dir.name]["sh"].append(sw / torso)

print(f"{'test':28}{'hipW/torso':>12}{'shldrW/torso':>14}   inferred view")
print("-" * 78)
for test, vals in rows.items():
    h = statistics.median(vals["hip"]) if vals["hip"] else float("nan")
    s = statistics.median(vals["sh"]) if vals["sh"] else float("nan")
    if h < 0.25 and s < 0.35:
        view = "SAGITTAL (transverse axis collapsed)"
    elif h > 0.4 and s > 0.6:
        view = "frontal"
    else:
        view = "oblique / intermediate"
    print(f"{test:28}{h:>12.3f}{s:>14.3f}   {view}")
