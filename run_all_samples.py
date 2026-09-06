"""Batch FMS scoring over the whole Dataset/ tree.

Walks every "Sample N" folder and its seven exercise subfolders, runs real
RTMPose extraction followed by rule-based FMS scoring on each video, and writes
one combined report.

Examples:
  python run_all_samples.py --dataset Dataset
  python run_all_samples.py --device cpu --limit 3        # quick smoke run
  python run_all_samples.py --samples 2,16 --overwrite
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fms_pipeline import (
    _looks_like_cuda_runtime_failure,
    build_detector,
    extract_video_pose,
    score_tracked_file,
)
from fms_scoring import FMS_TESTS, normalize_test_name

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}
SAMPLE_PATTERN = re.compile(r"^sample[\s_-]*(\d+)$", re.IGNORECASE)

# This dataset spells several tests differently from the aliases in FMS_TESTS
# ("Incline Lunge", "Straight Leg Rise"). These repairs are applied ONLY after
# normalize_test_name() has already failed on the raw folder name, so canonical
# names keep taking the normal path.
#
# The "rotatory" entry is now redundant - it is the department's official
# spelling and a canonical alias, so normalize_test_name() resolves it first.
# Kept because it costs nothing and still catches partial spellings.
NAME_REPAIRS = (
    ("rotatory", "rotary"),
    ("incline lunge", "inline lunge"),
    ("leg rise", "leg raise"),
)


@dataclass
class Sample:
    number: int
    name: str
    root: Path
    nested: bool


@dataclass
class Task:
    sample: Sample
    test_id: str
    folder: Path
    video: Path
    tracked_json: Path
    repaired_from: str | None


def resolve_test_id(folder_name: str) -> tuple[str | None, str | None]:
    """Map an exercise folder name to an FMS test id.

    Returns (test_id, repaired_name) where repaired_name is set only when the
    spelling had to be corrected before it would match.
    """
    test_id = normalize_test_name(folder_name)
    if test_id is not None:
        return test_id, None

    cleaned = re.sub(r"\s+", " ", folder_name.replace("_", " ")).strip().lower()
    for wrong, right in NAME_REPAIRS:
        cleaned = cleaned.replace(wrong, right)

    repaired = normalize_test_name(cleaned)
    return repaired, (cleaned if repaired is not None else None)


def discover_samples(dataset_dir: Path) -> list[Sample]:
    """Find every "Sample N" folder, unwrapping duplicate nesting if present."""
    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    samples: list[Sample] = []
    for path in sorted(dataset_dir.iterdir()):
        if not path.is_dir():
            continue
        match = SAMPLE_PATTERN.match(path.name.strip())
        if match is None:
            continue

        root = path
        nested = False
        # Sample 16 ships as Sample 16/Sample 16/<exercises>.
        while True:
            subdirs = [item for item in root.iterdir() if item.is_dir()]
            if len(subdirs) == 1 and SAMPLE_PATTERN.match(subdirs[0].name.strip()):
                root = subdirs[0]
                nested = True
                continue
            break

        samples.append(
            Sample(number=int(match.group(1)), name=path.name.strip(), root=root, nested=nested)
        )

    samples.sort(key=lambda sample: sample.number)
    return samples


def build_tasks(
    samples: list[Sample],
    tracked_root: Path,
) -> tuple[list[Task], list[dict[str, Any]]]:
    tasks: list[Task] = []
    skipped: list[dict[str, Any]] = []

    for sample in samples:
        seen_tests: dict[str, int] = defaultdict(int)
        for folder in sorted(item for item in sample.root.iterdir() if item.is_dir()):
            test_id, repaired = resolve_test_id(folder.name)
            if test_id is None:
                skipped.append(
                    {
                        "sampleId": sample.name,
                        "folder": folder.name,
                        "reason": "folder name did not map to an FMS test",
                    }
                )
                continue

            videos = sorted(
                item
                for item in folder.rglob("*")
                if item.is_file() and item.suffix.lower() in VIDEO_EXTENSIONS
            )
            if not videos:
                skipped.append(
                    {
                        "sampleId": sample.name,
                        "folder": folder.name,
                        "testId": test_id,
                        "reason": "no video file found",
                    }
                )
                continue
            if len(videos) > 1:
                print(
                    f"  ! {sample.name}/{folder.name}: {len(videos)} videos found, "
                    f"using {videos[0].name}"
                )

            seen_tests[test_id] += 1
            occurrence = seen_tests[test_id]
            stem = f"Sample-{sample.number}"
            if occurrence > 1:
                # Two folders in one sample mapped to the same test; keep both.
                stem = f"{stem}_{occurrence}"
                print(
                    f"  ! {sample.name}: duplicate {test_id} folder ({folder.name}), "
                    f"saving as {stem}.json"
                )

            tasks.append(
                Task(
                    sample=sample,
                    test_id=test_id,
                    folder=folder,
                    video=videos[0],
                    tracked_json=tracked_root / test_id / f"{stem}.json",
                    repaired_from=repaired,
                )
            )

    return tasks, skipped


def extract_with_fallback(
    task: Task,
    detector: Any,
    device: str,
    *,
    mode: str,
    overwrite: bool,
) -> tuple[Any, str]:
    """Run pose extraction, dropping to CPU if CUDA dies mid-video."""
    try:
        extract_video_pose(
            task.video,
            task.tracked_json,
            detector=detector,
            mode=mode,
            device=device,
            overwrite=overwrite,
            live=False,
        )
        return detector, device
    except Exception as exc:
        if device == "cpu" or not _looks_like_cuda_runtime_failure(exc):
            raise
        print("  ! CUDA inference failed; switching the rest of the run to CPU.")
        detector, device = build_detector(mode=mode, preferred_device="cpu")
        extract_video_pose(
            task.video,
            task.tracked_json,
            detector=detector,
            mode=mode,
            device=device,
            overwrite=True,
            live=False,
        )
        return detector, device


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    per_test: dict[str, dict[str, Any]] = {}
    for test_id, info in FMS_TESTS.items():
        entries = [item for item in results if item["test_id"] == test_id]
        scored = [item["score"] for item in entries if isinstance(item["score"], int)]
        distribution = {str(value): sum(1 for score in scored if score == value) for value in range(4)}
        per_test[test_id] = {
            "testName": info["name"],
            "videos": len(entries),
            "scoredVideos": len(scored),
            "unscored": len(entries) - len(scored),
            "averageScore": round(sum(scored) / len(scored), 2) if scored else None,
            "distribution": distribution,
        }

    all_scored = [item["score"] for item in results if isinstance(item["score"], int)]
    return {
        "perExercise": per_test,
        "overallAverageScore": round(sum(all_scored) / len(all_scored), 2) if all_scored else None,
        "totalScoredVideos": len(all_scored),
    }


def print_summary(summary: dict[str, Any], results: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    header = f"{'Exercise':<30}{'n':>4}{'avg':>7}{'0':>5}{'1':>5}{'2':>5}{'3':>5}{'n/a':>6}"
    print(header)
    print("-" * 78)
    for info in summary["perExercise"].values():
        distribution = info["distribution"]
        average = "  -  " if info["averageScore"] is None else f"{info['averageScore']:.2f}"
        print(
            f"{info['testName']:<30}{info['videos']:>4}{average:>7}"
            f"{distribution['0']:>5}{distribution['1']:>5}{distribution['2']:>5}"
            f"{distribution['3']:>5}{info['unscored']:>6}"
        )
    print("-" * 78)
    overall = summary["overallAverageScore"]
    print(
        f"{'ALL':<30}{len(results):>4}"
        f"{('  -  ' if overall is None else f'{overall:.2f}'):>7}"
        f"{'':>15}{'':>5}{sum(1 for r in results if not isinstance(r['score'], int)):>6}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run FMS scoring across every dataset sample")
    parser.add_argument("--dataset", type=Path, default=Path("Dataset"))
    parser.add_argument("--output", type=Path, default=Path("fms_outputs"))
    parser.add_argument("--mode", default="balanced")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-run pose extraction even when tracked JSON already exists.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Process at most N videos.")
    parser.add_argument("--samples", help="Comma-separated sample numbers, e.g. 1,2,16")
    parser.add_argument("--tests", help="Comma-separated test ids to include")
    parser.add_argument("--hand-length-in", type=float, default=8.0)
    parser.add_argument("--shoulder-width-in", type=float, default=16.0)
    parser.add_argument(
        "--discover-only",
        action="store_true",
        help="List what would be processed, then exit without running the detector.",
    )
    args = parser.parse_args()

    dataset_dir = args.dataset
    tracked_root = args.output / "tracked"
    reports_dir = args.output / "reports"
    report_path = reports_dir / "all_samples_report.json"

    samples = discover_samples(dataset_dir)
    print(f"Discovered {len(samples)} sample folders in {dataset_dir}:")
    for sample in samples:
        marker = "  (unwrapped nested folder)" if sample.nested else ""
        print(f"  - {sample.name}{marker}")
    if len(samples) != 18:
        print(f"  ! expected 18 sample folders, found {len(samples)}")

    tasks, skipped = build_tasks(samples, tracked_root)

    if args.samples:
        wanted = {int(value) for value in args.samples.split(",")}
        tasks = [task for task in tasks if task.sample.number in wanted]
    if args.tests:
        wanted_tests = {value.strip() for value in args.tests.split(",")}
        tasks = [task for task in tasks if task.test_id in wanted_tests]
    if args.limit is not None:
        tasks = tasks[: args.limit]

    repaired = [task for task in tasks if task.repaired_from]
    print(f"\n{len(tasks)} videos queued across {len({t.sample.number for t in tasks})} samples.")
    if repaired:
        print(f"{len(repaired)} folder names needed spelling repair before they mapped, e.g.:")
        for task in repaired[:3]:
            print(f"  - {task.folder.name!r} -> {task.repaired_from!r} -> {task.test_id}")
    if skipped:
        print(f"{len(skipped)} folders skipped:")
        for item in skipped:
            print(f"  - {item['sampleId']}/{item['folder']}: {item['reason']}")

    if args.discover_only:
        print("\n--discover-only: stopping before pose extraction.")
        return 0

    if not tasks:
        print("Nothing to process.")
        return 1

    reports_dir.mkdir(parents=True, exist_ok=True)
    detector, device = build_detector(mode=args.mode, preferred_device=args.device)
    print(f"\nDetector ready: mode={args.mode} device={device}\n")

    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    started = time.time()

    try:
        for index, task in enumerate(tasks, start=1):
            label = f"[{index:>3}/{len(tasks)}] {task.sample.name} / {FMS_TESTS[task.test_id]['name']}"
            print(f"{label:<58}", end="", flush=True)
            video_started = time.time()
            try:
                detector, device = extract_with_fallback(
                    task,
                    detector,
                    device,
                    mode=args.mode,
                    overwrite=args.overwrite,
                )
                result = score_tracked_file(
                    task.tracked_json,
                    task.test_id,
                    hand_length_in=args.hand_length_in,
                    shoulder_width_in=args.shoulder_width_in,
                )
            except Exception as exc:
                elapsed = time.time() - video_started
                print(f"FAILED  {type(exc).__name__}: {exc}  ({elapsed:.1f}s)")
                failures.append(
                    {
                        "sampleId": task.sample.name,
                        "test_id": task.test_id,
                        "video": str(task.video),
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
                continue

            elapsed = time.time() - video_started
            score = result.get("score")
            faults = result.get("faults") or []
            print(
                f"score={score if score is not None else '-'}  "
                f"faults={','.join(faults) if faults else '-'}  ({elapsed:.1f}s)"
            )

            results.append(
                {
                    "sampleId": task.sample.name,
                    "sampleNumber": task.sample.number,
                    "test_id": task.test_id,
                    "testName": result.get("testName"),
                    "score": score,
                    "maxScore": result.get("maxScore"),
                    "faults": faults,
                    "measurements": result.get("measurements", {}),
                    "confidence": result.get("confidence"),
                    "status": result.get("status"),
                    "sourceFolder": task.folder.name,
                    "video": str(task.video),
                    "trackedJson": str(task.tracked_json),
                    "elapsedSec": round(elapsed, 2),
                }
            )
    except KeyboardInterrupt:
        print("\n! Interrupted - writing a partial report for the videos completed so far.")

    summary = summarize(results)
    report = {
        "dataset": str(dataset_dir),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "device": device,
        "sampleCount": len(samples),
        "queuedVideos": len(tasks),
        "scoredVideos": len(results),
        "failedVideos": len(failures),
        "skippedFolders": len(skipped),
        "elapsedSec": round(time.time() - started, 1),
        "summary": summary,
        "results": results,
        "failures": failures,
        "skipped": skipped,
    }
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print_summary(summary, results)
    print(f"\nReport saved: {report_path}")
    print(f"Total time: {report['elapsedSec']}s")
    if failures:
        print(f"{len(failures)} videos failed; see 'failures' in the report.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
