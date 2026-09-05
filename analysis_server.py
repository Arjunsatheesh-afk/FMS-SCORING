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

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import auth_store
from annotate_video import render_annotated_video
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
ANNOTATED_DIR = OUTPUT_DIR / "annotated"
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
    patient_id: int,
    uploaded_by: int,
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

        # Skeleton overlay. Deliberately after scoring and non-fatal: a failed
        # render must not cost the doctor the screening result itself, so the
        # field is simply absent and the job still completes.
        try:
            _set_job(job_id, progress=0.97)
            render_stats = render_annotated_video(
                video_path, tracked_json, ANNOTATED_DIR / f"{job_id}.mp4"
            )
            summary["annotatedVideo"] = {
                "url": f"/results/{job_id}/video",
                "width": render_stats["width"],
                "height": render_stats["height"],
                "fps": render_stats["fps"],
                "sizeBytes": render_stats["sizeBytes"],
            }
        except Exception as exc:  # pragma: no cover - render failure path
            summary["annotatedVideoError"] = f"{type(exc).__name__}: {exc}"

        # Persist only completed jobs: a crashed extraction is not a finding.
        try:
            auth_store.save_result(
                patient_id=patient_id,
                uploaded_by=uploaded_by,
                job_id=job_id,
                test_id=test_id,
                result=summary,
            )
        except Exception as exc:  # pragma: no cover - storage failure path
            # The analysis itself succeeded; surface the storage failure without
            # discarding the result the client is already polling for.
            _set_job(job_id, storageError=str(exc))

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


auth_store.init_db()


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


class RegisterPatientRequest(BaseModel):
    email: str
    displayName: str
    phoneNumber: str
    # Optional: omit to use the prototype default of "<phone>.physio".
    password: str | None = None


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return authorization.split(" ", 1)[1].strip()


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = auth_store.user_for_token(_bearer_token(authorization))
    if user is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user


def current_doctor(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Doctor account required")
    return user


@app.post("/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    user = auth_store.verify_credentials(payload.email, payload.password)
    if user is None:
        # Deliberately identical for unknown email and wrong password so the
        # response does not reveal which addresses have accounts.
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"token": auth_store.create_token(user["id"]), "user": user}


@app.post("/auth/logout")
def logout(authorization: str | None = Header(default=None)) -> dict[str, str]:
    auth_store.delete_token(_bearer_token(authorization))
    return {"status": "signed_out"}


@app.get("/auth/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": user}


@app.post("/auth/change-password")
def change_password(
    payload: ChangePasswordRequest,
    authorization: str | None = Header(default=None),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    try:
        auth_store.change_password(
            user["id"],
            payload.currentPassword,
            payload.newPassword,
            keep_token=_bearer_token(authorization),
        )
    except auth_store.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "password_changed"}


@app.post("/patients")
def register_patient(
    payload: RegisterPatientRequest,
    doctor: dict[str, Any] = Depends(current_doctor),
) -> dict[str, Any]:
    try:
        patient = auth_store.create_user(
            email=payload.email,
            role="patient",
            display_name=payload.displayName,
            phone_number=payload.phoneNumber,
            password=payload.password,
            created_by=doctor["id"],
        )
    except auth_store.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"patient": patient}


@app.get("/patients")
def list_patients(doctor: dict[str, Any] = Depends(current_doctor)) -> dict[str, Any]:
    return {"patients": auth_store.list_patients_for_doctor(doctor["id"])}


@app.get("/results/{job_id}/video")
def annotated_video(
    job_id: str,
    doctor: dict[str, Any] = Depends(current_doctor),
) -> FileResponse:
    """Serve the skeleton-overlay video for one screening.

    This is patient footage, so it is gated exactly like the results endpoints:
    doctor role, and the screening must belong to one of *their* patients. A
    job id alone must never be enough to fetch a video.
    """
    stored = auth_store.result_for_job(job_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Screening not found")
    if auth_store.patient_of_doctor(doctor["id"], stored["patientId"]) is None:
        raise HTTPException(status_code=403, detail="Not one of your patients")

    path = ANNOTATED_DIR / f"{job_id}.mp4"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No annotated video for this screening")

    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{job_id}.mp4",
        # Byte ranges let a player seek without pulling the whole file.
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/me/results")
def my_results(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"results": auth_store.results_for_patient(user["id"])}


@app.get("/patients/{patient_id}/results")
def patient_results(
    patient_id: int,
    doctor: dict[str, Any] = Depends(current_doctor),
) -> dict[str, Any]:
    patient = auth_store.patient_of_doctor(doctor["id"], patient_id)
    if patient is None:
        raise HTTPException(status_code=403, detail="Not one of your patients")
    return {"patient": patient, "results": auth_store.results_for_patient(patient_id)}


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
    patient_id: int | None = Form(default=None),
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    # Uploads are doctor-only in this prototype. Patients cannot submit a
    # screening at all - not for themselves, not with patient_id omitted. The
    # role check comes first so a patient is rejected identically whatever they
    # send, rather than falling through to the ownership checks below.
    if user["role"] != "doctor":
        raise HTTPException(
            status_code=403, detail="Only a doctor can record a screening"
        )

    # A doctor must name one of their own patients. Without the ownership check
    # any doctor could write results into any patient's record by guessing an id.
    if patient_id is None:
        raise HTTPException(status_code=400, detail="patient_id is required when a doctor uploads")
    target_patient = auth_store.patient_of_doctor(user["id"], patient_id)
    if target_patient is None:
        raise HTTPException(status_code=403, detail="Not one of your patients")

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
            "patientId": target_patient["id"],
            "patientName": target_patient["displayName"],
            "uploadedBy": user["id"],
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
            "patient_id": target_patient["id"],
            "uploaded_by": user["id"],
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
