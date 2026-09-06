# Physiotherapy Exercise Classifier

A comprehensive machine learning system for tracking, analyzing, and classifying physiotherapy exercises in real-time using pose estimation and ML models.

## Project Overview

This project implements an intelligent physiotherapy exercise monitoring system that uses computer vision and machine learning to:
- Track body poses during exercises using RTMPose
- Extract joint angles and movement patterns
- Train machine learning models to classify correct vs. incorrect exercise execution
- Provide real-time feedback on exercise correctness during live video or webcam input

> **Note:** the project has since moved to rule-based Functional Movement Screen
> scoring — see the FMS sections below (`fms_pipeline.py`, `fms_scoring.py`,
> `run_all_samples.py`, and the FastAPI server). The correct/incorrect
> classification pipeline described immediately below is historical and
> superseded; `analysis_server.py` no longer uses those trained models.

## System Architecture

The project follows a three-stage pipeline:

```
Data Collection → Model Training → Real-time Classification
      ↓                ↓                    ↓
   tp1_cds.py    train_models.py    realtime_classifier.py
```

## Installation

### Prerequisites
- Python 3.8 or higher
- pip or conda package manager

### Setup

1. Clone or download the project:
```bash
cd PhysiotherapyProject
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Pipeline Overview

### Stage 1: Data Collection & Pose Tracking (`tp1_cds.py`)

This script captures video of exercises and extracts joint angle data using RTMPose.

**Purpose:**
- Record pose tracking data from exercise videos
- Calculate joint angles at 8 key joints (knees, hips, elbows, shoulders)
- Generate JSON files containing timestamped angle measurements for each frame

**Output:**
- JSON files stored in `tracked_data/<exercise_name>/` directory
- Each file contains frame-by-frame angle measurements for the exercise

**Usage:**
```bash
# Find first video in data/bicep_curl/ directory
python tp1_cds.py --exercise bicep_curl

# Use specific video file
python tp1_cds.py --exercise squats --video video.mp4

# Specify RTMPose mode (balanced/lite/heavy)
python tp1_cds.py --exercise bicep_curl --mode balanced

# Save annotated video output
python tp1_cds.py --exercise bicep_curl --save-video
```

**Key Features:**
- Automatic pose detection and tracking
- Joint angle computation (8 angles per person)
- EMA smoothing for stable angle values
- Confidence scoring for keypoint detection
- Optional video annotation showing skeleton and angles

---

### Stage 2: Model Training (`train_models.py`)

This script trains machine learning models to classify exercise correctness.

**Purpose:**
- Load collected exercise data from JSON files
- Extract features from angle measurements
- Train two classification models:
  - Random Forest Classifier
  - XGBoost Classifier
- Evaluate model performance and save trained models

**Output:**
- Trained model files (.pkl) in `tracking_models/<exercise_name>/`
- Feature importance rankings
- Training metrics and confusion matrices
- Feature info JSON with model metadata

**Usage:**
```bash
python train_models.py
```

**Data Organization:**
The script automatically discovers exercises in `tracked_data/` with the following structure:
```
tracked_data/
├── bicep_curl/
│   ├── video1_correct.json
│   ├── video2_incorrect.json
│   └── ...
└── squats/
    ├── squat1_c1.json
    ├── squat2_incorrect.json
    └── ...
```

**Naming Convention:**
- Files containing "correct" or "c1" → labeled as 1 (correct exercise)
- All other files → labeled as 0 (incorrect exercise)

**Training Process:**
1. Discover all exercise folders in tracked_data
2. Extract angle features from JSON files
3. Handle missing values via median imputation
4. Split data into 80% training / 20% testing sets
5. Train Random Forest and XGBoost models
6. Generate performance reports with accuracy and confusion matrices
7. Save models for real-time classification

---

### Stage 3: Real-time Classification (`realtime_classifier.py`)

This script provides live exercise classification and feedback.

**Purpose:**
- Load trained ML models for specific exercises
- Capture video from webcam or video file
- Extract poses and angles in real-time
- Classify exercise correctness frame-by-frame
- Display visual feedback and statistics

**Output:**
- Real-time video overlay with:
  - Skeleton visualization
  - Joint angles
  - Classification results (CORRECT/INCORRECT)
  - Confidence scores
  - Running statistics

**Usage:**
```bash
# Use webcam input
python realtime_classifier.py --exercise bicep_curl

# Use video file
python realtime_classifier.py --exercise squats --source video.mp4

# Specify model (random_forest or xgboost)
python realtime_classifier.py --exercise bicep_curl --model xgboost

# List available exercises
python realtime_classifier.py --list-exercises
```

**Controls:**
- `q` or `Esc` - Quit application
- `r` - Reset statistics counter

**Features:**
- Real-time pose detection and tracking
- Windowed classification (averages predictions over frames)
- Confidence thresholding for reliable predictions
- Live statistics tracking:
  - Total frames analyzed
  - Correct/Incorrect counts
  - Accuracy percentage

---

## Project Structure

```
PhysiotherapyProject/
├── tp1_cds.py                      # Stage 1: Data collection & tracking
├── train_models.py                 # Stage 2: Model training
├── realtime_classifier.py          # Stage 3: Real-time classification
├── requirements.txt                # Python dependencies
├── README.md                       # This file
│
├── data/                           # Input video files
│   ├── bicep_curl/
│   ├── squats/
│   └── ...
│
├── tracked_data/                   # Output from Stage 1
│   ├── bicep_curl/
│   │   ├── video1_tracked.json
│   │   └── ...
│   └── squats/
│       └── ...
│
└── tracking_models/                # Output from Stage 2
    ├── bicep_curl/
    │   ├── random_forest_model.pkl
    │   ├── xgboost_model.pkl
    │   └── feature_info.json
    └── squats/
        └── ...
```

## Features Extracted

The system tracks 8 joint angles per person:

1. **Left Knee Angle** - Angle at left knee joint
2. **Right Knee Angle** - Angle at right knee joint
3. **Left Hip Angle** - Angle at left hip joint
4. **Right Hip Angle** - Angle at right hip joint
5. **Left Elbow Angle** - Angle at left elbow joint
6. **Right Elbow Angle** - Angle at right elbow joint
7. **Left Shoulder Angle** - Angle at left shoulder joint
8. **Right Shoulder Angle** - Angle at right shoulder joint

These angles are computed using COCO-17 pose keypoints from RTMPose.

## Configuration Parameters

### RTMPose Settings
- **MODE**: Pose detection model mode (`balanced`, `lite`, or `heavy`)
- **SCORE_THR**: Keypoint confidence threshold (default: 0.3)

### Smoothing Parameters
- **KP_ALPHA**: EMA weight for keypoint smoothing (0-1, higher = smoother)
- **ANG_ALPHA**: EMA weight for angle smoothing (0-1, higher = smoother)

### Classification Settings
- **WINDOW_SIZE**: Number of frames to average for predictions (default: 10)
- **CONFIDENCE_THRESHOLD**: Minimum confidence for displaying predictions (default: 0.6)

## Model Performance

The system trains two complementary models:

### Random Forest Classifier
- Interpretable decision trees
- Feature importance analysis
- Good for capturing non-linear patterns
- Robust to outliers

### XGBoost Classifier
- Gradient boosting ensemble
- Often achieves higher accuracy
- Fast inference
- Excellent generalization

Both models are trained and evaluated, with detailed metrics provided.

## Dependencies

---

## FMS Scoring Pipeline

This repository also includes a Functional Movement Screen pipeline that runs
beside the original binary correct/incorrect classifier.

```bash
# Show supported FMS tests
python fms_pipeline.py list-tests

# Analyze the provided participant dataset
python fms_pipeline.py dataset --dataset Dataset/Participant-1 --overwrite

# Analyze one video as a specific FMS screen
python fms_pipeline.py video --test deep_squat --source path/to/video.mp4 --overwrite
```

The FMS pipeline writes pose JSON and reports under `fms_outputs/`:

```text
fms_outputs/
├── tracked/                 # Keypoints, confidence scores, and angles per video
└── reports/
    └── fms_dataset_report.json
```

During pose extraction, the pipeline opens an OpenCV live tracking window with
the detected skeleton and frame progress. Press `q` or `Esc` to stop the current
video. If a tracked JSON already exists, the pipeline reuses it; pass
`--overwrite` when you want to re-run the video and see live tracking again.

After scoring, the JSON report keeps the same structure and a matplotlib score
chart is saved locally in the reports folder. The plot window opens by default;
use `--no-plot-window` to save the PNG without displaying it. Use `--no-live`
for runs where you do not want the OpenCV window.

The automated scorer currently supports:

1. Deep Squat
2. Hurdle Step
3. Inline Lunge
4. Active Straight-Leg Raise
5. Trunk Stability Push-Up
6. Shoulder Mobility
7. Rotatory Stability

Shoulder Mobility uses wrist-to-wrist distance as the camera proxy for the
closest fist-to-fist distance. The default hand length is `8` inches, matching
the current participant measurement. The default shoulder-width calibration is
`16` inches. Override these if needed:

```bash
python fms_pipeline.py video --test shoulder_mobility --source path/to/video.mp4 --hand-length-in 8 --shoulder-width-in 16
```

Each movement video produces one attempt-level result:

```json
{
  "test": "deep_squat",
  "score": 2,
  "maxScore": 3,
  "faults": ["trunk_leans_forward"],
  "confidence": 0.84,
  "measurements": {}
}
```

FMS scoring is attempt-based rather than frame-based. The pipeline collects the
full movement, selects the most relevant phase of the attempt, and then applies
a transparent rule set to assign `0`, `1`, `2`, or `3`. A pain flag always
forces a score of `0`; visual pose alone cannot infer pain.

### Batch scoring a whole dataset (`run_all_samples.py`)

`run_all_samples.py` walks every `Sample N` folder in `Dataset/` and its seven
exercise subfolders, runs pose extraction and FMS scoring on each video, and
combines the results into a single report.

```bash
# List what would be processed without running the detector
python run_all_samples.py --discover-only

# Score everything on the GPU
python run_all_samples.py --device cuda

# Useful subsets
python run_all_samples.py --limit 3            # first N videos
python run_all_samples.py --samples 2,16       # specific samples
python run_all_samples.py --tests deep_squat   # specific tests
```

Tracked pose data is written to `fms_outputs/tracked/<test_id>/Sample-N.json`
and the combined report to `fms_outputs/reports/all_samples_report.json`. Runs
are resumable: an existing tracked JSON is reused instead of re-extracted, so a
re-run only pays for videos it has not seen. Pass `--overwrite` to force
re-extraction.

Folder names are mapped to test ids with `normalize_test_name`, plus a small
repair step for dataset-specific spellings (`ROTATORY STABILITY`,
`Incline Lunge`, `Straight Leg Rise`) that would otherwise fail to match.

### Known limitation: prototype-only default passwords

Every account is created with the password `<mobile number>.physio` (for
example `9876543210.physio`), set at account creation for both doctor and
patient accounts, and there is no forced change on first login. **Anyone who
knows a user's mobile number can sign in as them until that user changes their
password.** Both profile screens offer a change-password form, and the
server requires the current password before allowing the change.

This is a deliberate prototype shortcut: it lets a doctor register a patient
and tell them their password without needing an email or SMS delivery channel.
It must not survive into anything handling real patient data. The same applies
to the rest of the auth stack - plain HTTP with no TLS, tokens held in
unencrypted `AsyncStorage`, an unencrypted SQLite file, and PBKDF2 rather than
argon2/bcrypt for password hashing. See the module docstring in
`auth_store.py`.

### Camera angle: fixed metrics, and two tests that stay provisional

The camera-geometry problem previously documented here is fixed as of commit
`2a59c37`. Three metrics were rewritten to be robust to the angle the video was
shot from: transverse-width normalisation (which collapses to near zero when
the subject is filmed side-on) was replaced with longitudinal normalisation,
and axis-aligned angle math was replaced with rotation-invariant ratios. See
`fms_scoring.py` for the current definitions.

Some checks could not be fixed, only removed. Valgus and pelvic/shoulder
obliquity are frontal-plane quantities: filmed from the side, the axis they are
measured along points at the camera, so the compensation is confounded with
rotation rather than merely noisy. No 2D formula recovers it. Those checks were
dropped for the tests filmed sagittally, and each dropped check is listed in
`measurements.notAssessed` in the scoring output, with the reasoning in the
commit message for `2a59c37`.

As a result **inline lunge and rotatory stability retain fewer checks than the
FMS defines**, so most attempts now pass what remains and their scores read high.
Treat those two as provisional until frontal-camera footage or 3D pose
estimation is available; they are not clinically meaningful as they stand.

**Deep squat, hurdle step, and shoulder mobility do not have this limitation** —
they are filmed frontally, keep their full set of checks, and their scores can
be read normally.

Because tracked pose JSON is cached, re-scoring after any further rules change
costs seconds per video rather than a full re-extraction. The scripts in
`analysis/` reproduce the camera-view classification, the metric distributions,
and the threshold sweeps that these decisions were based on.

Core dependencies managed via `requirements.txt`:
- **opencv-python**: Video processing and display
- **numpy**: Numerical computations
- **pandas**: Data manipulation and analysis
- **scikit-learn**: ML utilities and Random Forest
- **xgboost**: XGBoost classifier
- **joblib**: Model serialization
- **rtmlib**: RTMPose pose estimation

## Workflow Example

### Complete Workflow

1. **Collect Training Data:**
   ```bash
   # Record videos in data/bicep_curl/
   python tp1_cds.py --exercise bicep_curl --save-video
   ```
   → Creates `tracked_data/bicep_curl/*.json`

2. **Train Models:**
   ```bash
   python train_models.py
   ```
   → Creates `tracking_models/bicep_curl/{random_forest,xgboost}_model.pkl`

3. **Test in Real-time:**
   ```bash
   python realtime_classifier.py --exercise bicep_curl
   ```
   → Shows live classification results with feedback

---

## Mobile App + API Architecture

This repository now includes a client-server integration so the phone app records/uploads a clip and the Python server performs pose tracking and ML analysis.

### Components

1. **Mobile client (Expo / React Native)**
   - Location: `PhysioTracking/`
   - Key flows:
     - Pick one of the seven FMS tests
     - Record exercise video in app using camera
     - Upload recorded or gallery video
     - Poll job progress while server analyzes
     - View the `0`-`3` score, the faults that drove it, and the measurements

2. **Analysis server (FastAPI)**
   - Entry point: `analysis_server.py`
   - Endpoints:
     - `GET /health`
     - `GET /exercises` (the seven FMS tests: `id`, `name`, `maxScore`, `automated`)
     - `POST /analysis/jobs` (multipart video upload)
     - `GET /analysis/jobs/{job_id}` (poll status/result)
   - Runs `extract_video_pose` then `FMSScorer` via `fms_pipeline.py` /
     `fms_scoring.py`. It no longer uses the `tracking_models/` classifiers.

`POST /analysis/jobs` form fields:

| field | required | meaning |
| --- | --- | --- |
| `file` | yes | the movement video |
| `exercise` | yes | FMS test id, e.g. `deep_squat` (aliases such as `deep squat` also resolve) |
| `pain` | no | self-reported pain; forces a score of `0` |
| `hand_length_in` | no | Shoulder Mobility calibration (default `8`) |
| `shoulder_width_in` | no | pixel-to-inch calibration (default `16`) |

Valid test ids: `deep_squat`, `hurdle_step`, `inline_lunge`,
`shoulder_mobility`, `active_straight_leg_raise`, `trunk_stability_pushup`,
`rotary_stability`.

### End-to-end flow

1. Mobile app uploads a video plus the selected FMS `test_id`.
2. Server creates a background job and returns `job_id`.
3. Mobile app polls the job endpoint every ~1.5s (`status`, `progress`).
4. Server extracts pose for every frame, then scores the attempt.
5. When complete, the job `result` is the `FMSScorer` output:
   - `score` (`0`-`3`, or `null` when the attempt could not be scored)
   - `faults` (rule ids that fired, e.g. `knees_inward_valgus`)
   - `measurements` (per-test values, including `scoredFrame`)
   - `confidence`, `status`, and video metadata

```json
{
  "test": "deep_squat",
  "testName": "Deep Squat",
  "score": 2,
  "maxScore": 3,
  "faults": ["knees_outward_varus"],
  "measurements": {
    "kneeAngle": 80.28,
    "hipAngle": 95.22,
    "trunkLeanDeg": 0.56,
    "scoredFrame": 656
  },
  "confidence": 0.824,
  "status": "scored"
}
```

### Run the analysis server

```bash
cd /home/user/Exercise_Tracking_and_Analysis
pip install -r requirements.txt
python analysis_server.py
```

Server default URL: `http://0.0.0.0:8000`

### Run the mobile app

```bash
cd /home/user/Exercise_Tracking_and_Analysis/PhysioTracking
npm install
npx expo start
```

Set API URL for your device before launching app:

```bash
export EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8000
```

Notes:
- Android emulator default fallback is `http://10.0.2.2:8000`
- iOS simulator/web default fallback is `http://127.0.0.1:8000`

---

## Reference

The background paper is not vendored in this repository. It is Nature
Communications article `s41467-020-17807-z`, available at:

- https://doi.org/10.1038/s41467-020-17807-z
- https://www.nature.com/articles/s41467-020-17807-z
