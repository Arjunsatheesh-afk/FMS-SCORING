"""Render a skeleton-overlay copy of a screening video.

The pose is NOT re-detected: keypoints and scores are read back from the
tracked JSON that extract_video_pose already wrote, so this pass is decode ->
draw -> encode only. On a 729-frame 1080p clip that is ~6s, against ~50s for
the extraction itself.

Encoding goes through the ffmpeg binary bundled with imageio-ffmpeg rather
than cv2.VideoWriter. OpenCV's writer exposes no bitrate or quality control
and defaults to near-lossless: the same clip came out at 178 MB from a 31 MB
source. With -crf the output lands near the source size instead.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

SCORE_THR = 0.3
MAX_HEIGHT = 720
# Sources here are 60 fps. Halving to 30 costs nothing for reviewing movement
# quality and takes roughly another 45% off the file.
HALVE_FPS_ABOVE = 50.0
CRF = "23"
PRESET = "veryfast"


def _even(value: int) -> int:
    """yuv420p requires even dimensions."""
    return value if value % 2 == 0 else value - 1


def render_annotated_video(
    video_path: Path,
    tracked_json: Path,
    output_path: Path,
    *,
    max_height: int = MAX_HEIGHT,
    halve_fps: bool = True,
    crf: str = CRF,
) -> dict[str, Any]:
    """Draw the tracked skeleton over the source video. Returns render stats."""
    import cv2
    import imageio_ffmpeg
    from rtmlib import draw_skeleton

    data = json.loads(Path(tracked_json).read_text(encoding="utf-8"))
    tracks = data.get("tracks", {})
    if not tracks:
        raise ValueError("tracked JSON has no tracks")
    track = max(tracks.values(), key=len)
    by_frame = {int(item["frame"]): item for item in track}

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open source video: {video_path}")

    src_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

    step = 2 if (halve_fps and src_fps >= HALVE_FPS_ABOVE) else 1
    out_fps = src_fps / step

    scale = min(1.0, max_height / src_h) if src_h > max_height else 1.0
    out_w = _even(int(round(src_w * scale)))
    out_h = _even(int(round(src_h * scale)))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = imageio_ffmpeg.write_frames(
        str(output_path),
        (out_w, out_h),
        fps=out_fps,
        codec="libx264",
        quality=None,
        macro_block_size=1,
        # pix_fmt_out already defaults to yuv420p, which is what browsers and
        # mobile players need; passing -pix_fmt again here only duplicates it.
        output_params=[
            "-crf", crf,
            "-preset", PRESET,
            # Puts the moov atom first so the file streams without a full download.
            "-movflags", "+faststart",
        ],
    )
    writer.send(None)

    index = written = drawn = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            if index % step == 0:
                item = by_frame.get(index)
                if item is not None:
                    keypoints = np.asarray([item["keypoints"]], dtype=float)
                    scores = np.asarray([item["scores"]], dtype=float)
                    frame = draw_skeleton(
                        frame, keypoints, scores, openpose_skeleton=False, kpt_thr=SCORE_THR
                    )
                    drawn += 1

                if scale != 1.0:
                    frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)
                elif frame.shape[1] != out_w or frame.shape[0] != out_h:
                    frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)

                writer.send(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).tobytes())
                written += 1

            index += 1
    finally:
        capture.release()
        writer.close()

    return {
        "path": str(output_path),
        "width": out_w,
        "height": out_h,
        "fps": round(out_fps, 2),
        "framesRead": index,
        "framesWritten": written,
        "framesWithSkeleton": drawn,
        "sizeBytes": output_path.stat().st_size if output_path.exists() else 0,
    }
