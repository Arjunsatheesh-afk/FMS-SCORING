"""FastAPI server for mobile-to-FMS movement screen analysis.

This server accepts uploaded movement videos, runs RTMPose tracking followed by
rule-based Functional Movement Screen scoring, and exposes job status APIs for
client polling.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from fms_pipeline import (
    _looks_like_cuda_runtime_failure,
    build_detector,
    extract_video_pose,
    score_tracked_file,
)
from fms_scoring import FMS_TESTS, normalize_test_name

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = Path(os.getenv("PHYSIO_FMS_OUTPUT_DIR", str(SCRIPT_DIR / "fms_outputs" / "api")))
TRACKED_DIR = OUTPUT_DIR / "tracked"
POSE_MODE = os.getenv("PHYSIO_POSE_MODE", "balanced")
PREFERRED_DEVICE = os.getenv("PHYSIO_DEVICE", "cuda")
DEFAULT_HAND_LENGTH_IN = float(os.getenv("PHYSIO_HAND_LENGTH_IN", "8.0"))
DEFAULT_SHOULDER_WIDTH_IN = float(os.getenv("PHYSIO_SHOULDER_WIDTH_IN", "16.0"))

# Pose extraction dominates runtime, so it owns most of the progress range.
POSE_PROGRESS_START = 0.05
POSE_PROGRESS_END = 0.9

app = FastAPI(title="Physio FMS API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_job(job_id: str, **updates: Any) -> None:
    with _jobs_lock:
        if job_id not in _jobs:
            return
        _jobs[job_id].update(updates)
        _jobs[job_id]["updatedAt"] = _utc_now()


def _tracked_metadata(tracked_json: Path) -> dict[str, Any]:
    try:
        with open(tracked_json, "r", encoding="utf-8") as handle:
            metadata = json.load(handle).get("metadata", {})
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        "fps": metadata.get("fps"),
        "totalFrames": metadata.get("total_frames"),
        "framesProcessed": metadata.get("frames_processed"),
        "width": metadata.get("width"),
        "height": metadata.get("height"),
    }


def _analyze_video_job(
    job_id: str,
    test_id: str,
    video_path: Path,
    *,
    source_name: str,
    pain: bool,
    hand_length_in: float,
    shoulder_width_in: float,
) -> None:
    tracked_json = TRACKED_DIR / test_id / f"{job_id}.json"
    try:
        _set_job(job_id, status="running", progress=POSE_PROGRESS_START)

        def report_progress(frame_index: int, total_frames: int) -> None:
            if total_frames <= 0 or frame_index % 3:
                return
            fraction = min(1.0, frame_index / total_frames)
            span = POSE_PROGRESS_END - POSE_PROGRESS_START
            _set_job(job_id, progress=round(POSE_PROGRESS_START + fraction * span, 4))

        detector, detector_device = build_detector(
            mode=POSE_MODE, preferred_device=PREFERRED_DEVICE
        )
        try:
            extract_video_pose(
                video_path,
                tracked_json,
                detector=detector,
                mode=POSE_MODE,
                device=detector_device,
                overwrite=True,
                live=False,
                progress_callback=report_progress,
            )
        except Exception as exc:
            if detector_device == "cpu" or not _looks_like_cuda_runtime_failure(exc):
                raise
            detector, detector_device = build_detector(mode=POSE_MODE, preferred_device="cpu")
            extract_video_pose(
                video_path,
                tracked_json,
                detector=detector,
                mode=POSE_MODE,
                device=detector_device,
                overwrite=True,
                live=False,
                progress_callback=report_progress,
            )

        _set_job(job_id, progress=POSE_PROGRESS_END)

        result = score_tracked_file(
            tracked_json,
            test_id,
            pain=pain,
            hand_length_in=hand_length_in,
            shoulder_width_in=shoulder_width_in,
        )

        summary = result | {
            "source": source_name,
            "detectorMode": POSE_MODE,
            "detectorDevice": detector_device,
            "video": _tracked_metadata(tracked_json),
        }

        _set_job(job_id, status="completed", progress=1.0, result=summary)
    except Exception as exc:  # pragma: no cover - runtime failure path
        _set_job(
            job_id,
            status="failed",
            error={
                "message": str(exc),
                "trace": traceback.format_exc(limit=6),
            },
        )
    finally:
        try:
            video_path.unlink(missing_ok=True)
        except OSError:
            pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/exercises")
def list_exercises() -> dict[str, list[dict[str, Any]]]:
    exercises = [
        {
            "id": test_id,
            "name": info["name"],
            "maxScore": info["max_score"],
            "automated": info["automated"],
        }
        for test_id, info in FMS_TESTS.items()
    ]
    return {"exercises": exercises}


@app.post("/analysis/jobs")
async def create_analysis_job(
    exercise: str = Form(...),
    pain: bool = Form(False),
    hand_length_in: float = Form(DEFAULT_HAND_LENGTH_IN),
    shoulder_width_in: float = Form(DEFAULT_SHOULDER_WIDTH_IN),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    test_id = normalize_test_name(exercise)
    if test_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Unknown FMS test '{exercise}'",
                "availableExercises": list(FMS_TESTS),
            },
        )

    source_name = file.filename or "upload.mp4"
    suffix = Path(source_name).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    job_id = str(uuid.uuid4())
    created = _utc_now()
    with _jobs_lock:
        _jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "exercise": test_id,
            "testName": FMS_TESTS[test_id]["name"],
            "progress": 0.0,
            "createdAt": created,
            "updatedAt": created,
            "result": None,
            "error": None,
        }

    thread = threading.Thread(
        target=_analyze_video_job,
        args=(job_id, test_id, tmp_path),
        kwargs={
            "source_name": source_name,
            "pain": pain,
            "hand_length_in": hand_length_in,
            "shoulder_width_in": shoulder_width_in,
        },
        daemon=True,
    )
    thread.start()

    return _jobs[job_id]


@app.get("/analysis/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/analysis/jobs")
def list_jobs() -> dict[str, list[dict[str, Any]]]:
    with _jobs_lock:
        jobs = sorted(_jobs.values(), key=lambda item: item["createdAt"], reverse=True)
    return {"jobs": jobs}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("analysis_server:app", host="0.0.0.0", port=8000, reload=False)
