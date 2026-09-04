import unittest

import numpy as np

from fms_scoring import FMSFrame, FMSScorer, KP, compute_angles, summarize_screen


def make_frame(overrides=None, frame=0):
    points = np.zeros((17, 2), dtype=float)
    scores = np.ones(17, dtype=float)

    defaults = {
        "left_shoulder": (80, 50),
        "right_shoulder": (120, 50),
        "left_elbow": (70, 40),
        "right_elbow": (130, 40),
        "left_wrist": (70, 20),
        "right_wrist": (130, 20),
        "left_hip": (85, 130),
        "right_hip": (115, 130),
        "left_knee": (85, 190),
        "right_knee": (115, 190),
        "left_ankle": (85, 250),
        "right_ankle": (115, 250),
    }
    if overrides:
        defaults.update(overrides)

    for name, xy in defaults.items():
        points[KP[name]] = xy

    return FMSFrame(
        frame=frame,
        timestamp_s=frame / 30.0,
        keypoints=points,
        scores=scores,
        angles=compute_angles(points, scores),
    )


class FMSScoringTests(unittest.TestCase):
    def test_pain_forces_zero(self):
        result = FMSScorer().score("deep_squat", [make_frame()], pain=True)
        self.assertEqual(result["score"], 0)
        self.assertIn("pain_reported", result["faults"])

    def test_shoulder_mobility_scores_by_hand_distance(self):
        close_frames = [
            make_frame(
                {
                    "left_wrist": (95, 65),
                    "right_wrist": (105, 90),
                    "left_shoulder": (80, 50),
                    "right_shoulder": (120, 50),
                },
                frame=i,
            )
            for i in range(6)
        ]
        result = FMSScorer().score(
            "shoulder_mobility",
            close_frames,
            hand_length_in=8,
            shoulder_width_in=16,
        )
        self.assertEqual(result["score"], 2)
        self.assertEqual(result["status"], "scored")
        self.assertIn("bestDistanceIn", result["measurements"])

    def test_summary_uses_scored_tests_only(self):
        scored = FMSScorer().score("deep_squat", [make_frame() for _ in range(6)])
        shoulder = FMSScorer().score(
            "shoulder_mobility",
            [make_frame() for _ in range(6)],
            hand_length_in=8,
            shoulder_width_in=16,
        )
        summary = summarize_screen([scored, shoulder])
        self.assertEqual(summary["scoredTests"], 2)
        self.assertEqual(summary["maxScore"], 6)
        self.assertEqual(summary["standardMaxScore"], 21)


if __name__ == "__main__":
    unittest.main()
