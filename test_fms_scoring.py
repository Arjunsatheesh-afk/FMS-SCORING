import ast
import inspect
import unittest

import numpy as np

import fms_scoring
from fms_scoring import (
    FMS_TESTS,
    FMSFrame,
    FMSScorer,
    KP,
    THRESHOLDS,
    checks_for,
    compute_angles,
    summarize_screen,
    threshold_spec,
)


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


def _score_method_nodes():
    """Each _score_<test> method as (test_id, ast.FunctionDef)."""
    tree = ast.parse(inspect.getsource(fms_scoring))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith("_score_"):
            test_id = node.name[len("_score_") :]
            if test_id in FMS_TESTS:
                yield test_id, node


def _declared_faults(test_id: str) -> set[str]:
    """Faults the served spec claims for a test.

    Read from threshold_spec() rather than THRESHOLDS directly, because that is
    what the report consumes - and because shoulder mobility declares its
    faults as score bands rather than checks.
    """
    entry = next(e for e in threshold_spec()["tests"] if e["testId"] == test_id)
    declared = {check["fault"] for check in entry["checks"] if check["fault"]}
    declared |= {band["fault"] for band in entry.get("scoreBands", []) if band["fault"]}
    return declared


def _faults_emitted(node: ast.FunctionDef) -> set[str]:
    """Fault ids the method can append, read from its source."""
    emitted = set()
    for inner in ast.walk(node):
        if (
            isinstance(inner, ast.Call)
            and isinstance(inner.func, ast.Attribute)
            and inner.func.attr == "append"
            and isinstance(inner.func.value, ast.Name)
            and inner.func.value.id == "faults"
            and inner.args
            and isinstance(inner.args[0], ast.Constant)
            and isinstance(inner.args[0].value, str)
        ):
            emitted.add(inner.args[0].value)
    return emitted


class ThresholdDeclarationTests(unittest.TestCase):
    """Guards against the scoring methods and THRESHOLDS drifting apart.

    The report shows a measurement beside the threshold it was judged against,
    which is only honest while the declared table is what the scorer actually
    applies. These tests fail if the two ever diverge.
    """

    # Degenerate-geometry guards, not thresholds: a zero-length segment or a
    # non-positive calibration input. Any other literal in a comparison inside
    # a scoring method means a threshold has been written twice.
    GUARD_LITERALS = {0, 0.0, 1.0, 1e-6}

    # Comparisons against these variables are about a resulting score, not a
    # measured quantity, so their literals are score values rather than
    # thresholds.
    SCORE_VARIABLES = {"final_score", "side_score"}

    def test_every_emitted_fault_is_declared(self):
        for test_id, node in _score_method_nodes():
            declared = _declared_faults(test_id)
            for fault in _faults_emitted(node):
                with self.subTest(test=test_id, fault=fault):
                    self.assertIn(
                        fault,
                        declared,
                        f"{fault} is raised by _score_{test_id} but not declared in "
                        "THRESHOLDS, so the report cannot show what it was judged against",
                    )

    def test_every_declared_fault_is_emitted(self):
        for test_id, node in _score_method_nodes():
            emitted = _faults_emitted(node)
            for fault in _declared_faults(test_id):
                with self.subTest(test=test_id, fault=fault):
                    self.assertIn(
                        fault,
                        emitted,
                        f"{fault} is declared for {test_id} but _score_{test_id} "
                        "never raises it, so the report would show a check that cannot fire",
                    )

    def test_no_threshold_literals_left_in_scoring_methods(self):
        for test_id, node in _score_method_nodes():
            for inner in ast.walk(node):
                if not isinstance(inner, ast.Compare):
                    continue
                if isinstance(inner.left, ast.Name) and inner.left.id in self.SCORE_VARIABLES:
                    continue
                for operand in [inner.left, *inner.comparators]:
                    if not isinstance(operand, ast.Constant):
                        continue
                    if not isinstance(operand.value, (int, float)):
                        continue
                    with self.subTest(test=test_id, literal=operand.value):
                        self.assertIn(
                            operand.value,
                            self.GUARD_LITERALS,
                            f"_score_{test_id} compares against the literal "
                            f"{operand.value}; thresholds belong in THRESHOLDS so the "
                            "report and the scorer cannot disagree",
                        )

    def test_check_boundary_is_exclusive(self):
        for test_id, checks in THRESHOLDS.items():
            for check in checks:
                if check.value is None:
                    continue
                with self.subTest(test=test_id, check=check.key):
                    self.assertFalse(
                        check.fails(check.value),
                        "a value exactly on the threshold must not fail",
                    )
                    past = check.value + (1.0 if check.comparison == "gt" else -1.0)
                    self.assertTrue(check.fails(past))
                    self.assertFalse(check.fails(None))

    def test_declared_measurements_are_reported(self):
        """Every numeric check names a measurement the scorer actually stores."""
        stored = {
            "deep_squat": {"kneeAngle", "hipAngle", "trunkLeanDeg", "kneeMedialOffset"},
            "hurdle_step": {"kneeAngle", "hipAngle", "stepHeightNorm", "pelvisTiltNorm", "kneeOffsetAbs"},
            "inline_lunge": {"kneeAngle", "hipAngle", "trunkLeanDeg"},
            "shoulder_mobility": set(),
            "active_straight_leg_raise": {"raisedHipAngle", "raisedKneeAngle", "oppositeKneeAngle"},
            "trunk_stability_pushup": {"elbowAngle", "kneeAngle", "bodyLineErrorNorm"},
            "rotary_stability": {"elbowKneeDistanceNorm"},
        }
        for test_id, checks in THRESHOLDS.items():
            for check in checks:
                if check.measurement is None:
                    continue
                with self.subTest(test=test_id, check=check.key):
                    self.assertIn(check.measurement, stored[test_id])

    def test_threshold_spec_covers_every_test(self):
        spec = threshold_spec()
        self.assertEqual(
            [entry["testId"] for entry in spec["tests"]],
            list(FMS_TESTS),
        )
        shoulder = next(e for e in spec["tests"] if e["testId"] == "shoulder_mobility")
        self.assertEqual(shoulder["checks"], [])
        self.assertEqual([band["score"] for band in shoulder["scoreBands"]], [3, 2, 1])


class ThresholdBehaviourTests(unittest.TestCase):
    """The declared numbers are the ones the scorer really applies."""

    def _frames(self, overrides):
        return [make_frame(overrides, frame=i) for i in range(6)]

    def test_depth_fault_follows_the_declared_thresholds(self):
        knee_check = next(c for c in checks_for("deep_squat") if c.key == "depth_knee")
        hip_check = next(c for c in checks_for("deep_squat") if c.key == "depth_hip")

        # Standing upright: both angles near straight, well past both cutoffs.
        standing = FMSScorer().score("deep_squat", self._frames({}))
        self.assertGreater(standing["measurements"]["kneeAngle"], knee_check.value)
        self.assertGreater(standing["measurements"]["hipAngle"], hip_check.value)
        self.assertIn("insufficient_depth", standing["faults"])

        # A genuine squat: knees and hips both folded past their cutoffs. The
        # fault is OR-ed across the two, so both have to clear for it to stay
        # silent - which is the behaviour this asserts.
        squatting = FMSScorer().score(
            "deep_squat",
            self._frames(
                {
                    "left_shoulder": (95, 50),
                    "right_shoulder": (105, 50),
                    "left_hip": (95, 130),
                    "right_hip": (105, 130),
                    "left_knee": (135, 140),
                    "right_knee": (145, 140),
                    "left_ankle": (95, 200),
                    "right_ankle": (105, 200),
                }
            ),
        )
        self.assertLess(squatting["measurements"]["kneeAngle"], knee_check.value)
        self.assertLess(squatting["measurements"]["hipAngle"], hip_check.value)
        self.assertNotIn("insufficient_depth", squatting["faults"])

    def test_shoulder_bands_match_the_declared_multipliers(self):
        self.assertEqual(
            fms_scoring._score_shoulder_distance(8.0, 8.0), 3, "1.0 hand lengths is a 3"
        )
        self.assertEqual(fms_scoring._score_shoulder_distance(12.0, 8.0), 2)
        self.assertEqual(fms_scoring._score_shoulder_distance(12.1, 8.0), 1)


if __name__ == "__main__":
    unittest.main()
