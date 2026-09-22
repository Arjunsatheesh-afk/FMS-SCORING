"""Functional Movement Screen pipeline.

Examples:
  python fms_pipeline.py list-tests
  python fms_pipeline.py dataset --dataset Dataset/Participant-1
  python fms_pipeline.py video --test deep_squat --source path/to/video.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from fms_scoring import (
    FMSScorer,
    FMS_TESTS,
    KP,
    compute_angles,
    normalize_test_name,
    summarize_screen,
)

MODE = "balanced"
SCORE_THR = 0.3
KP_ALPHA = 0.5
ANG_ALPHA = 0.5
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}
_DLL_DIRECTORY_HANDLES = []


@dataclass
class DatasetVideo:
    test_id: str
    test_name: str
    video_path: Path
    movement_label: str
    expected_fault: str | None
    expected_score: int | None


def discover_dataset_videos(dataset_dir: Path) -> list[DatasetVideo]:
    """Discover FMS videos from the provided Participant folder."""
    videos: list[DatasetVideo] = []
    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    for exercise_dir in sorted(path for path in dataset_dir.iterdir() if path.is_dir()):
        test_id = normalize_test_name(exercise_dir.name)
        if test_id is None:
            continue
        test_name = FMS_TESTS[test_id]["name"]

        for file_path in sorted(exercise_dir.rglob("*")):
            if not file_path.is_file() or file_path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            parent_name = file_path.parent.name.lower()
            is_correct = "correct" in parent_name and "incorrect" not in parent_name
            movement_label = "correct" if is_correct else "compensation"
            expected_fault = None if is_correct else _fault_from_filename(file_path.stem)
            expected_score = 3 if is_correct else 2
            if not FMS_TESTS[test_id]["automated"]:
                expected_score = None

            videos.append(
                DatasetVideo(
                    test_id=test_id,
                    test_name=test_name,
                    video_path=file_path,
                    movement_label=movement_label,
                    expected_fault=expected_fault,
                    expected_score=expected_score,
                )
            )
    return videos


def extract_video_pose(
    video_path: Path,
    output_json: Path,
    *,
    detector: Any | None = None,
    mode: str = MODE,
    device: str = "cuda",
    overwrite: bool = False,
    live: bool = True,
    window_name: str = "FMS Live Tracking",
    progress_callback: Callable[[int, int], None] | None = None,
    orient_upright: bool = False,
) -> Path:
    """Track one video to JSON.

    `orient_upright` turns each frame so a subject lying across it is upright
    before detection - see _detect_upright. Off by default: it is currently
    used only for front-view clips, pending a before/after re-score of every
    horizontal-body side-view clip (PROJECT_STATUS.md, §13).
    """
    if output_json.exists() and not overwrite:
        if live:
            print(f"[fms_pipeline] Using cached tracking: {output_json}")
            print("[fms_pipeline] Use --overwrite to re-run pose tracking live.")
        return output_json

    output_json.parent.mkdir(parents=True, exist_ok=True)
    local_detector = detector or build_detector(mode=mode, preferred_device=device)[0]
    try:
        track, metadata = _run_pose_extraction(
            video_path,
            local_detector,
            live=live,
            window_name=window_name,
            progress_callback=progress_callback,
            orient_upright=orient_upright,
        )
    except Exception as exc:
        if detector is not None or device == "cpu" or not _looks_like_cuda_runtime_failure(exc):
            raise
        print(
            "[fms_pipeline] CUDA inference failed after startup; retrying this video on CPU."
        )
        local_detector = build_detector(mode=mode, preferred_device="cpu")[0]
        track, metadata = _run_pose_extraction(
            video_path,
            local_detector,
            live=live,
            window_name=window_name,
            progress_callback=progress_callback,
            orient_upright=orient_upright,
        )

    output = {
        "metadata": metadata | {
            "source": str(video_path),
            "mode": mode,
            "score_threshold": SCORE_THR,
            "format": "fms_pose_v1",
        },
        "tracks": {"0": track},
    }
    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
    return output_json


def _run_pose_extraction(
    video_path: Path,
    local_detector: Any,
    *,
    live: bool,
    window_name: str,
    progress_callback: Callable[[int, int], None] | None = None,
    orient_upright: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    import cv2
    from rtmlib import draw_skeleton

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    smoothed_kps: np.ndarray | None = None
    smoothed_angles: dict[str, float | None] = {}
    # Last confidently seen shoulder-minus-hip vector, in original coordinates;
    # it picks the rotation for the next frame when orient_upright is on.
    head_axis: np.ndarray | None = None
    track = []
    frame_idx = 0
    interrupted = False

    if live:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if progress_callback is not None:
                progress_callback(frame_idx, total_frames)

            rotation = ROTATE_NONE
            if orient_upright:
                keypoints, scores, rotation = _detect_upright(cv2, local_detector, frame, head_axis)
            else:
                keypoints, scores = local_detector(frame)
            if keypoints is None or len(keypoints) == 0:
                if live:
                    _show_live_frame(
                        cv2,
                        frame,
                        window_name,
                        video_path.name,
                        frame_idx,
                        total_frames,
                        "No person detected",
                    )
                    if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                        interrupted = True
                        break
                frame_idx += 1
                continue

            person_index = _select_primary_person(keypoints, scores)
            kps = np.asarray(keypoints[person_index], dtype=float)
            sc = np.asarray(scores[person_index], dtype=float)
            torso_points = [KP[name] for name in ("left_shoulder", "right_shoulder", "left_hip", "right_hip")]
            if orient_upright and np.all(sc[torso_points] >= SCORE_THR):
                head_axis = (kps[torso_points[0]] + kps[torso_points[1]]) / 2.0 - (
                    kps[torso_points[2]] + kps[torso_points[3]]
                ) / 2.0

            if smoothed_kps is None:
                smoothed_kps = kps.copy()
            else:
                confident = sc >= SCORE_THR
                smoothed_kps[confident] = (
                    KP_ALPHA * kps[confident] + (1.0 - KP_ALPHA) * smoothed_kps[confident]
                )

            raw_angles = compute_angles(smoothed_kps, sc)
            for name, value in raw_angles.items():
                previous = smoothed_angles.get(name)
                if value is None:
                    continue
                if previous is None:
                    smoothed_angles[name] = value
                else:
                    smoothed_angles[name] = round(ANG_ALPHA * value + (1.0 - ANG_ALPHA) * previous, 2)

            track.append(
                {
                    "frame": frame_idx,
                    "timestamp_s": round(frame_idx / max(fps, 1.0), 4),
                    "keypoints": smoothed_kps.round(3).tolist(),
                    "scores": sc.round(4).tolist(),
                    "angles": dict(smoothed_angles),
                }
            )
            if orient_upright:
                # Which way the frame was turned before detection, for audit.
                track[-1]["rotation"] = rotation

            if live:
                annotated = draw_skeleton(
                    frame,
                    keypoints,
                    scores,
                    openpose_skeleton=False,
                    kpt_thr=SCORE_THR,
                )
                _show_live_frame(
                    cv2,
                    annotated,
                    window_name,
                    video_path.name,
                    frame_idx,
                    total_frames,
                    "Tracking pose",
                )
                if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                    interrupted = True
                    frame_idx += 1
                    break
            frame_idx += 1
    finally:
        cap.release()
        if live:
            try:
                cv2.destroyWindow(window_name)
            except cv2.error:
                pass

    metadata = {
        "fps": fps,
        "total_frames": total_frames,
        "frames_processed": frame_idx,
        "width": width,
        "height": height,
        "interrupted": interrupted,
    }
    if orient_upright:
        metadata["orient_upright"] = True
    return track, metadata


def score_tracked_file(
    tracked_json: Path,
    test_id: str,
    *,
    expected_fault: str | None = None,
    pain: bool = False,
    hand_length_in: float = 8.0,
    shoulder_width_in: float = 16.0,
    declared_side: str | None = None,
    front_tracked_json: Path | None = None,
) -> dict[str, Any]:
    from fms_scoring import frames_from_tracked_json

    with open(tracked_json, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    frames = frames_from_tracked_json(data)

    # An optional second clip of the same attempt filmed from the front. Only
    # the tests with front-view checks use it; the scorer decides per check
    # whether the footage is good enough and records why when it is not.
    front_frames = None
    if front_tracked_json is not None:
        with open(front_tracked_json, "r", encoding="utf-8") as handle:
            front_frames = frames_from_tracked_json(json.load(handle))

    result = FMSScorer().score(
        test_id,
        frames,
        pain=pain,
        expected_fault=expected_fault,
        hand_length_in=hand_length_in,
        shoulder_width_in=shoulder_width_in,
        declared_side=declared_side,
        front_frames=front_frames,
    )
    result["source"] = data.get("metadata", {}).get("source", str(tracked_json))
    result["trackedJson"] = str(tracked_json)
    if front_tracked_json is not None:
        result["frontTrackedJson"] = str(front_tracked_json)
    return result


def analyze_dataset(
    dataset_dir: Path,
    output_dir: Path,
    *,
    mode: str = MODE,
    device: str = "cuda",
    overwrite: bool = False,
    pose_only: bool = False,
    live: bool = True,
    show_plot: bool = True,
    hand_length_in: float = 8.0,
    shoulder_width_in: float = 16.0,
) -> dict[str, Any]:
    videos = discover_dataset_videos(dataset_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    tracked_root = output_dir / "tracked"
    reports_dir = output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    detector, detector_device = build_detector(mode=mode, preferred_device=device)
    results = []

    for index, item in enumerate(videos, start=1):
        rel_name = _safe_name(item.video_path.relative_to(dataset_dir).with_suffix(""))
        tracked_json = tracked_root / item.test_id / f"{rel_name}.json"
        print(f"[{index}/{len(videos)}] {item.test_name}: {item.video_path.name}")
        try:
            extract_video_pose(
                item.video_path,
                tracked_json,
                detector=detector,
                mode=mode,
                device=detector_device,
                overwrite=overwrite,
                live=live,
                window_name="FMS Dataset Live Tracking",
            )
        except Exception as exc:
            if detector_device == "cpu" or not _looks_like_cuda_runtime_failure(exc):
                raise
            print(
                "[fms_pipeline] CUDA inference failed after startup; switching dataset run to CPU."
            )
            detector, detector_device = build_detector(mode=mode, preferred_device="cpu")
            extract_video_pose(
                item.video_path,
                tracked_json,
                detector=detector,
                mode=mode,
                device=detector_device,
                overwrite=True,
                live=live,
                window_name="FMS Dataset Live Tracking",
            )
        if pose_only:
            continue
        result = score_tracked_file(
            tracked_json,
            item.test_id,
            expected_fault=item.expected_fault,
            hand_length_in=hand_length_in,
            shoulder_width_in=shoulder_width_in,
        )
        result["datasetLabel"] = item.movement_label
        result["expectedScore"] = item.expected_score
        results.append(result)

    report = {
        "dataset": str(dataset_dir),
        "mode": mode,
        "device": detector_device,
        "videoCount": len(videos),
        "summary": summarize_screen(_best_result_per_test(results)),
        "videoResults": results,
    }

    report_path = reports_dir / "fms_dataset_report.json"
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"\nReport saved: {report_path}")
    if not pose_only:
        plot_path = reports_dir / "fms_dataset_scores.png"
        save_score_plot(report, plot_path, title="FMS Dataset Scores", show=show_plot)
    return report


def analyze_single_video(
    source: Path,
    test_id: str,
    output_dir: Path,
    *,
    mode: str = MODE,
    device: str = "cuda",
    overwrite: bool = False,
    pain: bool = False,
    live: bool = True,
    show_plot: bool = True,
    hand_length_in: float = 8.0,
    shoulder_width_in: float = 16.0,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    tracked_json = output_dir / "tracked" / test_id / f"{_safe_name(source.stem)}.json"
    extract_video_pose(
        source,
        tracked_json,
        mode=mode,
        device=device,
        overwrite=overwrite,
        live=live,
        window_name="FMS Video Live Tracking",
    )
    result = score_tracked_file(
        tracked_json,
        test_id,
        pain=pain,
        hand_length_in=hand_length_in,
        shoulder_width_in=shoulder_width_in,
    )
    report = summarize_screen([result])
    report["videoResult"] = result

    report_path = output_dir / "reports" / f"{_safe_name(source.stem)}_fms_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"Report saved: {report_path}")
    plot_path = output_dir / "reports" / f"{_safe_name(source.stem)}_fms_scores.png"
    save_score_plot(report, plot_path, title=f"FMS Score - {source.stem}", show=show_plot)
    return report


def save_score_plot(report: dict[str, Any], output_path: Path, *, title: str, show: bool) -> Path | None:
    try:
        import matplotlib.pyplot as plt
    except Exception as exc:
        print(f"[fms_pipeline] Matplotlib plot skipped: {exc}")
        return None

    summary = report.get("summary", report)
    results = summary.get("results", [])
    if not results:
        print("[fms_pipeline] Matplotlib plot skipped: no scored results.")
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    labels = [item.get("testName") or item.get("test") for item in results]
    scores = [item.get("score") if isinstance(item.get("score"), int) else 0 for item in results]
    max_scores = [item.get("maxScore", 3) for item in results]
    colors = [
        "#2e7d32" if score == 3 else "#f9a825" if score == 2 else "#c62828" if score == 1 else "#757575"
        for score in scores
    ]

    fig_width = max(8, len(labels) * 1.25)
    fig, ax = plt.subplots(figsize=(fig_width, 5.2))
    bars = ax.bar(labels, scores, color=colors, edgecolor="#222222", linewidth=0.8)
    ax.plot(labels, max_scores, color="#444444", linestyle="--", linewidth=1.2, label="Max per test")
    ax.set_ylim(0, 3.35)
    ax.set_ylabel("FMS score")
    ax.set_title(title)
    ax.grid(axis="y", linestyle=":", alpha=0.45)
    ax.legend(loc="upper right")

    for bar, item in zip(bars, results):
        score = item.get("score")
        label = "manual" if score is None else str(score)
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.06,
            label,
            ha="center",
            va="bottom",
            fontsize=9,
        )

    total = summary.get("score", 0)
    max_total = summary.get("maxScore", 0)
    automated_max = summary.get("automatedMaxScore", max_total)
    subtitle = f"Total: {total}/{max_total}"
    if automated_max != max_total:
        subtitle = f"{subtitle}  |  Automated max: {automated_max}"
    fig.text(0.01, 0.01, subtitle, fontsize=10, color="#333333")
    fig.autofmt_xdate(rotation=25, ha="right")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(output_path, dpi=160)
    print(f"Plot saved: {output_path}")

    if show:
        plt.show()
    else:
        plt.close(fig)
    return output_path


def _detector_session_providers(detector: Any) -> list[list[str]] | None:
    """Execution providers each ONNX session actually uses, or None if hidden."""
    groups: list[list[str]] = []
    for attr in ("det_model", "pose_model"):
        session = getattr(getattr(detector, attr, None), "session", None)
        if session is None or not hasattr(session, "get_providers"):
            return None
        groups.append(list(session.get_providers()))
    return groups or None


def build_detector(mode: str, preferred_device: str) -> tuple[Any, str]:
    _configure_windows_cuda_dll_paths()

    from rtmlib import Body

    devices = [preferred_device]
    if preferred_device != "cpu":
        devices.append("cpu")

    last_error: Exception | None = None
    for device in devices:
        try:
            detector = Body(mode=mode, to_openpose=False, backend="onnxruntime", device=device)
        except Exception as exc:
            last_error = exc
            continue

        if device == "cpu":
            return detector, device

        # A successful constructor is NOT proof the GPU is in use: when the CUDA
        # provider is unregistered (for example the CPU onnxruntime package
        # shadowing onnxruntime-gpu), onnxruntime silently runs on CPU and
        # rtmlib raises nothing. Confirm against the live sessions instead.
        provider_groups = _detector_session_providers(detector)
        if provider_groups is None:
            # Backend does not expose its sessions; nothing to check against.
            return detector, device
        if all("CUDAExecutionProvider" in providers for providers in provider_groups):
            return detector, device

        in_use = sorted({provider for group in provider_groups for provider in group})
        print(
            f"[fms_pipeline] '{device}' was requested but the sessions are running on "
            f"{in_use}; falling back to CPU."
        )
        last_error = RuntimeError(
            f"{device} requested but CUDAExecutionProvider was not active (providers: {in_use})"
        )

    raise RuntimeError(f"Could not initialize RTMPose detector: {last_error}")


def _configure_windows_cuda_dll_paths() -> None:
    if os.name != "nt":
        return

    try:
        import onnxruntime as ort

        # Empty string makes ONNXRuntime prefer the nvidia site-packages DLLs
        # over PyTorch's torch/lib DLLs. Mixing those cuDNN families can trigger
        # CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH during convolution.
        ort.preload_dlls(cuda=True, cudnn=True, msvc=True, directory="")
    except Exception as exc:
        print(f"[fms_pipeline] ONNXRuntime DLL preload skipped: {exc}")

    roots = [
        Path(sys.prefix) / "Lib" / "site-packages",
        Path(sys.base_prefix) / "Lib" / "site-packages",
    ]
    preferred_dirs = [
        Path("nvidia") / "cudnn" / "bin",
        Path("nvidia") / "cu13" / "bin",
    ]
    fallback_dirs = [Path("torch") / "lib"]

    existing_dirs = []
    for root in roots:
        for relative_dir in preferred_dirs:
            candidate = root / relative_dir
            if candidate.exists():
                existing_dirs.append(candidate)

    if not existing_dirs:
        for root in roots:
            for relative_dir in fallback_dirs:
                candidate = root / relative_dir
                if candidate.exists():
                    existing_dirs.append(candidate)

    if not existing_dirs:
        return

    current_path = os.environ.get("PATH", "")
    path_parts = current_path.split(os.pathsep) if current_path else []
    for directory in reversed(existing_dirs):
        directory_text = str(directory)
        if directory_text not in path_parts:
            path_parts.insert(0, directory_text)
        try:
            handle = os.add_dll_directory(directory_text)
            _DLL_DIRECTORY_HANDLES.append(handle)
        except (AttributeError, FileNotFoundError, OSError):
            pass
    os.environ["PATH"] = os.pathsep.join(path_parts)


def _looks_like_cuda_runtime_failure(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "cudnn",
            "cuda execution provider",
            "cudakernel",
            "cudnn64",
            "onnxruntimeerror",
        )
    )


def _show_live_frame(
    cv2: Any,
    frame: np.ndarray,
    window_name: str,
    video_name: str,
    frame_idx: int,
    total_frames: int,
    status: str,
) -> None:
    progress = f"{frame_idx + 1}/{total_frames}" if total_frames > 0 else str(frame_idx + 1)
    panel_h = 76
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame.shape[1], panel_h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
    cv2.putText(
        frame,
        f"FMS tracking: {video_name}",
        (12, 26),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"{status}  |  frame {progress}  |  q/Esc stops current video",
        (12, 56),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (80, 220, 255),
        1,
        cv2.LINE_AA,
    )
    cv2.imshow(window_name, frame)


def _select_primary_person(keypoints: np.ndarray, scores: np.ndarray) -> int:
    confidences = np.mean(scores, axis=1)
    return int(np.argmax(confidences))


# --------------------------------------------------------------------------
# Upright-oriented detection
#
# RTMPose is trained overwhelmingly on upright people. On a subject lying
# across the frame it is unstable: on Sample 9's elevated ASLR clip, 45% of the
# head-left frames lost the hips entirely (confidence 0.08-0.26, skeleton
# collapsed onto the head) while the subject lay still and fully visible.
# Rotating those same frames so the head points up recovered every one of them
# to 0.68-0.79, with keypoints verified by eye to land on the body once mapped
# back. The subject turns around mid-clip, so the rotation is chosen per frame
# from the body axis seen on the previous one.
# --------------------------------------------------------------------------

ROTATE_NONE = 0
ROTATE_CW = 90     # image turned clockwise: a head pointing left ends up on top
ROTATE_CCW = -90   # image turned counter-clockwise: a head pointing right ends up on top
# Below this mean keypoint score the chosen orientation is not trusted and the
# other two are tried as well - which is also how the first frame, and the
# frames of the turnaround itself, find their way.
_ORIENT_RETRY_SCORE = 0.5


def _rotate_frame(cv2: Any, frame: np.ndarray, rotation: int) -> np.ndarray:
    if rotation == ROTATE_CW:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if rotation == ROTATE_CCW:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def _unrotate_keypoints(keypoints: np.ndarray, rotation: int, width: int, height: int) -> np.ndarray:
    """Map keypoints detected on a rotated frame back to original pixel coordinates.

    `width` and `height` are the ORIGINAL frame's. Works on any array whose last
    axis is (x, y), so every detected person maps back in one call.
    """
    points = np.asarray(keypoints, dtype=float)
    x, y = points[..., 0], points[..., 1]
    if rotation == ROTATE_CW:       # (x, y) -> (height - 1 - y, x)
        return np.stack([y, height - 1 - x], axis=-1)
    if rotation == ROTATE_CCW:      # (x, y) -> (y, width - 1 - x)
        return np.stack([width - 1 - y, x], axis=-1)
    return points.copy()


def _upright_rotation(head_axis: np.ndarray | None) -> int:
    """The rotation that puts the head on top, from a shoulder-minus-hip vector."""
    if head_axis is None or abs(head_axis[0]) <= abs(head_axis[1]):
        return ROTATE_NONE
    return ROTATE_CW if head_axis[0] < 0 else ROTATE_CCW


def _detect_upright(
    cv2: Any,
    detector: Any,
    frame: np.ndarray,
    head_axis: np.ndarray | None,
) -> tuple[np.ndarray | None, np.ndarray | None, int]:
    """Detect with the subject turned upright; returns keypoints in ORIGINAL coordinates."""
    height, width = frame.shape[:2]
    preferred = _upright_rotation(head_axis)
    order = [preferred] + [r for r in (ROTATE_NONE, ROTATE_CW, ROTATE_CCW) if r != preferred]

    best: tuple[np.ndarray | None, np.ndarray | None, int] = (None, None, ROTATE_NONE)
    best_score = -1.0
    for attempt, rotation in enumerate(order):
        keypoints, scores = detector(_rotate_frame(cv2, frame, rotation))
        if keypoints is not None and len(keypoints) > 0:
            quality = float(np.max(np.mean(scores, axis=1)))
            if quality > best_score:
                best_score = quality
                best = (_unrotate_keypoints(keypoints, rotation, width, height), scores, rotation)
        # Settled orientation: one inference, no extra cost.
        if attempt == 0 and best_score >= _ORIENT_RETRY_SCORE and head_axis is not None:
            break
    return best


def _fault_from_filename(stem: str) -> str:
    cleaned = re.sub(r"^\d+[\s.\-_]*", "", stem.lower())
    cleaned = re.sub(r"[^a-z0-9]+", "_", cleaned).strip("_")
    return cleaned or "compensation"


def _safe_name(value: object) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value)).strip("_")


def _best_result_per_test(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for result in results:
        if not isinstance(result.get("score"), int):
            best.setdefault(result["test"], result)
            continue
        current = best.get(result["test"])
        if current is None or result["score"] > (current.get("score") or -1):
            best[result["test"]] = result
    return list(best.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="FMS scoring pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list-tests", help="List supported FMS tests")

    dataset_parser = subparsers.add_parser("dataset", help="Analyze a Participant dataset folder")
    dataset_parser.add_argument("--dataset", type=Path, default=Path("Dataset") / "Participant-1")
    dataset_parser.add_argument("--output", type=Path, default=Path("fms_outputs"))
    dataset_parser.add_argument("--mode", default=MODE)
    dataset_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    dataset_parser.add_argument("--overwrite", action="store_true")
    dataset_parser.add_argument("--pose-only", action="store_true")
    dataset_parser.add_argument(
        "--hand-length-in",
        type=float,
        default=8.0,
        help="Hand length in inches for Shoulder Mobility scoring.",
    )
    dataset_parser.add_argument(
        "--shoulder-width-in",
        type=float,
        default=16.0,
        help="Estimated shoulder width in inches for pixel-to-inch calibration.",
    )
    dataset_parser.add_argument(
        "--no-live",
        action="store_true",
        help="Disable the OpenCV live tracking window.",
    )
    dataset_parser.add_argument(
        "--no-plot-window",
        action="store_true",
        help="Save the matplotlib plot without opening the plot window.",
    )

    video_parser = subparsers.add_parser("video", help="Analyze one video")
    video_parser.add_argument("--source", type=Path, required=True)
    video_parser.add_argument("--test", required=True)
    video_parser.add_argument("--output", type=Path, default=Path("fms_outputs"))
    video_parser.add_argument("--mode", default=MODE)
    video_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    video_parser.add_argument("--overwrite", action="store_true")
    video_parser.add_argument("--pain", action="store_true")
    video_parser.add_argument(
        "--hand-length-in",
        type=float,
        default=8.0,
        help="Hand length in inches for Shoulder Mobility scoring.",
    )
    video_parser.add_argument(
        "--shoulder-width-in",
        type=float,
        default=16.0,
        help="Estimated shoulder width in inches for pixel-to-inch calibration.",
    )
    video_parser.add_argument(
        "--no-live",
        action="store_true",
        help="Disable the OpenCV live tracking window.",
    )
    video_parser.add_argument(
        "--no-plot-window",
        action="store_true",
        help="Save the matplotlib plot without opening the plot window.",
    )

    args = parser.parse_args()

    if args.command == "list-tests":
        for test_id, info in FMS_TESTS.items():
            marker = "automated" if info["automated"] else "manual/pending"
            print(f"{test_id:28} {info['name']} ({marker})")
        return

    if args.command == "dataset":
        analyze_dataset(
            args.dataset,
            args.output,
            mode=args.mode,
            device=args.device,
            overwrite=args.overwrite,
            pose_only=args.pose_only,
            live=not args.no_live,
            show_plot=not args.no_plot_window,
            hand_length_in=args.hand_length_in,
            shoulder_width_in=args.shoulder_width_in,
        )
        return

    test_id = normalize_test_name(args.test)
    if test_id is None:
        raise SystemExit(f"Unknown FMS test: {args.test}")
    analyze_single_video(
        args.source,
        test_id,
        args.output,
        mode=args.mode,
        device=args.device,
        overwrite=args.overwrite,
        pain=args.pain,
        live=not args.no_live,
        show_plot=not args.no_plot_window,
        hand_length_in=args.hand_length_in,
        shoulder_width_in=args.shoulder_width_in,
    )


if __name__ == "__main__":
    main()
