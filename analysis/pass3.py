import json, statistics, sys
from collections import defaultdict
from pathlib import Path
# Project root: the parent of analysis/, or an explicit path as argv[1].
PROJECT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
import numpy as np
from fms_scoring import _avg_angle, _frame_confidence, _point, _stepping_height, frames_from_tracked_json
TRACKED = PROJECT / "fms_outputs" / "tracked"

def torso_len(f):
    ls, rs = _point(f,"left_shoulder"), _point(f,"right_shoulder")
    lh, rh = _point(f,"left_hip"), _point(f,"right_hip")
    if ls is None or rs is None or lh is None or rh is None: return None
    t = float(np.linalg.norm((ls+rs)/2.0 - (lh+rh)/2.0))
    return t if t > 1e-6 else None

def knee_track_torso(f):
    lh, rh = _point(f,"left_hip"), _point(f,"right_hip")
    t = torso_len(f)
    if lh is None or rh is None or t is None: return None
    pelvis = (lh+rh)/2.0
    best = None
    for side in ("left","right"):
        hip, knee, ankle = _point(f,f"{side}_hip"), _point(f,f"{side}_knee"), _point(f,f"{side}_ankle")
        if hip is None or knee is None or ankle is None: continue
        leg = ankle - hip; L = float(np.linalg.norm(leg))
        if L < 1e-6: continue
        n = np.array([-leg[1], leg[0]])/L
        d = float(np.dot(knee-hip, n))
        ms = np.sign(float(np.dot(pelvis-hip, n))) or 1.0
        v = (d*ms)/t
        if best is None or abs(v) > abs(best): best = v
    return best

SEL = {"deep_squat": lambda fs: min(fs, key=lambda f:_avg_angle(f,["left_knee_angle","right_knee_angle"],180)),
       "inline_lunge": lambda fs: min(fs, key=lambda f:_avg_angle(f,["left_knee_angle","right_knee_angle"],180)),
       "hurdle_step": lambda fs: max(fs, key=_stepping_height)}
for test in ("deep_squat","hurdle_step","inline_lunge"):
    vals, flex = [], []
    for p in sorted((TRACKED/test).glob("Sample-*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        fr = [f for f in frames_from_tracked_json(d) if _frame_confidence(f)>=0.45]
        if len(fr) < 5: continue
        f = SEL[test](fr)
        v = knee_track_torso(f)
        if v is not None:
            vals.append(v); flex.append(_avg_angle(f,["left_knee_angle","right_knee_angle"],180))
    s = sorted(vals)
    print(f"\n{test}  /torso   n={len(s)}  min={s[0]:+.3f} p25={s[len(s)//4]:+.3f} med={statistics.median(s):+.3f} p75={s[3*len(s)//4]:+.3f} max={s[-1]:+.3f}")
    print(f"   corr with knee flexion = {np.corrcoef([abs(x) for x in vals], flex)[0,1]:+.2f}")
    print(f"   sign: {sum(1 for v in vals if v>0)} positive(medial) / {sum(1 for v in vals if v<0)} negative(lateral)")
    for t in (0.10,0.15,0.20,0.25,0.30):
        print(f"      |v| > {t}: {sum(1 for v in vals if abs(v)>t):2}/{len(vals)}")
