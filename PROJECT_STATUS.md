# Project Status

**Last updated:** 6 September 2026
**Repo:** https://github.com/Arjunsatheesh-afk/FMS-SCORING.git
**Branch:** `master` — in sync with `origin/master`, HEAD `b1492ac`

This file is written for someone with **no prior context**. It covers what the system
does, every significant decision and why it was made, what has been validated and how,
and what is still open. If you are picking this up cold, read sections 1–3 and then jump
to section 12 (Open work).

---

## 1. What this project is

An automated **Functional Movement Screen (FMS)** scoring system. A physiotherapist
records a patient performing one of the seven standard FMS movements; the system
estimates the body's pose from the video, applies biomechanical rules to the most
demanding frame of the movement, and returns a 0–3 score plus the specific faults that
drove it. It also renders a skeleton-overlay video so the clinician can see what the
system saw.

Three parts:

| Part | Stack | Location |
|---|---|---|
| Pose + scoring pipeline | Python, RTMPose via rtmlib, ONNX Runtime (CUDA) | `fms_pipeline.py`, `fms_scoring.py` |
| API server | FastAPI + uvicorn, SQLite | `analysis_server.py`, `auth_store.py` |
| Mobile/web client | Expo SDK 56, React Native, expo-router v56 | `PhysioTracking/` |

**Important framing:** this is a working prototype validated against a 126-video
reference dataset. The scoring thresholds were derived from biomechanical reasoning and
tuned against that dataset — **they have not yet been signed off by the physiotherapy
department.** That review is the single biggest open item (section 12).

---

## 2. How to run it

### Environment

The Python environment lives in `.venv/` at the repo root (~6.2 GB, gitignored).

```bash
.venv/Scripts/python.exe analysis_server.py       # API on :8000
cd PhysioTracking && npm install && npx expo start --web --port 8085
```

**Do not rebuild the venv from `requirements.txt` on Windows without reading section 13
first.** It is a Linux freeze and several pins do not have Windows wheels.

### Currently running (as of this writing)

- Port **8000** — `analysis_server.py` (python, pid 11780)
- Port **8085** — Expo dev server (node, pid 8188)

### Test accounts

Seeded by `seed_accounts.py`. Passwords follow the project convention
`<phone number>.physio`:

| Role | Email | Password | Notes |
|---|---|---|---|
| Doctor | `priya.sharma@physio.example` | `9876543210.physio` | Created patients 2–4 |
| Patient | `ramesh.kumar@example.com` | `9123456780.physio` | 1 screening on file |
| Patient | `anita.rao@example.com` | `9988776655.physio` | 1 screening on file |
| Patient | `test.patient@example.com` | `9001112223.physio` | No screenings |

### Environment variables (all optional, defaults shown)

| Variable | Default | Purpose |
|---|---|---|
| `PHYSIO_DB_PATH` | `./physio.db` | SQLite accounts + results |
| `PHYSIO_FMS_OUTPUT_DIR` | `./fms_outputs/api` | Tracked JSON + annotated video |
| `PHYSIO_POSE_MODE` | `balanced` | rtmlib model size |
| `PHYSIO_DEVICE` | `cuda` | Falls back to CPU with a printed warning |
| `PHYSIO_HAND_LENGTH_IN` | `8.0` | Shoulder-mobility calibration default |
| `PHYSIO_SHOULDER_WIDTH_IN` | `16.0` | Shoulder-mobility calibration default |

---

## 3. Repository layout

106 tracked files. The parts that matter:

```
fms_scoring.py            The rule engine. All thresholds live here.
fms_pipeline.py           Pose extraction, detector construction, CUDA verification.
analysis_server.py        FastAPI app: auth, upload, job queue, results, video serving.
auth_store.py             SQLite: users, tokens, results. All SQL is here.
annotate_video.py         Skeleton-overlay renderer (reads cached keypoints, no detector).
run_all_samples.py        Batch runner over the Dataset/ folder tree.
seed_accounts.py          Creates the doctor + demo patients.
test_fms_scoring.py       13 tests, seven of which guard the threshold table
                          against the scoring code. See section 13.

analysis/                 Five throwaway-but-kept analysis scripts from the camera-angle
                          investigation (candidate_metrics.py, candidate_metrics2.py,
                          pass3.py, rescore.py, view_diagnosis.py). Kept as the record of
                          how the thresholds were derived.

fms_outputs/reports/all_samples_report.json   The validated 126-video run. Tracked in git
                          deliberately; the rest of fms_outputs/ is ignored (~351 MB).

PhysioTracking/src/       The Expo app (see section 11).
Dataset/                  126 reference videos. Gitignored — NOT in the repo.
```

**`.gitignore` shape worth knowing:** git will not re-include a file whose parent
directory is excluded, so the report is un-ignored level by level
(`fms_outputs/*`, then `!fms_outputs/reports/`, then `fms_outputs/reports/*`, then
`!fms_outputs/reports/all_samples_report.json`). If you add another file to keep, follow
the same pattern or it will silently stay ignored.

`physio.db` and `*.db` are gitignored — they contain real emails, phone numbers and
password hashes.

---

## 4. Git history

Twelve commits, all pushed:

| SHA | Commit |
|---|---|
| `b1492ac` | Add doctor FMS report, threshold sourcing, and overlay cleanup |
| `c2c0afb` | Add PROJECT_STATUS.md |
| `636a206` | Fix gallery upload on web, and stale screening list after recording |
| `0336a81` | Play auth-gated overlay videos on web via blob fetch |
| `55d1f91` | Add skeleton-overlay video for screenings |
| `46a29fa` | Track the validated 126-video FMS report |
| `65f557c` | Server-persist screening results; restrict recording to doctors |
| `f1bf95d` | Fix web render crash from module-scope expo-file-system call |
| `a4634d6` | Add email/password auth with doctor and patient roles |
| `61d300e` | Update README: camera-angle issue fixed, note provisional tests |
| `2a59c37` | Fix camera-angle dependence in FMS scoring metrics |
| `5f8e5ce` | Initial commit — camera-geometry threshold review pending |

Identifiers were scrubbed from the repo before the first push.

---

## 5. The scoring engine

### How a score is produced

1. Detect and track the person across all frames; store 17 COCO keypoints + confidences
   + eight precomputed joint angles per frame.
2. Discard frames whose mean confidence across shoulders/hips/knees/ankles is `< 0.45`.
   Individual keypoints below `0.30` are treated as missing.
3. If fewer than 5 usable frames remain, return **no score** (`insufficient_pose_data`).
   This is deliberately distinct from a low score.
4. Pick the **single most demanding frame** for that test (deepest squat, highest step,
   closest elbow-to-knee reach).
5. Run that test's fault checks against that frame.
6. Map to a score via `_score_from_faults`:

| Score | Condition |
|---|---|
| **0** | `pain=True` on the upload form. Clinician-set, not detected. Overrides everything. |
| **1** | The `complete` gate failed — a generous "did they attempt it at all" check. |
| **2** | Completed, but at least one fault fired. |
| **3** | Completed, no faults. |

Shoulder Mobility is the exception: it maps a measured distance directly to 1/2/3 and
does not use the `complete`/faults machinery.

### Where thresholds live

**Every threshold is a `Check` object in `THRESHOLDS` in `fms_scoring.py`**, and the
`_score_*` methods evaluate those same objects through `_fires()` and `_incomplete()`.
There is exactly one copy of each number, and `GET /fms/thresholds` serves it to the app,
so a report cannot show a threshold that differs from the one a screening was scored
against. Five tests guard that guarantee — see section 12. If the department signs off on
a different set, they are one-line edits to the table.

*(They were bare literals inside the scoring methods until 6 Sep 2026; the refactor was
verified score-neutral against all 126 cached videos.)*

A complete plain-language table of every threshold, what it measures, its camera-view
assumption and its clinical meaning is published here:

**https://claude.ai/code/artifact/551374e3-6392-47a2-8b5f-b8cf012fc534**

That document was written for the physiotherapy department and is the thing to send them.
It is private until shared from the page's share menu.

---

## 6. The camera-angle fix (the most important change in the project)

### The problem

A senior reviewer pointed out that FMS formulas should hold regardless of camera angle,
and that three functions did not. They were right. The failure mode was specific:

Three metrics normalised distances by a **transverse** width (hip-to-hip or
shoulder-to-shoulder). As the camera moves from front-on to side-on, a transverse width
foreshortens toward zero while the quantity being measured does not. Dividing by a
collapsing denominator inflated every ratio. Concretely, `_pair_tilt_deg` computed
`atan2(dy, dx)` and reported **86° "pelvis tilt"** on side-on footage purely because `dx`
had collapsed.

### What was changed

| Before | After | Reasoning |
|---|---|---|
| `_scale()` — transverse normaliser | **Deleted** | It was the root cause. |
| — | `_torso_length()` — shoulder-mid to hip-mid | The torso lies along the camera's vertical rotation axis, so it barely foreshortens as the subject turns. It is a stable denominator where a width is not. |
| `_pair_tilt_deg` = `atan2(dy, dx)` | `_pair_tilt_norm` = `abs(dy) / torso` | For a level camera orbiting the subject, rotation about vertical leaves the **vertical** component unchanged and foreshortens only the horizontal. Taking `dy` alone is azimuth-invariant. |
| `_max_knee_tracking_error` — knee x vs mean of hip/ankle x | `_knee_medial_offset` — true perpendicular distance to the hip→ankle line ÷ torso, signed medial-positive against the pelvis midline | The old version only coincided with the leg line when the leg was vertical in frame. The new one is invariant to in-plane rotation. Signing against the pelvis midline was necessary because raw image x gave **opposite signs for the same compensation** on left and right legs. |
| `_elbow_knee_distance_norm` — transverse normaliser | ÷ (shoulder→elbow + hip→knee) | Those are the two limb segments that actually close the gap, and both are longitudinal so they survive a sagittal view. The old normaliser inflated the ratio ~6× and fired the fault on **every** video. |

An intermediate candidate — normalising by femur length — was measured and **rejected**:
it correlated at r = −0.98 with knee flexion, so it moved with the very thing being
measured. Torso was chosen after measuring, not assumed.

### Threshold changes that followed

- Deep squat valgus: `> +0.10` (medial only).
- Deep squat **varus check dropped entirely.** 17 of 18 squats read lateral, so knees
  tracking outward is the normal baseline in this cohort, not a compensation. Any varus
  cut would have sliced the tail of that distribution at an arbitrary point.
- Hurdle step pelvis tilt `> 0.18`, knee rotation `> 0.30`.
- Rotary stability fail-to-touch `0.25 → 0.40`, complete gate `<= 0.60`. The 0.40 sits in
  an empty band: 16 of 18 attempts land at or below 0.284 and the two genuine misses at
  0.817. A tighter cut would have clipped the top of the successful cluster.

---

## 7. Checks that were dropped, and why

These were **not** dropped for being noisy. They are mathematically unrecoverable from a
single video filmed along the axis the movement happens in. No amount of tuning restores
them; a second camera or a change of filming angle would.

The camera view of each test was **measured, not assumed** — hip-width ÷ torso reads the
viewing azimuth directly, and the seven tests split cleanly with nothing in between:

| Test | hip/torso | shoulder/torso | View |
|---|---|---|---|
| Deep Squat | 0.42 | 0.67 | Frontal |
| Hurdle Step | 0.44 | 0.69 | Frontal |
| Shoulder Mobility | 0.42 | 0.68 | Frontal |
| Inline Lunge | 0.21 | 0.14 | Sagittal |
| Active Straight-Leg Raise | 0.11 | 0.19 | Sagittal |
| Trunk Stability Push-Up | 0.19 | 0.21 | Sagittal |
| Rotary Stability | 0.14 | 0.20 | Sagittal |

Dropped checks, recorded in each result's `measurements.notAssessed` and surfaced in the
app under *"Not assessed from this view"*:

| Test | Dropped | Why |
|---|---|---|
| Inline Lunge | `knee_alignment_compensation`, `balance_or_pelvis_shift` | Both frontal-plane quantities; test is filmed sagittally. |
| Active Straight-Leg Raise | `pelvis_lift_or_rotation` | Subject is supine and filmed from the side, so the pelvis L–R axis points at the camera. Obliquity cannot be separated from rotation. |
| Rotary Stability | `shoulder_or_pelvis_rotation`, `shoulder_lowering` | Both derive from transverse-segment tilt, unrecoverable from the sagittal view. The elbow-to-knee touch is kept because that movement happens in the plane the camera sees. |

**Consequence, and it matters:** a dropped check can only push a score *up*, never down.
Inline Lunge and Rotary Stability therefore read high. The app marks both as
**provisional** with an amber banner (`PROVISIONAL_TESTS` in
`PhysioTracking/src/app/doctor/patients/[id].tsx`).

**Knee-tracking validity was checked for Inline Lunge specifically and rejected.**
`_knee_medial_offset` is documented FRONTAL VIEWS ONLY: measured from the side it returns
anterior knee travel, which is large and normal in a lunge.

**One check is effectively dead but not formally listed as dropped:** Deep Squat's
`trunk_leans_forward` (`> 32°`). Forward lean is a sagittal quantity and the squat is
filmed frontally, so it reads 0.0°–8.9° across all 18 subjects. Worth formalising.

---

## 8. Validation: the 126-video batch

`fms_outputs/reports/all_samples_report.json` — tracked in git as the record.

- **126/126 videos scored, 0 failures, 0 skipped.**
- 18 subjects × 7 tests. Run 5 Sep 2026, `balanced` mode, CUDA.
- Elapsed **11,166.7 s** (~3.1 h, ~88.6 s/video).
- Run fresh with `--overwrite`; reproduced the cached baseline with **0 score changes and
  0 fault changes.**
- 0 entries have a null score — all 126 are `status: "scored"`.

Score distribution:

| Test | Avg | 1 | 2 | 3 |
|---|---|---|---|---|
| Deep Squat | 1.94 | 8 | 3 | 7 |
| Hurdle Step | 2.39 | 0 | 11 | 7 |
| Inline Lunge | 2.94 | 0 | 1 | 17 |
| Shoulder Mobility | 1.56 | 13 | 0 | 5 |
| Active Straight-Leg Raise | 2.44 | 0 | 10 | 8 |
| Trunk Stability Push-Up | 3.00 | 0 | 0 | 18 |
| Rotary Stability | 2.78 | 2 | 0 | 16 |

### Findings from this distribution that need attention

1. **The push-up test is inert.** No check has ever fired; all 18 score 3. Elbow angles
   reach 72° against a `> 135°` threshold; body-line error reaches 0.051 against `> 0.12`;
   knees never drop below 158.5° against `< 150°`. The logic is sound — an earlier claim
   that `elbow_angle > 135` was "essentially unfireable" was **wrong** and was corrected:
   it simply never triggers on this cohort. Also, the clinical 3-vs-2 criterion for this
   test is **hand position**, which is not measured at all.
2. **Inline Lunge is near-uninformative.** Two of four checks dropped, and the depth check
   (`> 125°`) never fires because observed knee angles top out at 87.5°. Scores rest on
   trunk lean alone.
3. **Shoulder Mobility: 13 of 18 score 1.** Two likely causes — the system measures
   **wrist-to-wrist** (wrists are landmarks, fists are not) where the clinical standard is
   fist-to-fist, and hand length/shoulder width **default to 8 in / 16 in for every
   patient**. One subject measured 0.02 hand lengths (wrists essentially coincident),
   almost certainly the moment the arms cross in front rather than a real reach — and it
   produced a 3.
4. **Some ASLR readings are physically implausible** — a 42.7° raised-knee angle during a
   *straight*-leg raise, a 39.7° hip angle putting the leg past vertical. Near-certainly
   landmark tracking errors on a supine subject. Because they fall on the wrong side of a
   threshold they generate faults that did not happen.

### Demo videos with real faults

For demonstrating a non-perfect screening (18 Deep Squats, 11 scored 1 or 2):

| Video | Score | Faults | Size |
|---|---|---|---|
| `Dataset\Sample 12\1.DEEP SQUAT\1.mp4` | 1 | `insufficient_depth`, `knees_inward_valgus` | 59.4 MB |
| `Dataset\Sample 4\1.DEEP SQUAT\Deep squat.mp4` | 2 | `insufficient_depth` | 5.4 MB |
| `Dataset\Sample 7\1.DEEP SQUAT\1.mp4` | 1 | `insufficient_depth` | 37.6 MB |

Sample 12 is the **only** Deep Squat in the dataset showing valgus, so it is the only one
that demonstrates two distinct faults. Sample 4 is by far the fastest to process.
(Note: `Dataset\Sample 15\1.Deep squat\Deep squat .mp4` has a **trailing space** before
the extension, which matters in a file picker.)

---

## 9. Authentication

`auth_store.py` — all SQL lives here. SQLite, PBKDF2-HMAC-SHA256, opaque bearer tokens.

**Decisions:**

- **Email is the login identifier**, not phone or username.
- `email TEXT NOT NULL UNIQUE COLLATE NOCASE` — case-insensitive uniqueness, so
  `A@b.com` and `a@b.com` cannot both exist.
- `phone_number TEXT NOT NULL` — captured at patient registration, and load-bearing
  because it generates the password.
- **Default password is `<phone number>.physio`** (`default_password_for`). Deliberately
  guessable-by-the-clinic and **not force-changed on first login** — this is a prototype
  and forcing a change was judged more friction than the threat model warranted. A
  change-password endpoint exists and is wired into **both** doctor and patient profile
  screens.
- Two roles only: `doctor`, `patient` (CHECK-constrained).
- `created_by` records which doctor registered a patient; this is what the doctor's roster
  query uses. Indexed.
- Tokens expire after **30 days** (`TOKEN_TTL_DAYS`). Changing a password can keep the
  current token alive (`keep_token`) so the user is not logged out mid-session.

Endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
`POST /auth/change-password`, `POST /patients`, `GET /patients`.

---

## 10. Result storage and the doctor-only restriction

### Storage schema

Decision taken: **server-persisted results** (option (a)), with the navigation shape
doctor roster → patient → attempts → detail.

```sql
CREATE TABLE results (
  id, patient_id, uploaded_by, job_id UNIQUE, test_id,
  score INTEGER,          -- NULLABLE ON PURPOSE
  faults_json, measurements_json,
  result_json,            -- full FMSScorer output
  created_at
);
CREATE INDEX idx_results_patient ON results(patient_id, created_at);
```

Two decisions worth preserving:

1. **`score` is nullable.** The scorer returns null for `insufficient_data` and
   `manual_required`. Storing `0` there would read as *"pain reported"*, which is a
   completely different clinical finding.
2. **`result_json` keeps the full scorer output as a blob**, so the detail view keeps
   confidence, status, `notAssessed` and video metadata without needing a column per
   field. Approved explicitly rather than normalising.

Patients **can** see who uploaded a screening (`uploadedByName`) — approved decision.

### Doctor-only uploads

**Scope change made partway through: patients can no longer upload or record at all.**

- Server rejects any patient upload with **403** and requires `patient_id` on every
  doctor upload, verified against `patient_of_doctor`.
- The patient Record tab and all patient recording UI were **removed entirely**.
- `uploaderLabel` in `PhysioTracking/src/lib/fms.ts` still contains the
  `'Self-recorded'` branch, **kept deliberately with a comment noting it is currently
  unreachable**, so the logic survives if patient self-recording ever returns.
- Synthetic test rows were cleared from the database at the time of this change.

### Current database contents

4 users (1 doctor, 3 patients), **2 result rows**:

| id | job_id | patient | test | score |
|---|---|---|---|---|
| 7 | `46318302-…18890` | Ramesh Kumar | deep_squat | 3 |
| 8 | `b9bf23e6-…743a1ad` | Anita Rao | deep_squat | 1 |

Ramesh had 4 Deep Squat screenings; ids 4/5/6 were deleted keeping the most recent (id 7),
verified in the browser as "Screenings (1)".

**Housekeeping — done 5 Sep 2026.** `fms_outputs/api/annotated/` had 5 `.mp4` files
against 2 result rows. The three orphans (`42569971-…f081d29c`, `4c0e9ba1-…4bf0c1d836`,
`850b42ee-…e94c931f320e`) were deleted after confirming against the live database that no
result row referenced them and that both surviving screenings still have their overlay.
Two files remain, one per result row.

### Overlay cleanup (added 5 Sep 2026)

The orphans above existed because **there was no deletion path in the application at
all** — screenings were removed by hand through the sqlite CLI, which knows nothing about
the video files. There is now one, and it owns both halves:

- **`DELETE /results/{job_id}`** — deletes the row and its overlay together. Gated exactly
  like the video route: doctor role, and the screening must belong to one of *their*
  patients. Returns `{status, jobId, videoRemoved}`.
- **`auth_store.delete_result(job_id)`** — deletes the row and returns what was removed,
  reading and deleting under one lock so the caller learns exactly what it deleted.
- **`sweep_orphaned_annotations()`** — runs at server startup, deleting overlay files with
  no result row behind them.

**Order is deliberate: the row goes first, then the file.** A failed file delete leaves an
orphan, which is harmless and gets swept at the next start. Deleting the file first and
then failing on the row would leave a screening on record whose video 404s — strictly
worse.

The startup sweep is what covers the cases an endpoint cannot: rows deleted out of band
through sqlite, and a render that succeeded just before `save_result` failed (the overlay
is written *before* the row is saved, so that window is real). It runs **only** at startup
for exactly that reason — a sweep running alongside a live job would delete that job's
video out from under it, and a freshly started process has no jobs in flight.

Verified by booting the server against an isolated database: 19 checks covering the
startup sweep (orphan removed, both files with rows kept), authorization
(401/403/403/404, with nothing deleted by any refused attempt), the successful delete
(row gone, **file gone**, neighbouring screening untouched), and the aftermath (video
route 404s, second delete returns 404 not 500, surviving video still serves 200).

**Not yet wired into the client** — there is no delete button in the app. The endpoint
exists and is tested; the UI is a separate piece of work.

---

## 11. Skeleton-overlay video

`annotate_video.py` renders a skeleton overlay **from the cached keypoint JSON** — it does
not re-run the detector, so it costs a fraction of the original extraction.

Encoding decisions (all measured, not guessed — codec support was confirmed by writing
files and reading them back):

| Setting | Value | Why |
|---|---|---|
| Encoder | `imageio-ffmpeg` (bundled ffmpeg 7.1 + libx264) | No system ffmpeg dependency. |
| Max height | 720 px | Overlays are for review, not archival. |
| FPS | halved above 50 fps | 60 fps source → 30 fps output. |
| Quality | CRF 23, preset `veryfast` | |
| Pixel format | `yuv420p` | Required for browser `<video>` compatibility. |
| Flags | `+faststart` | Lets playback start before the whole file arrives. |
| `macro_block_size` | 1 | Avoids silent dimension rounding. |

Output lands in `fms_outputs/api/annotated/<job_id>.mp4`, typically **1.5–2.4 MB**.

**Rendering is non-fatal.** It runs after scoring inside a `try/except`; a failure records
`summary["annotatedVideoError"]` and the screening still saves with its score. A score is
never lost to a rendering problem.

Served by `GET /results/{job_id}/video`, gated on `current_doctor` **and** an ownership
check against `patient_of_doctor` — a job id alone is not enough to fetch patient footage.
Verified: doctor→200, patient→403, unauthenticated→401, unknown job→404.

**Player box sizing.** The client used to hardcode `aspectRatio: 16/9` regardless of what
was rendered. Both overlays currently on file are **1280×720**, so that happened to match
and there was no visible letterboxing — an earlier claim that portrait footage was being
padded into a 16:9 box was wrong. The box is now derived from the `width`/`height` the API
reports (`overlayBoxStyle` in `patients/[id].tsx`): landscape fills the width, portrait is
driven from a capped height and centred. `VideoView` has no natural-dimension prop, so
this has to come from the data. It changes nothing for the current 16:9 renders and stops
a portrait clip — likely the moment anyone records on a phone held upright — from
letterboxing. Both branches were checked in the browser.

---

## 12. Client app

Expo SDK 56, expo-router v56, typed routes.

```
src/app/
  _layout.tsx            Stack + AuthProvider
  index.tsx              Redirect hub (role-based)
  login.tsx
  patient/               index (home), feedback, progress, profile, explore
                         — NO record tab, by design
  doctor/                index (roster), register-patient, profile,
                         patients/[id].tsx, patients/[id]/record.tsx,
                         patients/[id]/report.tsx
src/lib/fms.ts           FAULT_LABELS (all 31 fault ids), formatFault, formatScore,
                         scoreColor, statusLabel, faultSummary, scoredSessions,
                         averageScore, formatMeasurementKey/Value, uploaderLabel,
                         plus the report spec: FMS_TEST_ORDER, FMS_TEST_NAMES,
                         BILATERAL_TESTS, MEASUREMENT_SPEC, NON_CLINICAL_MEASUREMENTS,
                         finalScoreFor, buildReportRows, rawSubtotal
src/lib/api.ts           All HTTP. Note the web/native branch in createAnalysisJob.
src/lib/names.ts         initials(), shared by the roster and patient header.
src/lib/use-authed-video-source.ts   Auth-gated video playback per platform.
src/components/patient-view-switch.tsx   History / Report segmented switch.
```

### The Report screen (added 5 Sep 2026)

`/doctor/patients/[id]/report` — a per-patient FMS scoring sheet, reached by a
**History | Report** switch on the patient screen rather than a tab (a report is
per-patient, so a tab opened with no patient selected has nothing to show). The two
views are separate routes so a report can be linked to and survives a reload;
the switch uses `router.replace` so flipping between them does not stack history.

Rules it encodes, all in `lib/fms.ts` rather than the screen:

- **Seven rows always**, in clinical order. A test with no screening still gets a row
  showing an em dash — a sheet that omits them hides what has not been done.
- **The most recent screening per test** feeds its row (`buildReportRows`), with the date
  shown so it is never ambiguous which attempt is on the sheet.
- **Final Score is filled only for Deep Squat and Trunk Stability Push-Up**, where it
  equals Raw. The five bilateral tests show a dashed *Pending* chip
  (`BILATERAL_TESTS`, `finalScoreFor`) until side pairing exists — see item 4 below.
- **`scoredFrame` never appears** (`NON_CLINICAL_MEASUREMENTS`). It is an internal frame
  index; beside joint angles a clinician reads it as a finding. It is filtered from the
  history view too.
- **Units are attached** to every measurement (`MEASUREMENT_SPEC`) — degrees, torso
  lengths, leg lengths, hand lengths, inches. Only on the report; the history view still
  shows raw numbers.
- **The composite is pending, not computed.** A raw subtotal is shown and explicitly
  labelled *not the FMS composite* (`rawSubtotal`).
- **No video on this screen.** Playback stays on the history view.

### Thresholds beside measurements (added 6 Sep 2026)

Each measurement on the report shows the threshold it was judged against —
`Knee angle 169.8°  ✗ depth fault > 115.0°  ✗ not completed > 140.0°` — with the value
turning red when any of its thresholds is breached.

**There is exactly one copy of every threshold, in `fms_scoring.py`.** They were bare
literals inside the `_score_*` methods; they are now `Check` objects in `THRESHOLDS`, and
the scoring methods evaluate those same objects via `_fires()` and `_incomplete()`. The
app gets them from **`GET /fms/thresholds`** (static, public, like `/exercises`), so the
report cannot disagree with how a screening was actually scored.

Four shapes the display handles, because the rules are not uniform:

| Shape | Handling |
|---|---|
| Measurement with cutoffs | A chip per check, ✓ within or ✗ breached |
| Measurement with none (hurdle step's knee and hip angle) | "no threshold — recorded for reference", so it is not read as judged |
| Check with no stored value (deep squat arms-overhead, hurdle step single-leg motion) | Greyed, value "not recorded", rule in words. The scorer was **not** changed to store these. |
| Shoulder mobility | Score *bands* (≤1.0 hand → 3, ≤1.5 → 2, >1.5 → 1), not cutoffs; the band the value landed in is highlighted, not marked as a failure |

A measurement can carry **two** thresholds — a fault cutoff and the completion gate that
separates a 1 from a 2. Deep squat knee angle is checked at 115° and again at 140°.

**Drift protection.** `test_fms_scoring.py` went from 3 tests to 11. Five of the new ones
guard the declaration against the code: every emitted fault is declared and every declared
fault is emitted (both read by AST-parsing the scoring methods), no scoring method compares
against a numeric literal any more (only degenerate-geometry guards are allowed), every
declared check names a measurement the scorer stores, and the served spec covers all seven
tests. Two more assert the declared numbers are the ones actually applied.

**Verified score-neutral.** All 126 cached videos were re-scored from their pose JSON and
diffed against `all_samples_report.json`: **0 score changes, 0 fault changes, 0 measurement
changes**, 126/126 matched.

### Pending checks shown as targets (added 6 Sep 2026)

The Report tab's "Not assessed" grey chips are replaced by a **"Not yet assessed"** section
where each gap carries the department's target and the reason it is outstanding. The value
slot reads *"not measured"* in italic grey — it occupies the position a reading would, so
rows scan together, but **no value is ever invented**. Targets use a dashed amber chip;
measurements stay solid, so a goal never reads as a result.

**13 pending checks** are declared as `Check(pending=True, ...)` in `THRESHOLDS` and served
through `/fms/thresholds`. They are never evaluated — `_fires()` and `_incomplete()` skip
them explicitly, so an unmeasured joint can never fail a movement, and a test asserts that
shape.

| Reason | Count | Examples |
|---|---|---|
| Needs front-view footage | 5 | knee alignment, balance/pelvic shift, pelvis lift, shoulder rotation, shoulder lowering |
| Needs ankle tracking upgrade | 8 | all seven ankle DF/PF targets, plus heel-on-floor |

**Five of the 13 have no department target**, shown as *"no target provided"*. Their data
is joint-angle ranges; those five are qualitative compensations they never gave a window
for, and two sit on Rotary Stability, which their data does not cover at all. Inventing a
range would be worse than a blank — a number on a clinical sheet reads as authoritative.

Deep Squat and Hurdle Step gained a pending section they did not have. Their ankle targets
carry **two** blockers, both named in the reason text: the tracking upgrade *and* a side
view, since both tests are filmed frontally.

### ASLR: resting-leg hip flexion is now a real check

The one pending item that was measurable today — sagittal view, both hip angles already
computed — was implemented rather than listed. `oppositeHipAngle` is now recorded and
checked at `< 170°` included, which is the department's 0–10° flexion target converted.
**It is the only threshold in the system taken from their data**; every other one predates
their review.

Impact, measured by re-scoring all 126 cached videos: **the other six movements changed by
0** — no score, fault or measurement moved. ASLR fired the new fault on **11 of 18**, of
which **3 dropped 3 → 2**; the other 8 already carried a fault and stayed at 2. ASLR's
distribution goes from `2:10, 3:8` to `2:13, 3:5`.

Thresholds are fetched **live**, so a historical screening is shown against today's
numbers. Storing them per result at scoring time is the accurate answer and is worth doing
once the department signs the numbers off — that is when the distinction starts to matter.

### Platform quirks that cost real time — do not re-discover these

- **expo-router v56 has no `Stack.Protected`.** Route guarding uses `<Redirect>`.
- **`expo-file-system` has no web implementation.** Constructing its `File` on web throws
  `this.validatePath is not a function`. `createAnalysisJob` branches: web fetches the
  picked URI into a blob and posts `FormData`; native uses `File.createUploadTask`.
  On the web branch **`Content-Type` is deliberately omitted** so the browser sets the
  multipart boundary to match the body it generates.
- **Module-scope `new File(Paths.document, …)` crashes Expo's SSR render.** It was made
  lazy (commit `f1bf95d`). Never construct file handles at module scope.
- **A browser `<video>` cannot send custom headers.** It fires an unauthenticated GET and
  gets a correct 401, surfacing as `MEDIA_ELEMENT_ERROR: Format error`.
  `use-authed-video-source.ts` therefore fetches with `fetch()` (which *can* carry the
  header) and hands the player an object URL, revoked on cleanup to avoid leaking a copy
  per expand. Native just passes `{uri, headers}`. **The auth gate was not weakened** —
  only the retrieval method differs.
- **`useEffect` on mount left the screening list stale** after recording. Uses
  `useFocusEffect` now.
- **Typed routes only regenerate after `npm install`**, and running Metro with `CI=1`
  disables reloads so they never regenerate at all. Two dead links were caught this way.
- **A hidden browser tab throttles `setInterval`.** A job appearing to "stall at 97%" was
  this, not a bug.

---

## 13. Open and pending work

### Blocked on the physiotherapy department

1. **Angle-thresholds review — DELIVERED, awaiting response.**
   A complete plain-language table of all seven tests — every measurement, exact
   threshold, camera-view assumption and clinical meaning, plus the dropped checks and
   eight structural divergences from the clinical protocol — is published at
   **https://claude.ai/code/artifact/551374e3-6392-47a2-8b5f-b8cf012fc534**.
   It ends with six ranked questions. Send it; the highest-priority asks are whether the
   angle thresholds are right and how the push-up should be scored.

2. **Report format — partly built, still open.** The doctor-facing scoring sheet exists
   (see section 12). What remains blocked on the department: whether to sum a **21-point
   composite FMS score**, and the layout of any *patient*-facing summary — the report is
   doctor-only today. `summarize_screen()` in `fms_scoring.py` already computes a
   composite (`score`, `maxScore`, `automatedMaxScore`, `standardMaxScore: 21`,
   `weakestTests`) but **nothing in the API or app calls it**, deliberately: it would sum
   raw scores, and five of the seven need side pairing before a composite is meaningful.

3. **Manual FMS score comparison.** The department is producing manually-scored results
   for comparison against the automated scores. Nothing to do until those arrive; when
   they do, the comparison is the real validation of every threshold in section 5.

### Pending decisions

4. **Left/right side pairing — UNDECIDED, and it affects the recording protocol, not just
   the code.** The clinical protocol scores Hurdle Step, Inline Lunge, Straight-Leg Raise
   and Rotary Stability on **each side** and records the lower. The system currently
   produces **one score per video from one frame**. Only Shoulder Mobility scores both
   sides (by top hand) and takes the worse. Implementing this needs either two videos per
   test or reliable side detection within one — so the department has to agree the
   protocol before the code changes. **Do not start this without that decision.**

5. **UI pass — done for the doctor's roster and patient screens (5 Sep 2026).**
   Roster: doctor's name moved above the title, phone number dropped from rows in favour
   of a screening count, name 15→16 px, 560 px max width. Patient screen: avatar in the
   header, outlined rather than solid "New screening", 620 px max width. Screening
   detail: measurement and fault text 12/13→14 px with row dividers, `scoredFrame`
   removed, overlay box sized from the render.

   **Still open** — the screening detail's *arrangement* was deliberately left alone at
   the user's request (faults still bullet text below the video rather than chips above
   it, no tinted measurement panel, no units on that view). The patient-side screens have
   had no pass at all.

6. ~~Three orphaned annotated `.mp4` files, and no automatic cleanup when a result row is
   deleted.~~ **Done 5 Sep 2026.** The orphans were deleted and the underlying gap is
   closed: `DELETE /results/{job_id}` now removes the row and its overlay together, and a
   startup sweep reconciles anything deleted out of band. See section 10. The one piece
   left is a delete control in the app — the endpoint has no client yet.

### Known technical debt

7. **Push-up thresholds need recalibration.** No check fires on any of 18 subjects
   (section 8). Both a threshold problem and a missing-criterion problem — hand position
   is not measured.

8. **`requirements.txt` is not usable on Windows as-is.** It is a Linux freeze including
   `triton==3.6.0` and the full `nvidia-*-cu12` wheel set, which have no Windows wheels.
   The working `.venv/` was assembled by hand. Splitting this into a real
   `requirements-win.txt` is unfinished work.

9. **Test coverage is thin — improved, still thin.** `test_fms_scoring.py` went from 3 to
   **13 tests** with the threshold work (section 12), which now guards the declared
   thresholds against the scoring code and asserts that pending checks can never be
   evaluated. Still missing: per-fault behavioural coverage for
   the other six tests — only the deep squat's depth fault is exercised end to end — and
   nothing at all covers `analysis_server.py` or `auth_store.py`, both of which have been
   verified only by driving a running server by hand.

10. **README does not document the auth system or roles.** It was updated for the
    camera-angle fix (`61d300e`) but not for anything after `a4634d6`.

11. **Deep Squat's `trunk_leans_forward` should be formally moved to `notAssessed`** — it
    cannot fire on frontal footage (section 7).

---

## 14. Traps for whoever works on this next

**The silent CUDA→CPU fallback.** This one cost hours. Installing CPU `onnxruntime`
alongside `onnxruntime-gpu` makes them **shadow each other** — both provide the same
`onnxruntime` module. `build_detector` would report `device="cuda"` while every session
ran on CPU. The fix was uninstalling both, then
`pip install --force-reinstall --no-deps onnxruntime-gpu==1.24.2`.

`build_detector` in `fms_pipeline.py` now **verifies rather than trusts**: it inspects
every session's actual provider list and requires `CUDAExecutionProvider` in all of them,
printing an explicit fallback warning otherwise. **Never take a `device` label as evidence
CUDA is live — confirm with measured throughput (~14.6 fps extraction) or the provider
list.** The `"device": "cuda"` field in `all_samples_report.json` is self-reported from
*before* this fix, though CUDA was independently confirmed for that run by timing.

**Long-running batches on Windows.** PowerShell `Start-Process` detached processes were
killed mid-run. Use Bash + `nohup`. Also: `A && B && C &` backgrounds the *whole list*, so
variables set in `A` are not visible to a foreground shell afterwards — use literal
absolute paths.

**Monitoring a long run.** `tr` block-buffers mid-pipeline and emitted 0 events. Use a
poll loop with `grep -a`, and add stall detection — two process deaths wrote no log line
at all before dying.

**A stale server will happily serve old code.** `pkill` missed a uvicorn instance once and
the port stayed bound. Kill by port:
`Get-NetTCPConnection -LocalPort 8000 | ... Stop-Process`.

**`git rm` refuses files with local modifications** and aborts an `&&` chain. Use
`git rm -f` when that is genuinely what you want.

---

## 15. Working agreements

- **When asked to verify something before a long run, report the verification results and
  stop.** Do not proceed automatically. Wait for an explicit go.
- **"It imports and parses cleanly" is not "it works."** Boot the server and hit the
  endpoints before calling something done. A file that imports fine can still fail on the
  first real request — `python-multipart`, for instance, raises at *startup*, not import.
- **Measure, don't assert.** Camera views, codec support, CUDA activity, annotation cost
  and the femur-vs-torso normaliser choice were all settled by measurement. Where a claim
  in this file is empirical, the number that supports it is stated.
