"""Read-only: compute the PROPOSED metrics on all 126 cached tracked JSONs.

Does not touch fms_scoring.py. Replicates each test's scored-frame selection
and usable-frame filter so the numbers are directly comparable to the
thresholds that live in the _score_* methods.

Candidate metrics
-----------------
knee_track_new : signed perpendicular distance from the knee to the hip-ankle
                 line, normalised by hip-ankle length, signed +medial /
                 -lateral relative to the pelvis midline.
elbow_knee_new : min over sides of |elbow-knee| / (|shoulder-elbow| + |hip-knee|)
tilt_new       : |dy| / torso_length for the hip pair and the shoulder pair
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

from fms_scoring import (  # noqa: E402
    KP,
    SCORE_THR,
    _angle,
    _avg_angle,
    _frame_confidence,
    _mean_y,
    _point,
    _stepping_height,
    frames_from_tracked_json,
)

TRACKED = PROJECT / "fms_outputs" / "tracked"


def torso_len(frame):
    ls, rs = _point(frame, "left_shoulder"), _point(frame, "right_shoulder")
    lh, rh = _point(frame, "left_hip"), _point(frame, "right_hip")
    if ls is None or rs is None or lh is None or rh is None:
        return None
    t = float(np.linalg.norm((ls + rs) / 2.0 - (lh + rh) / 2.0))
    return t if t > 1e-6 else None


def tilt_new(frame, left, right):
    """|dy| / torso  -- azimuth-invariant, replaces atan2(dy, dx)."""
    p1, p2 = _point(frame, left), _point(frame, right)
    t = torso_len(frame)
    if p1 is None or p2 is None or t is None:
        return None
    return abs(float(p2[1] - p1[1])) / t


def knee_track_new(frame):
    """Signed perpendicular offset / leg length; + = medial (valgus)."""
    lh, rh = _point(frame, "left_hip"), _point(frame, "right_hip")
    if lh is None or rh is None:
        return None
    pelvis = (lh + rh) / 2.0

    best = None
    for side in ("left", "right"):
        hip = _point(frame, f"{side}_hip")
        knee = _point(frame, f"{side}_knee")
        ankle = _point(frame, f"{side}_ankle")
        if hip is None or knee is None or ankle is None:
            continue
        leg = ankle - hip
        leg_len = float(np.linalg.norm(leg))
        if leg_len < 1e-6:
            continue
        # unit normal to the hip->ankle line
        n = np.array([-leg[1], leg[0]]) / leg_len
        d = float(np.dot(knee - hip, n))
        medial_sign = np.sign(float(np.dot(pelvis - hip, n))) or 1.0
        value = (d * medial_sign) / leg_len
        if best is None or abs(value) > abs(best):
            best = value
    return best


def elbow_knee_new(frame):
    """|elbow-knee| / (upper-arm + thigh) -- longitudinal normalisation."""
    best = None
    for side in ("left", "right"):
        sh = _point(frame, f"{side}_shoulder")
        el = _point(frame, f"{side}_elbow")
        hip = _point(frame, f"{side}_hip")
        kn = _point(frame, f"{side}_knee")
        if sh is None or el is None or hip is None or kn is None:
            continue
        scale = float(np.linalg.norm(sh - el)) + float(np.linalg.norm(hip - kn))
        if scale < 1e-6:
            continue
        value = float(np.linalg.norm(el - kn)) / scale
        if best is None or value < best:
            best = value
    return best


SELECT = {
    "deep_squat": lambda fs: min(fs, key=lambda f: _avg_angle(f, ["left_knee_angle", "right_knee_angle"], 180)),
    "inline_lunge": lambda fs: min(fs, key=lambda f: _avg_angle(f, ["left_knee_angle", "right_knee_angle"], 180)),
    "hurdle_step": lambda fs: max(fs, key=_stepping_height),
    "active_straight_leg_raise": lambda fs: min(
        fs, key=lambda f: min(_angle(f, "left_hip_angle", 180), _angle(f, "right_hip_angle", 180))
    ),
    "trunk_stability_pushup": lambda fs: min(fs, key=lambda f: _avg_angle(f, ["left_elbow_angle", "right_elbow_angle"], 180)),
    "rotary_stability": lambda fs: min(fs, key=lambda f: (elbow_knee_new(f) if elbow_knee_new(f) is not None else 9e9)),
    "shoulder_mobility": lambda fs: fs[len(fs) // 2],
}

results = defaultdict(lambda: defaultdict(list))

for test_dir in sorted(TRACKED.iterdir()):
    if not test_dir.is_dir():
        continue
    test = test_dir.name
    for path in sorted(test_dir.glob("Sample-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        frames = [f for f in frames_from_tracked_json(data) if _frame_confidence(f) >= 0.45]
        if len(frames) < 5:
            continue
        frame = SELECT[test](frames)
        for name, value in (
            ("knee_track_new", knee_track_new(frame)),
            ("elbow_knee_new", elbow_knee_new(frame)),
            ("hip_tilt_new", tilt_new(frame, "left_hip", "right_hip")),
            ("shoulder_tilt_new", tilt_new(frame, "left_shoulder", "right_shoulder")),
        ):
            if value is not None:
                results[test][name].append(value)


def show(test, metric, old_note):
    vals = results[test].get(metric, [])
    if not vals:
        print(f"  {metric:20} (no data)")
        return
    vals_sorted = sorted(vals)
    n = len(vals_sorted)
    p = lambda q: vals_sorted[min(n - 1, int(q * n))]
    print(
        f"  {metric:20} n={n:3} min={vals_sorted[0]:+7.3f} p25={p(0.25):+7.3f} "
        f"med={statistics.median(vals):+7.3f} p75={p(0.75):+7.3f} max={vals_sorted[-1]:+7.3f}   {old_note}"
    )


ORDER = [
    ("deep_squat", "FRONTAL"),
    ("hurdle_step", "FRONTAL"),
    ("shoulder_mobility", "FRONTAL"),
    ("inline_lunge", "sagittal"),
    ("active_straight_leg_raise", "sagittal"),
    ("trunk_stability_pushup", "sagittal"),
    ("rotary_stability", "sagittal"),
]

for test, view in ORDER:
    print(f"\n=== {test}  [{view}] ===")
    if test in ("deep_squat", "hurdle_step", "inline_lunge"):
        show(test, "knee_track_new", "(old rule: <-0.18 valgus / >0.28 varus / >0.24-0.25 abs)")
    if test == "rotary_stability":
        show(test, "elbow_knee_new", "(old rule: >0.35 fail-to-touch, complete<=0.60)")
    show(test, "hip_tilt_new", "(old rule: >10-12 deg)")
    if test == "rotary_stability":
        show(test, "shoulder_tilt_new", "(old rule: >14 deg)")
