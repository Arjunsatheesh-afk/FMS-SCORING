"""Rule-based Functional Movement Screen scoring helpers.

The scorer works on one movement attempt at a time. It expects pose frames with
COCO-17 keypoints, confidence scores, and joint angles, then returns a 0-3 FMS
score plus the faults that drove the decision.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

SCORE_THR = 0.3

KP = {
    "nose": 0,
    "left_eye": 1,
    "right_eye": 2,
    "left_ear": 3,
    "right_ear": 4,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16,
}

JOINT_ANGLES = [
    ("left_knee_angle", "left_hip", "left_knee", "left_ankle"),
    ("right_knee_angle", "right_hip", "right_knee", "right_ankle"),
    ("left_hip_angle", "left_shoulder", "left_hip", "left_knee"),
    ("right_hip_angle", "right_shoulder", "right_hip", "right_knee"),
    ("left_elbow_angle", "left_shoulder", "left_elbow", "left_wrist"),
    ("right_elbow_angle", "right_shoulder", "right_elbow", "right_wrist"),
    ("left_shoulder_angle", "left_elbow", "left_shoulder", "left_hip"),
    ("right_shoulder_angle", "right_elbow", "right_shoulder", "right_hip"),
]

FMS_TESTS = {
    "deep_squat": {
        "name": "Deep Squat",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 1", "deep squat", "squat"],
    },
    "hurdle_step": {
        "name": "Hurdle Step",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 2", "hurdle step"],
    },
    "inline_lunge": {
        "name": "Inline Lunge",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 3", "inline lunge", "in-line lunge"],
    },
    "shoulder_mobility": {
        "name": "Shoulder Mobility",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 4", "shoulder mobility"],
    },
    "active_straight_leg_raise": {
        "name": "Active Straight-Leg Raise",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 5", "active straight leg raise", "leg raise"],
    },
    "trunk_stability_pushup": {
        "name": "Trunk Stability Push-Up",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 6", "trunk stability push up", "push-up", "pushup"],
    },
    "rotary_stability": {
        "name": "Rotary Stability",
        "max_score": 3,
        "automated": True,
        "aliases": ["exercise 7", "rotary stability"],
    },
}


@dataclass
class FMSFrame:
    frame: int
    timestamp_s: float
    keypoints: np.ndarray
    scores: np.ndarray
    angles: dict[str, float | None]


def normalize_test_name(value: str) -> str | None:
    """Map a folder name, CLI value, or friendly name to a canonical FMS id."""
    needle = value.strip().lower().replace("-", " ").replace("_", " ")
    for test_id, info in FMS_TESTS.items():
        if needle == test_id.replace("_", " "):
            return test_id
        if any(alias in needle for alias in info["aliases"]):
            return test_id
    return None


def compute_angles(kps: np.ndarray, scores: np.ndarray) -> dict[str, float | None]:
    return {
        name: _angle_at_vertex(kps, scores, KP[a], KP[b], KP[c])
        for name, a, b, c in JOINT_ANGLES
    }


def frames_from_tracked_json(data: dict[str, Any], track_id: str | None = None) -> list[FMSFrame]:
    tracks = data.get("tracks", {})
    if not tracks:
        return []

    selected_id = track_id or max(tracks, key=lambda tid: len(tracks[tid]))
    frames = []
    for item in tracks.get(selected_id, []):
        kps = item.get("keypoints")
        scores = item.get("scores")
        if kps is None or scores is None:
            continue
        frames.append(
            FMSFrame(
                frame=int(item.get("frame", 0)),
                timestamp_s=float(item.get("timestamp_s", 0.0)),
                keypoints=np.asarray(kps, dtype=float),
                scores=np.asarray(scores, dtype=float),
                angles=item.get("angles", {}),
            )
        )
    return frames


class FMSScorer:
    """Scores one FMS movement attempt using transparent biomechanical rules."""

    def score(
        self,
        test_id: str,
        frames: list[FMSFrame],
        *,
        pain: bool = False,
        expected_fault: str | None = None,
        hand_length_in: float = 8.0,
        shoulder_width_in: float = 16.0,
    ) -> dict[str, Any]:
        if test_id not in FMS_TESTS:
            raise ValueError(f"Unknown FMS test: {test_id}")

        info = FMS_TESTS[test_id]
        base = {
            "test": test_id,
            "testName": info["name"],
            "maxScore": info["max_score"],
            "automated": info["automated"],
            "painReported": bool(pain),
            "expectedFault": expected_fault,
        }

        if pain:
            return base | {
                "score": 0,
                "faults": ["pain_reported"],
                "measurements": {},
                "confidence": 1.0,
                "status": "scored",
            }

        if not info["automated"]:
            return base | {
                "score": None,
                "faults": ["manual_scoring_required"],
                "measurements": {},
                "confidence": 0.0,
                "status": "manual_required",
            }

        usable = [frame for frame in frames if _frame_confidence(frame) >= 0.45]
        if len(usable) < 5:
            return base | {
                "score": None,
                "faults": ["insufficient_pose_data"],
                "measurements": {"usableFrames": len(usable)},
                "confidence": 0.0,
                "status": "insufficient_data",
            }

        method = getattr(self, f"_score_{test_id}")
        if test_id == "shoulder_mobility":
            result = method(
                usable,
                hand_length_in=hand_length_in,
                shoulder_width_in=shoulder_width_in,
            )
        else:
            result = method(usable)
        return base | result | {"status": "scored"}

    def _score_deep_squat(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = min(frames, key=lambda item: _avg_angle(item, ["left_knee_angle", "right_knee_angle"], 180))
        m = _base_measurements(frame)
        knee_angle = m["kneeAngle"]
        hip_angle = m["hipAngle"]
        trunk_lean = _trunk_lean_deg(frame)
        knee_offset = _knee_medial_offset(frame)
        wrist_height = _mean_y(frame, ["left_wrist", "right_wrist"])
        shoulder_height = _mean_y(frame, ["left_shoulder", "right_shoulder"])

        faults = []
        if knee_angle > 115 or hip_angle > 125:
            faults.append("insufficient_depth")
        if trunk_lean > 32:
            faults.append("trunk_leans_forward")
        # Only the medial (valgus) direction is scored. Across the reference
        # set 17 of 18 squats read lateral, so knees tracking outward is the
        # normal baseline here rather than a compensation, and any varus cut
        # would just slice the tail of that distribution at an arbitrary point.
        if knee_offset > 0.10:
            faults.append("knees_inward_valgus")
        if wrist_height is not None and shoulder_height is not None and wrist_height > shoulder_height:
            faults.append("arms_not_maintained_overhead")

        complete = knee_angle <= 140 and hip_angle <= 145
        return _score_from_faults(
            faults,
            complete,
            {
                **m,
                "trunkLeanDeg": round(trunk_lean, 2),
                "kneeMedialOffset": round(knee_offset, 3),
                "scoredFrame": frame.frame,
            },
            confidence=_attempt_confidence(frames),
        )

    def _score_hurdle_step(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = max(frames, key=lambda item: _stepping_height(item))
        m = _base_measurements(frame)
        hip_asym = _abs_lr_diff(frame, "hip")
        knee_asym = _abs_lr_diff(frame, "knee")
        pelvis_tilt = _pair_tilt_norm(frame, "left_hip", "right_hip")
        knee_offset = abs(_knee_medial_offset(frame))
        step_height = _stepping_height(frame)

        faults = []
        if step_height < 0.16:
            faults.append("insufficient_step_clearance")
        if pelvis_tilt > 0.18:
            faults.append("pelvis_tilt")
        if knee_offset > 0.30:
            faults.append("knee_internal_external_rotation")
        if hip_asym < 12 and knee_asym < 12:
            faults.append("limited_single_leg_motion")

        complete = step_height >= 0.10
        return _score_from_faults(
            faults,
            complete,
            {
                **m,
                "stepHeightNorm": round(step_height, 3),
                "pelvisTiltNorm": round(pelvis_tilt, 3),
                "kneeOffsetAbs": round(knee_offset, 3),
                "scoredFrame": frame.frame,
            },
            confidence=_attempt_confidence(frames),
        )

    def _score_inline_lunge(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = min(frames, key=lambda item: _avg_angle(item, ["left_knee_angle", "right_knee_angle"], 180))
        m = _base_measurements(frame)
        knee_angle = m["kneeAngle"]
        trunk_lean = _trunk_lean_deg(frame)

        # knee_alignment_compensation and balance_or_pelvis_shift are dropped:
        # both are frontal-plane quantities and this test is filmed sagittally,
        # where they are unrecoverable rather than merely noisy. See notAssessed.
        faults = []
        if knee_angle > 125:
            faults.append("insufficient_knee_flexion")
        if trunk_lean > 28:
            faults.append("forward_trunk_lean")

        complete = knee_angle <= 145
        return _score_from_faults(
            faults,
            complete,
            {
                **m,
                "trunkLeanDeg": round(trunk_lean, 2),
                "scoredFrame": frame.frame,
                "notAssessed": ["knee_alignment_compensation", "balance_or_pelvis_shift"],
            },
            confidence=_attempt_confidence(frames),
        )

    def _score_shoulder_mobility(
        self,
        frames: list[FMSFrame],
        *,
        hand_length_in: float,
        shoulder_width_in: float,
    ) -> dict[str, Any]:
        candidates: list[dict[str, Any]] = []
        for frame in frames:
            left_wrist = _point(frame, "left_wrist")
            right_wrist = _point(frame, "right_wrist")
            left_shoulder = _point(frame, "left_shoulder")
            right_shoulder = _point(frame, "right_shoulder")
            if (
                left_wrist is None
                or right_wrist is None
                or left_shoulder is None
                or right_shoulder is None
            ):
                continue

            shoulder_width_px = float(np.linalg.norm(left_shoulder - right_shoulder))
            if shoulder_width_px < 1.0 or shoulder_width_in <= 0 or hand_length_in <= 0:
                continue

            wrist_distance_px = float(np.linalg.norm(left_wrist - right_wrist))
            pixels_per_in = shoulder_width_px / shoulder_width_in
            distance_in = wrist_distance_px / pixels_per_in
            top_hand = "left" if left_wrist[1] < right_wrist[1] else "right"
            candidates.append(
                {
                    "frame": frame,
                    "topHand": top_hand,
                    "distanceIn": distance_in,
                    "wristDistancePx": wrist_distance_px,
                    "shoulderWidthPx": shoulder_width_px,
                }
            )

        if not candidates:
            return {
                "score": None,
                "faults": ["insufficient_wrist_or_shoulder_data"],
                "measurements": {
                    "handLengthIn": hand_length_in,
                    "shoulderWidthIn": shoulder_width_in,
                },
                "confidence": 0.0,
            }

        best_by_side = {}
        for candidate in candidates:
            side = candidate["topHand"]
            current = best_by_side.get(side)
            if current is None or candidate["distanceIn"] < current["distanceIn"]:
                best_by_side[side] = candidate

        side_results = []
        for side, candidate in sorted(best_by_side.items()):
            distance_in = candidate["distanceIn"]
            side_score = _score_shoulder_distance(distance_in, hand_length_in)
            side_results.append(
                {
                    "topHand": side,
                    "score": side_score,
                    "distanceIn": round(distance_in, 2),
                    "distanceHandLengths": round(distance_in / hand_length_in, 2),
                    "scoredFrame": candidate["frame"].frame,
                }
            )

        final_side = min(side_results, key=lambda item: item["score"])
        best_candidate = best_by_side[final_side["topHand"]]
        final_score = final_side["score"]
        faults = []
        if final_score == 2:
            faults.append("hands_more_than_one_hand_length_apart")
        elif final_score == 1:
            faults.append("hands_more_than_one_and_half_hand_lengths_apart")

        return {
            "score": final_score,
            "faults": faults,
            "measurements": {
                "handLengthIn": hand_length_in,
                "shoulderWidthIn": shoulder_width_in,
                "bestDistanceIn": final_side["distanceIn"],
                "bestDistanceHandLengths": final_side["distanceHandLengths"],
                "topHand": final_side["topHand"],
                "scoredFrame": final_side["scoredFrame"],
                "sideResults": side_results,
                "wristDistancePx": round(best_candidate["wristDistancePx"], 2),
                "shoulderWidthPx": round(best_candidate["shoulderWidthPx"], 2),
                "note": "Uses wrist-to-wrist distance as a camera proxy for closest fist-to-fist distance.",
            },
            "confidence": round(_attempt_confidence(frames), 3),
        }

    def _score_active_straight_leg_raise(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = min(frames, key=lambda item: min(_angle(item, "left_hip_angle", 180), _angle(item, "right_hip_angle", 180)))
        left_hip = _angle(frame, "left_hip_angle", 180)
        right_hip = _angle(frame, "right_hip_angle", 180)
        raised_side = "left" if left_hip < right_hip else "right"
        raised_hip = min(left_hip, right_hip)
        raised_knee = _angle(frame, f"{raised_side}_knee_angle", 180)
        opposite = "right" if raised_side == "left" else "left"
        opposite_knee = _angle(frame, f"{opposite}_knee_angle", 180)

        # pelvis_lift_or_rotation is dropped: the subject is supine and filmed
        # from the side, so the pelvis L-R axis points at the camera and
        # obliquity cannot be separated from rotation. See notAssessed.
        faults = []
        if raised_hip > 110:
            faults.append("insufficient_leg_raise")
        if raised_knee < 155:
            faults.append("same_side_knee_flexion")
        if opposite_knee < 160:
            faults.append("opposite_side_knee_flexion")

        complete = raised_hip <= 135
        return _score_from_faults(
            faults,
            complete,
            {
                "raisedSide": raised_side,
                "raisedHipAngle": round(raised_hip, 2),
                "raisedKneeAngle": round(raised_knee, 2),
                "oppositeKneeAngle": round(opposite_knee, 2),
                "scoredFrame": frame.frame,
                "notAssessed": ["pelvis_lift_or_rotation"],
            },
            confidence=_attempt_confidence(frames),
        )

    def _score_trunk_stability_pushup(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = min(frames, key=lambda item: _avg_angle(item, ["left_elbow_angle", "right_elbow_angle"], 180))
        shoulder_y = _mean_y(frame, ["left_shoulder", "right_shoulder"])
        hip_y = _mean_y(frame, ["left_hip", "right_hip"])
        ankle_y = _mean_y(frame, ["left_ankle", "right_ankle"])
        body_sag = _body_line_error(frame)
        elbow_angle = _avg_angle(frame, ["left_elbow_angle", "right_elbow_angle"], 180)
        knee_angle = _avg_angle(frame, ["left_knee_angle", "right_knee_angle"], 180)

        faults = []
        if elbow_angle > 135:
            faults.append("insufficient_pushup_range")
        if body_sag > 0.12:
            faults.append("trunk_extension_or_sag")
        if knee_angle < 150:
            faults.append("knee_flexion")

        complete = shoulder_y is not None and hip_y is not None and ankle_y is not None and elbow_angle <= 160
        return _score_from_faults(
            faults,
            bool(complete),
            {
                "bodyLineErrorNorm": round(body_sag, 3),
                "elbowAngle": round(elbow_angle, 2),
                "kneeAngle": round(knee_angle, 2),
                "scoredFrame": frame.frame,
            },
            confidence=_attempt_confidence(frames),
        )

    def _score_rotary_stability(self, frames: list[FMSFrame]) -> dict[str, Any]:
        frame = min(frames, key=lambda item: _elbow_knee_distance_norm(item))
        touch_distance = _elbow_knee_distance_norm(frame)

        # shoulder_or_pelvis_rotation and shoulder_lowering are dropped: both
        # derive from transverse-segment tilt, which is unrecoverable from the
        # sagittal view this test is filmed from. The elbow-to-knee touch is
        # kept because that movement happens in the plane the camera sees.
        # 0.40 sits in the empty band of the reference distribution: 16 of 18
        # attempts land at or below 0.284 and the two genuine misses at 0.817.
        # A tighter cut would clip the top of the successful cluster instead.
        faults = []
        if touch_distance > 0.40:
            faults.append("fail_to_touch_elbow_to_knee")

        complete = touch_distance <= 0.60
        return _score_from_faults(
            faults,
            complete,
            {
                "elbowKneeDistanceNorm": round(touch_distance, 3),
                "scoredFrame": frame.frame,
                "notAssessed": ["shoulder_or_pelvis_rotation", "shoulder_lowering"],
            },
            confidence=_attempt_confidence(frames),
        )


def summarize_screen(results: list[dict[str, Any]]) -> dict[str, Any]:
    scored = [item for item in results if isinstance(item.get("score"), int)]
    automated = [item for item in results if item.get("automated")]
    total = sum(item["score"] for item in scored)
    max_score = sum(item.get("maxScore", 0) for item in scored)
    automated_max = sum(item.get("maxScore", 0) for item in automated)
    weakest = [
        item["test"]
        for item in sorted(scored, key=lambda value: value["score"])
        if item["score"] < 2
    ]
    return {
        "score": total,
        "maxScore": max_score,
        "automatedMaxScore": automated_max,
        "standardMaxScore": 21,
        "scoredTests": len(scored),
        "totalTests": len(FMS_TESTS),
        "weakestTests": weakest,
        "results": results,
    }


def _angle_at_vertex(kps: np.ndarray, scores: np.ndarray, a: int, b: int, c: int) -> float | None:
    if scores[a] < SCORE_THR or scores[b] < SCORE_THR or scores[c] < SCORE_THR:
        return None
    v1 = kps[a] - kps[b]
    v2 = kps[c] - kps[b]
    denom = np.linalg.norm(v1) * np.linalg.norm(v2)
    if denom < 1e-6:
        return None
    cos_a = float(np.clip(np.dot(v1, v2) / denom, -1.0, 1.0))
    return round(math.degrees(math.acos(cos_a)), 2)


def _score_from_faults(
    faults: list[str],
    complete: bool,
    measurements: dict[str, Any],
    *,
    confidence: float,
) -> dict[str, Any]:
    if not complete:
        score = 1
    elif faults:
        score = 2
    else:
        score = 3
    return {
        "score": score,
        "faults": faults,
        "measurements": measurements,
        "confidence": round(confidence, 3),
    }


def _score_shoulder_distance(distance_in: float, hand_length_in: float) -> int:
    if distance_in <= hand_length_in:
        return 3
    if distance_in <= hand_length_in * 1.5:
        return 2
    return 1


def _frame_confidence(frame: FMSFrame) -> float:
    important = [
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
    ]
    return float(np.mean([frame.scores[KP[name]] for name in important]))


def _attempt_confidence(frames: list[FMSFrame]) -> float:
    return float(np.mean([_frame_confidence(frame) for frame in frames]))


def _angle(frame: FMSFrame, key: str, default: float) -> float:
    value = frame.angles.get(key)
    return default if value is None else float(value)


def _avg_angle(frame: FMSFrame, keys: list[str], default: float) -> float:
    values = [_angle(frame, key, math.nan) for key in keys]
    valid = [value for value in values if not math.isnan(value)]
    return float(np.mean(valid)) if valid else default


def _base_measurements(frame: FMSFrame) -> dict[str, float]:
    return {
        "kneeAngle": round(_avg_angle(frame, ["left_knee_angle", "right_knee_angle"], 180), 2),
        "hipAngle": round(_avg_angle(frame, ["left_hip_angle", "right_hip_angle"], 180), 2),
    }


def _midpoint(frame: FMSFrame, a: str, b: str) -> np.ndarray | None:
    ia = KP[a]
    ib = KP[b]
    if frame.scores[ia] < SCORE_THR or frame.scores[ib] < SCORE_THR:
        return None
    return (frame.keypoints[ia] + frame.keypoints[ib]) / 2.0


def _point(frame: FMSFrame, name: str) -> np.ndarray | None:
    idx = KP[name]
    if frame.scores[idx] < SCORE_THR:
        return None
    return frame.keypoints[idx]


def _torso_length(frame: FMSFrame) -> float | None:
    """Shoulder-midpoint to hip-midpoint distance.

    Used as the normalising scale throughout. Unlike hip or shoulder width,
    the torso runs along the camera's vertical rotation axis, so it barely
    foreshortens as the subject turns: it stays a stable reference where a
    transverse width collapses toward zero in a sagittal view.
    """
    shoulder_mid = _midpoint(frame, "left_shoulder", "right_shoulder")
    hip_mid = _midpoint(frame, "left_hip", "right_hip")
    if shoulder_mid is None or hip_mid is None:
        return None
    length = float(np.linalg.norm(shoulder_mid - hip_mid))
    return length if length > 1e-6 else None


def _mean_y(frame: FMSFrame, names: list[str]) -> float | None:
    ys = []
    for name in names:
        point = _point(frame, name)
        if point is not None:
            ys.append(float(point[1]))
    return float(np.mean(ys)) if ys else None


def _trunk_lean_deg(frame: FMSFrame) -> float:
    shoulder_mid = _midpoint(frame, "left_shoulder", "right_shoulder")
    hip_mid = _midpoint(frame, "left_hip", "right_hip")
    if shoulder_mid is None or hip_mid is None:
        return 0.0
    vector = shoulder_mid - hip_mid
    vertical = np.array([0.0, -1.0])
    denom = np.linalg.norm(vector) * np.linalg.norm(vertical)
    if denom < 1e-6:
        return 0.0
    cos_a = float(np.clip(np.dot(vector, vertical) / denom, -1.0, 1.0))
    return abs(math.degrees(math.acos(cos_a)))


def _knee_medial_offset(frame: FMSFrame) -> float:
    """Knee deviation from the hip-ankle line, normalised by torso length.

    Positive is medial (valgus), negative lateral (varus), signed against the
    pelvis midline so the sign means the same thing for both legs - raw image
    x gave opposite signs for the same compensation on left and right.

    The offset is the true perpendicular distance to the hip-ankle line, so it
    is invariant to in-plane rotation; the previous version compared knee x
    against the average of hip and ankle x, which only coincides with the line
    when the leg is vertical in frame.

    FRONTAL VIEWS ONLY. Valgus/varus is a frontal-plane quantity; measured from
    the side this returns anterior knee travel instead, which is large and
    normal in a lunge. Callers must not use it for sagittal tests.
    """
    left_hip = _point(frame, "left_hip")
    right_hip = _point(frame, "right_hip")
    torso = _torso_length(frame)
    if left_hip is None or right_hip is None or torso is None:
        return 0.0
    pelvis_mid = (left_hip + right_hip) / 2.0

    worst = 0.0
    for side in ("left", "right"):
        hip = _point(frame, f"{side}_hip")
        knee = _point(frame, f"{side}_knee")
        ankle = _point(frame, f"{side}_ankle")
        if hip is None or knee is None or ankle is None:
            continue
        leg = ankle - hip
        leg_length = float(np.linalg.norm(leg))
        if leg_length < 1e-6:
            continue
        normal = np.array([-leg[1], leg[0]]) / leg_length
        offset = float(np.dot(knee - hip, normal))
        medial_sign = float(np.sign(float(np.dot(pelvis_mid - hip, normal)))) or 1.0
        value = offset * medial_sign / torso
        if abs(value) > abs(worst):
            worst = value
    return worst


def _pair_tilt_norm(frame: FMSFrame, left: str, right: str) -> float:
    """Obliquity of a transverse segment as vertical offset / torso length.

    For a level camera orbiting the subject, rotation about the world-vertical
    axis leaves the segment's vertical component unchanged - only its
    horizontal component foreshortens. Taking dy alone is therefore invariant
    to viewing azimuth, whereas atan2(dy, dx) tends to 90 degrees as dx
    collapses, which is what produced 86-degree "pelvis tilt" readings on
    side-on footage.

    FRONTAL VIEWS ONLY. Stability is not validity: viewed from the side, the
    pelvis L-R axis points at the camera and obliquity becomes confounded with
    pelvic rotation, so the number is meaningless regardless of how it is
    computed. Callers must not use it for sagittal tests.
    """
    p1 = _point(frame, left)
    p2 = _point(frame, right)
    torso = _torso_length(frame)
    if p1 is None or p2 is None or torso is None:
        return 0.0
    return abs(float(p2[1] - p1[1])) / torso


def _abs_lr_diff(frame: FMSFrame, joint: str) -> float:
    return abs(_angle(frame, f"left_{joint}_angle", 180) - _angle(frame, f"right_{joint}_angle", 180))


def _stepping_height(frame: FMSFrame) -> float:
    hip_y = _mean_y(frame, ["left_hip", "right_hip"])
    ankle_y = _mean_y(frame, ["left_ankle", "right_ankle"])
    if hip_y is None or ankle_y is None:
        return 0.0
    left_ankle = _point(frame, "left_ankle")
    right_ankle = _point(frame, "right_ankle")
    if left_ankle is None or right_ankle is None:
        return 0.0
    lifted = min(left_ankle[1], right_ankle[1])
    leg_span = max(abs(ankle_y - hip_y), 1.0)
    return float((ankle_y - lifted) / leg_span)


def _body_line_error(frame: FMSFrame) -> float:
    shoulder = _midpoint(frame, "left_shoulder", "right_shoulder")
    hip = _midpoint(frame, "left_hip", "right_hip")
    ankle = _midpoint(frame, "left_ankle", "right_ankle")
    if shoulder is None or hip is None or ankle is None:
        return 0.0
    line = ankle - shoulder
    denom = np.linalg.norm(line)
    if denom < 1e-6:
        return 0.0
    shoulder_to_hip = shoulder - hip
    cross = line[0] * shoulder_to_hip[1] - line[1] * shoulder_to_hip[0]
    distance = abs(cross / denom)
    return float(distance / max(np.linalg.norm(line), 1.0))


def _elbow_knee_distance_norm(frame: FMSFrame) -> float:
    """Closest elbow-to-knee gap, normalised by upper-arm + thigh length.

    The scale is the two limb segments that actually close the gap. Both are
    longitudinal, so they hold up in the sagittal view this test is filmed
    from; the previous transverse normalisation collapsed there and inflated
    the ratio by roughly 6x, firing the fault on every video.

    Valid from a sagittal view: the elbow-to-knee movement happens largely in
    the plane the camera sees. Projection can only understate the true 3D gap,
    so any residual error biases toward reporting a touch, never toward a
    false fault.
    """
    distances = []
    for side in ("left", "right"):
        shoulder = _point(frame, f"{side}_shoulder")
        elbow = _point(frame, f"{side}_elbow")
        hip = _point(frame, f"{side}_hip")
        knee = _point(frame, f"{side}_knee")
        if shoulder is None or elbow is None or hip is None or knee is None:
            continue
        scale = float(np.linalg.norm(shoulder - elbow)) + float(np.linalg.norm(hip - knee))
        if scale < 1e-6:
            continue
        distances.append(float(np.linalg.norm(elbow - knee)) / scale)
    return min(distances) if distances else 999.0
