"""Read-only pass 2: compare knee-track denominators and sweep thresholds."""
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
    _angle,
    _avg_angle,
    _frame_confidence,
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
    p1, p2 = _point(frame, left), _point(frame, right)
    t = torso_len(frame)
    if p1 is None or p2 is None or t is None:
        return None
    return abs(float(p2[1] - p1[1])) / t


def knee_track(frame, denom):
    """denom: 'legspan' = |hip-ankle|, 'femur' = |hip-knee|."""
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
        femur = float(np.linalg.norm(knee - hip))
        scale = leg_len if denom == "legspan" else femur
        if leg_len < 1e-6 or scale < 1e-6:
            continue
        n = np.array([-leg[1], leg[0]]) / leg_len
        d = float(np.dot(knee - hip, n))
        medial_sign = np.sign(float(np.dot(pelvis - hip, n))) or 1.0
        value = (d * medial_sign) / scale
        if best is None or abs(value) > abs(best):
            best = value
    return best


def elbow_knee_new(frame):
    best = None
    for side in ("left", "right"):
        sh, el = _point(frame, f"{side}_shoulder"), _point(frame, f"{side}_elbow")
        hip, kn = _point(frame, f"{side}_hip"), _point(frame, f"{side}_knee")
        if sh is None or el is None or hip is None or kn is None:
            continue
        scale = float(np.linalg.norm(sh - el)) + float(np.linalg.norm(hip - kn))
        if scale < 1e-6:
            continue
        v = float(np.linalg.norm(el - kn)) / scale
        if best is None or v < best:
            best = v
    return best


SELECT = {
    "deep_squat": lambda fs: min(fs, key=lambda f: _avg_angle(f, ["left_knee_angle", "right_knee_angle"], 180)),
    "inline_lunge": lambda fs: min(fs, key=lambda f: _avg_angle(f, ["left_knee_angle", "right_knee_angle"], 180)),
    "hurdle_step": lambda fs: max(fs, key=_stepping_height),
    "rotary_stability": lambda fs: min(fs, key=lambda f: (elbow_knee_new(f) or 9e9)),
}

data_by = defaultdict(lambda: defaultdict(list))
for test in ("deep_squat", "hurdle_step", "inline_lunge", "rotary_stability"):
    for path in sorted((TRACKED / test).glob("Sample-*.json")):
        d = json.loads(path.read_text(encoding="utf-8"))
        frames = [f for f in frames_from_tracked_json(d) if _frame_confidence(f) >= 0.45]
        if len(frames) < 5:
            continue
        fr = SELECT[test](frames)
        knee_flex = _avg_angle(fr, ["left_knee_angle", "right_knee_angle"], 180)
        data_by[test]["knee_flex"].append(knee_flex)
        for name, v in (
            ("legspan", knee_track(fr, "legspan")),
            ("femur", knee_track(fr, "femur")),
            ("elbow_knee", elbow_knee_new(fr)),
            ("hip_tilt", tilt_new(fr, "left_hip", "right_hip")),
        ):
            if v is not None:
                data_by[test][name].append(v)

print("=" * 92)
print("KNEE TRACK: denominator comparison (does the ratio inflate as the knee bends?)")
print("=" * 92)
for test in ("deep_squat", "hurdle_step", "inline_lunge"):
    ls = data_by[test]["legspan"]
    fm = data_by[test]["femur"]
    kf = data_by[test]["knee_flex"]
    print(f"\n{test}   (scored-frame knee angle: med={statistics.median(kf):.0f} deg)")
    for label, vals in (("/|hip-ankle|", ls), ("/femur     ", fm)):
        v = sorted(vals)
        print(f"   {label}  min={v[0]:+.3f} med={statistics.median(v):+.3f} max={v[-1]:+.3f}  |med|={abs(statistics.median(v)):.3f}")
    if len(ls) == len(kf) and len(ls) > 2:
        print(f"   corr(|legspan metric|, knee flexion) = {np.corrcoef([abs(x) for x in ls], kf)[0,1]:+.2f}"
              f"   corr(|femur metric|, knee flexion) = {np.corrcoef([abs(x) for x in fm], kf)[0,1]:+.2f}")

print()
print("=" * 92)
print("THRESHOLD SWEEPS (how many of 18 would be flagged)")
print("=" * 92)


def sweep(label, vals, thresholds, mode="abs_gt"):
    print(f"\n{label}  (n={len(vals)})")
    for t in thresholds:
        if mode == "abs_gt":
            k = sum(1 for v in vals if abs(v) > t)
        elif mode == "gt":
            k = sum(1 for v in vals if v > t)
        print(f"   > {t:<6}: {k:2}/{len(vals)}  ({100*k/len(vals):.0f}%)")


sweep("deep_squat  knee_track /femur  (|value|)", data_by["deep_squat"]["femur"], [0.15, 0.20, 0.25, 0.30, 0.40])
sweep("hurdle_step knee_track /femur  (|value|)", data_by["hurdle_step"]["femur"], [0.15, 0.20, 0.25, 0.30, 0.40])
sweep("hurdle_step hip_tilt_new", data_by["hurdle_step"]["hip_tilt"], [0.10, 0.15, 0.18, 0.20, 0.25], "gt")
sweep("rotary      elbow_knee_new", data_by["rotary_stability"]["elbow_knee"], [0.20, 0.25, 0.30, 0.35, 0.45], "gt")
