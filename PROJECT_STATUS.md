# Project Status

**Last updated:** 7 September 2026
**Repo:** https://github.com/Arjunsatheesh-afk/FMS-SCORING.git
**Branch:** `master` — in sync with `origin/master`, HEAD `b01a92b`

> **Picking this up next?** Section 13 item 7: the 6 Sep freeze now has a **confirmed root
> cause** (accumulated expo-video players stranding revoked blob URLs) and a fix that is
> **not yet verified at runtime** — restart Metro, hard-reload, and re-run the measurement
> recorded there. Also note the database is **not** empty (section 10).

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

- Port **8000** — `analysis_server.py`
- Port **8085** — Expo dev server

Both are started by hand (see the commands above); pids change every run, so check the
ports rather than trusting any recorded pid. Note the launcher spawns a **parent/child
python pair** for one server — two `python.exe` processes is normal, not a duplicate.

### Test accounts

Seeded by `seed_accounts.py`. Passwords follow the project convention
`<phone number>.physio`:

| Role | Email | Password | Notes |
|---|---|---|---|
| Doctor | `priya.sharma@physio.example` | `9876543210.physio` | Created patients 2–4 |
| Patient | `ramesh.kumar@example.com` | `9123456780.physio` | No screenings |
| Patient | `anita.rao@example.com` | `9988776655.physio` | **8 screenings** — the 6 Sep recording session, see section 10 |
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
test_fms_scoring.py       24 tests: the threshold table guarded against the
                          scoring code, side splitting, and the declared-side
                          rules. See section 13.

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

Seventeen commits, all pushed:

| SHA | Commit |
|---|---|
| `b01a92b` | Stop the recorder freezing mid-job or reusing the last test silently |
| `dbff01c` | Add manual FMS score, and resolve the Final Score for bilateral tests |
| `5620e99` | Score each side separately for ASLR and rotary stability |
| `bf020a6` | Show pending checks as explained targets; score the ASLR resting leg |
| `97bc455` | Keep "Rotary Stability" as the display name, keep "rotatory" as an alias |
| `cd79d02` | Use the department's name "Rotatory Stability" in the UI *(reverted by `97bc455`)* |
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

### Current database contents (as of 7 Sep 2026)

**This is no longer a clean slate.** A live recording session on 6 Sep produced a complete
seven-test screen on **Anita Rao**, with a manual score entered for every one. 4 users
(1 doctor, 3 patients) and **8 result rows**, all on Anita; Ramesh Kumar and Test Patient
have none.

| row | test | auto | manual | sideCoverage | declaredSide |
|---|---|---|---|---|---|
| 36 | deep_squat | 1 | 1 | `unknown` | — |
| 37 | hurdle_step | 3 | 2 | `single` | **left** |
| 38 | hurdle_step | 3 | 2 | `single` | **right** |
| 39 | inline_lunge | 3 | 3 | `both` | — |
| 40 | shoulder_mobility | 3 | 2 | `internal` | — |
| 41 | active_straight_leg_raise | 2 | 2 | `both` | — |
| 42 | trunk_stability_pushup | 3 | 2 | `unknown` | — |
| 43 | rotary_stability | 3 | 2 | `split` | — |

8 overlay videos on disk, one per row. **Do not assume an empty database** when picking up
this project — clear it deliberately if a clean slate is wanted.

Worth reading as data rather than just state: **automated and manual agree on 3 of 8**, and
**every disagreement runs the same way — automated one point higher, never lower.** That is
the same over-scoring pattern the reference set showed, now reproduced on live footage by a
clinician entering scores independently.

The two hurdle step rows are the department's separate left/right files, each with the side
declared at upload — the first real use of that path, and both resolved to
`sideCoverage='single'` as designed.

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

### Side splitting for ASLR and Rotary Stability (added 6 Sep 2026)

Both sides of a bilateral test live in one video, so scoring each side means finding the
switch. `split_sides()` computes a per-frame signal whose **sign** names the active side,
median-filters it over 15 frames, and cuts between the two dominant phases. Each half is
then scored by the **existing** `_score_*` method, and the **lower** of the two becomes
`finalScore`, as the clinical protocol requires.

| Test | Signal | Splits |
|---|---|---|
| Active Straight-Leg Raise | difference between the two hip angles — already computed every frame | 15 / 18 |
| Rotary Stability | nose position relative to the pelvis midline | 13 / 18 |

**Rotary's signal choice matters.** On hands and knees seen from the side, the two
shoulders sit almost on top of each other, so a left/right shoulder comparison is confident
on as little as 5% of frames. The nose lies along the facing axis and is confident on
essentially every frame of 16 of 18 clips. A shoulder-order fallback covers the two videos
where the nose is not tracked (Sample 7 at 0%, Sample 8 at 3%).

**Not splitting is a normal outcome**, not a failure: 3 ASLR clips have no detectable
switch and 5 rotary subjects never turn on camera. Those rows stay *Pending* with a reason,
rather than being halved arbitrarily.

**Side labels come from the segment's dominant signal, not its scored frame.** The scored
frame is the single most extreme one and can disagree — in 7 of 15 ASLR splits the deepest
frame of a right-leg segment has the *left* hip more flexed, mid-changeover. A majority
vote over the segment is stable where one frame is not; using the scored frame gave both
halves the same label on 7 clips.

**Splitting is purely additive.** `score` stays the whole-clip figure it has always been;
`sides` and `finalScore` arrive alongside it. Re-scoring all 126 videos confirmed the split
moved **nothing** — the only difference from the baseline remains the ASLR hip check below.

### Manual FMS Score (added 6 Sep 2026)

A clinician's own 0–3 score stored **beside** the automated one — the point is to compare
them, not replace one with the other. It sits at the top of the Measurements section on
the screening detail view, with the automated score restated above it.

- `PATCH /results/{job_id}/manual-score`, doctor-only and ownership-checked like the video
  route. `manual_score`, `manual_score_by`, `manual_score_at` were added to `results` by a
  `PRAGMA`-guarded `ALTER TABLE`, since `CREATE TABLE IF NOT EXISTS` will not add columns.
- **Four buttons, not a text field.** The score has exactly four valid values, so an
  invalid entry is impossible and no keyboard is needed. Saves on tap.
- **`null` clears it; `0` does not.** Zero is the FMS score for pain reported, so "not yet
  scored" has to stay its own state. Clearing also clears authorship — a name against a
  blank value would misrepresent who scored what.
- Patients see it **read-only** on their progress screen (`Physio score 2/3 · Dr. …`).
  There is no editing path for them anywhere, and the server rejects them regardless.

The screening detail view also shows the same measurement-and-threshold rows as the
report, reusing `buildMeasurementRows` rather than a second implementation.

### Final Score: four outcomes (added 6 Sep 2026)

A bilateral row's Final Score is decided in this order, all of it from fields the **scorer**
computes and stores — nothing is derived in the client:

| # | Condition | Final | Label |
|---|---|---|---|
| 1 | The clip split into two sides | `min(A, B)` | lower side |
| 2 | The test scores both sides itself (shoulder mobility) | raw | both sides scored |
| 3 | Only one side present | raw | single side recorded |
| 4 | Both sides present but not separable, or signal unusable | — | pending |

**Rule 2 fixed an existing inaccuracy.** Shoulder Mobility measures both hands in all 18
reference videos and already reports the lower — verified 18/18 — yet showed *Pending*
purely because it sat in the bilateral list.

`sideCoverage` is `'internal' | 'split' | 'single' | 'both' | 'unknown'`. Coverage signals
were added for hurdle step (which ankle is higher) and inline lunge (lead foot **and**
facing). Inline lunge needs both: judged on the foot alone, a subject who turns around
reads as one-sided — an error that would have mislabelled 9 clips.

Across the 90 bilateral videos: hurdle step 18 both; inline lunge 1 single / 17 both;
shoulder mobility 18 internal; ASLR 15 split / 3 both; rotary 13 split / 5 single.

### Declared side beats detection

`POST /analysis/jobs` takes an optional `side` (`left`/`right`), surfaced in the recorder
as a **Which side is this?** picker on bilateral tests, defaulting to *Detect
automatically*. Blank or invalid input falls back to detection; case and whitespace are
normalised.

**A declaration wins outright, and a declared clip is not split at all** — splitting a
recording the doctor says is one-sided would invent a second side out of noise. The person
who filmed it knows what is in it; every signal here is a heuristic, and one has already
been wrong once (see the side-label note above).

Because the declaration is absolute, detection still runs **for reporting only**. When it
independently finds both sides, the result carries `declarationConflict: true` and
`detectedCoverage`, and the report shows an advisory note — *"this clip appears to contain
both sides; using your declared single-side selection anyway."* The declaration is still
what was used; the disagreement simply is not silent.

### Recorder reliability (`b01a92b`, 6 Sep 2026)

Three faults let a hurdle step video be scored against deep squat rules with nothing on
screen to signal it, and made a finished job look stuck:

- **Polling lived in a `useRef` that an unrelated effect's cleanup cleared.** That effect
  depended on `loadExercises`, a `useCallback` over `selectedExercise`, so **touching the
  test picker mid-job tore down polling** — the job kept running server-side while the bar
  froze wherever the last poll landed. Polling now has its own effect keyed on the job id.
- **On completion the recorder navigated away immediately**, so the completed state never
  rendered. A finished job now stays on screen: *Completed* badge, the test it was actually
  submitted as, bar held at 100%, score, fault count, and a button to move on.
- **The test picker had a default.** It now starts unselected, uploads are disabled until a
  test is chosen, and both pickers reset after a successful upload — cleared only on
  success, so a failed upload keeps the selection for a retry.

**Verified two ways.** Automated: one video per FMS test uploaded through the API, all
seven scored against the requested test, with every fault belonging to that test's own
declared fault set — a mis-routed video would violate that. The gallery picker itself could
not be driven under automation (expo's web implementation needs user activation a
synthesised click does not confer), so that hop was left unproven at the time.

**That gap is now closed by the live recording session of 6 Sep.** Five screenings were
uploaded through the real gallery picker — Shoulder Mobility, Inline Lunge, Hurdle Step
(left and right), Deep Squat — and each completed with the **correct test label and a real
score**, including two with the side declared. See section 10 for the resulting rows. The
silent-default failure did not recur.

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

4. **Left/right side pairing — done for three of five, blocked on recordings for two.**

   | Test | State |
   |---|---|
   | Shoulder Mobility | **Already correct.** Scores each hand and reports the lower — verified 18/18 against the reference set. Needed no change. |
   | Active Straight-Leg Raise | **Split implemented.** Splits 15/18; the other 3 have no detectable switch and stay pending. |
   | Rotary Stability | **Split implemented.** Splits 13/18; 5 never turn on camera and stay pending. |
   | Hurdle Step | **Blocked.** Alternates legs rep by rep rather than in two blocks, so there is no single switch to find — it needs per-repetition segmentation. Department asked for separate left/right files. |
   | Inline Lunge | **Blocked.** Subjects were inconsistent: 7 swapped the lead foot in place, 9 turned around, 2 did neither. Department asked for separate left/right files. |

   See section 12 for how the split works. Every exercise folder holds exactly one video
   (126 folders, 126 files), so this is segmentation, never file-matching.

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

7. **App froze during a multi-upload session — ROOT CAUSE CONFIRMED, fix unverified.**

   **What happened (6 Sep 2026).** Over roughly 20-30 minutes the doctor uploaded 7-8
   videos one after another, 3-4 minutes apart, changing the test picker between each. The
   app froze partway through the sequence, and the console showed repeated
   `Failed to load resource: net::ERR_FILE_NOT_FOUND` for `blob:` URLs.

   It is **not** triggered by any single action - an early guess that entering a manual
   score caused it was wrong. The shape of the report points at something accumulating
   across a session.

   ### ROOT CAUSE — confirmed 7 Sep, reproduced on demand

   **`useVideoPlayer` was given a changing source.** expo-video creates a new player per
   source change and only releases players **on unmount**, so every screening viewed left a
   live player behind, each owning a detached `<video>` element still referencing its blob
   URL. `use-authed-video-source.ts` revokes the old URL correctly when the source changes,
   which strands every one of those players.

   Measured, opening four screenings on Anita Rao:

   | | value |
   |---|---|
   | video elements ever created | **8** (two per screening opened) |
   | attached | 1 |
   | **detached** | **7** |
   | detached elements holding a blob URL | **4** — one per screening viewed |

   All sat at `readyState 4`, fully buffered, which is why nothing failed until something
   made them reload. Calling `.load()` on the three stranded ones produced **exactly three
   simultaneous `Failed to load resource: net::ERR_FILE_NOT_FOUND`** — the reported
   signature, scaled: five screenings viewed gives five errors at once.

   This also explains the freeze: each stranded element pins a fully decoded 2-4 MB overlay
   in memory, growing with every screening viewed.

   **Why the 7 Sep testing missed it:** it counted `document.querySelectorAll('video')`,
   which sees only *attached* elements, and JS heap, which does not include media buffers.
   Both looked clean while seven detached elements accumulated.

   ### Fix applied — NOT YET VERIFIED AT RUNTIME

   `patients/[id].tsx` now creates the player **once** with `useVideoPlayer(null)` and
   re-points it with `player.replaceAsync(source)` / `replace(null)` in an effect, which is
   the documented way to change source. Typechecks clean.

   **It could not be verified at runtime:** Metro kept serving a stale bundle
   (`ReferenceError: useEffect is not defined` from a pre-edit version), so every
   post-fix measurement re-ran the old code. **Next session must restart the Expo dev
   server, hard-reload, then repeat the measurement above** — the expected result is
   `detached elements holding a blob URL: 0` however many screenings are opened, and no
   errors when `.load()` is forced.

   *Incidental corroboration:* Metro serving a stale bundle was observed directly here,
   which is the same mechanism as the stale-tab theory below.

   ### Ruled out by measurement (7 Sep)

   `URL.createObjectURL` / `revokeObjectURL` were instrumented and ~14 open/close cycles
   run across all 8 screenings, including deliberate rapid switching while blob loads were
   still in flight:

   | | created | revoked | live | heap |
   |---|---|---|---|---|
   | start | 0 | 0 | 0 | 21.5 MB |
   | after 1 open | 1 | 0 | 1 | 23.4 MB |
   | after close | 1 | 1 | **0** | 23.8 MB |
   | after 8 cycles | 8 | 8 | **0** | 23.7 MB |
   | after rapid switching | 10 | 9 | **1** (the open row) | 23.9 MB |

   - **Blob URLs are properly revoked.** No leak. `use-authed-video-source.ts` revokes on
     close and on source change; the single live blob at the end is the open screening.
   - **Heap is flat.** 21.5 -> 23.9 MB across the whole run, and it *fell* from 25.0 to
     23.7 mid-run when GC ran. Video elements return to zero after each close.
   - **`ERR_FILE_NOT_FOUND` did not reproduce.** Zero console errors throughout, including
     under switching designed to strand a player on a revoked URL.

   The gap: this exercised **viewing**, not **uploading**. A faithful reproduction needs
   7-8 real uploads with picker changes between them, which could not be driven under
   automation (expo's web file picker needs user activation a synthesised click does not
   confer).

   ### Leading theory - the browser may have been running the OLD recorder

   The `b01a92b` fix was committed at 07:18 UTC and the first screening was created at
   07:24 UTC, which looks like the session ran post-fix. **That only proves the files
   changed, not that the browser had the new code.** If the tab had been open since before
   the fix and Metro's hot reload did not apply - or it was never hard-reloaded - the
   session would have run the **pre-fix recorder**, which had this confirmed bug:

   > the polling interval lived in a `useRef` cleared by the cleanup of an effect keyed on
   > `loadExercises`, itself a `useCallback` over `selectedExercise` - so **changing the
   > test picker while a job was running tore down polling**. The job continued
   > server-side while the progress bar froze wherever the last poll landed.

   The doctor changed the picker between every upload. That fits "froze partway through a
   sequence of uploads" far better than anything reproducible in the current code. It
   cannot be tested now because the code is fixed.

   ### Real defect found, but a weak fit (fixed 7 Sep)

   `addSession` was an inline arrow inside a `useMemo` keyed on `[history, ...]`, so its
   identity changed whenever history did - and the fixed recorder's polling effect lists it
   as a dependency, meaning the interval was torn down and recreated with a fresh 1.5s
   clock on every history change. It is now a stable `useCallback` with no dependencies.

   **Honest caveat:** `history` only changes on completion, when polling stops anyway, so
   this is a latent bug rather than a demonstrated cause of the freeze. Fixed because it is
   cheap and clearly wrong, not because it explains the symptom.

   ### Next step for whoever picks this up

   1. **Hard-reload the browser** (Ctrl+Shift+R) before the next multi-upload session, so
      the running code is certainly the committed code.
   2. If the freeze **does not** recur, the stale-tab theory above is the likely
      explanation and this item can close.
   3. If it **does** recur, capture at the exact moment: a **console screenshot**, and
      whether the progress bar was **mid-job or at 100%**. That single detail separates a
      dead poll (bar stuck below 100%, job completes server-side) from a stranded video
      player (bar at 100%, blob errors) - the two remaining candidates.

8. **Push-up thresholds need recalibration.** No check fires on any of 18 subjects
   (section 8). Both a threshold problem and a missing-criterion problem — hand position
   is not measured.

9. **`requirements.txt` is not usable on Windows as-is.** It is a Linux freeze including
   `triton==3.6.0` and the full `nvidia-*-cu12` wheel set, which have no Windows wheels.
   The working `.venv/` was assembled by hand. Splitting this into a real
   `requirements-win.txt` is unfinished work.

10. **Test coverage is thin — improved, still thin.** `test_fms_scoring.py` went from 3 to
   **24 tests** with the threshold, side-splitting and declared-side work (section 12), which now guard the declared
   thresholds against the scoring code and asserts that pending checks can never be
   evaluated. Still missing: per-fault behavioural coverage for
   the other six tests — only the deep squat's depth fault is exercised end to end — and
   nothing at all covers `analysis_server.py` or `auth_store.py`, both of which have been
   verified only by driving a running server by hand.

11. **README does not document the auth system or roles.** It was updated for the
    camera-angle fix (`61d300e`) but not for anything after `a4634d6`.

12. **Deep Squat's `trunk_leans_forward` should be formally moved to `notAssessed`** — it
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
