export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed';

export type FmsTestId =
  | 'deep_squat'
  | 'hurdle_step'
  | 'inline_lunge'
  | 'shoulder_mobility'
  | 'active_straight_leg_raise'
  | 'trunk_stability_pushup'
  | 'rotary_stability';

/** Outcome of one scoring attempt, mirroring FMSScorer.score in fms_scoring.py. */
export type FmsResultStatus = 'scored' | 'manual_required' | 'insufficient_data';

export interface FmsExercise {
  id: FmsTestId;
  name: string;
  maxScore: number;
  automated: boolean;
}

/**
 * One threshold the scorer applies, as served by GET /fms/thresholds.
 *
 * `comparison` is the direction that FAILS: 'gt' fails when the measured value
 * is greater than `value`. `fault` is null for a completion gate, which decides
 * a score of 1 rather than a named fault. `measurement` is null for the two
 * checks the scorer evaluates from positions it never records — those carry
 * `rule` instead and have no value to show.
 */
export interface FmsCheck {
  key: string;
  label: string;
  measurement: string | null;
  comparison: 'gt' | 'lt' | null;
  value: number | null;
  unit: string | null;
  fault: string | null;
  /**
   * 'pending' is a check the FMS defines but this system does not measure yet.
   * It is never evaluated — it carries the department's target and the reason
   * it is outstanding, so a report can show an explained gap rather than a
   * blank. Its target is in the department's own convention (flexion,
   * dorsiflexion), which is safe to display verbatim because there is no
   * measured value to compare it against.
   */
  kind: 'fault' | 'completion' | 'pending';
  rule: string | null;
  targetMin: number | null;
  targetMax: number | null;
  targetUnit: string | null;
  /** A target that is not a number, e.g. "heel remains in contact". */
  targetText: string | null;
  reason: string | null;
}

/** Shoulder mobility maps a distance straight to a score, with no cutoffs. */
export interface FmsScoreBand {
  maxHandLengths: number | null;
  score: number;
  fault: string | null;
  measurement: string;
}

export interface FmsTestThresholds {
  testId: FmsTestId;
  testName: string;
  checks: FmsCheck[];
  scoreBands?: FmsScoreBand[];
}

/**
 * Measurements vary per test, so only the widely shared keys are named.
 * `scoredFrame` is the frame the scorer picked as the scoring moment; it is
 * absent when no frame could be scored (pain reported, insufficient data).
 */
export interface FmsMeasurements {
  scoredFrame?: number;
  usableFrames?: number;
  kneeAngle?: number;
  hipAngle?: number;
  trunkLeanDeg?: number;
  pelvisTiltDeg?: number;
  [key: string]: unknown;
}

export interface VideoMetadata {
  fps?: number | null;
  totalFrames?: number | null;
  framesProcessed?: number | null;
  width?: number | null;
  height?: number | null;
}

/** Skeleton-overlay render produced after scoring. */
export interface AnnotatedVideo {
  /** Server-relative path; requires the same bearer token as the API. */
  url: string;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
}

/** One side of a bilateral test, scored on its own segment of the video. */
export interface FmsSideResult {
  /** 'left'/'right' where the signal names a limb, else 'first'/'second'. */
  label: string;
  position: 'first' | 'second';
  score: number | null;
  faults: string[];
  measurements: FmsMeasurements;
  frameCount: number;
  frameRange: [number, number];
}

export interface AnalysisResult {
  test: FmsTestId;
  testName: string;
  /** FMS score 0-3, or null when the attempt could not be scored. */
  score: number | null;
  maxScore: number;
  faults: string[];
  measurements: FmsMeasurements;
  confidence: number;
  status: FmsResultStatus;
  automated: boolean;
  painReported: boolean;
  expectedFault: string | null;
  source: string;
  trackedJson: string;
  detectorMode: string;
  detectorDevice: string;
  video: VideoMetadata;
  /**
   * Present only where the video could be split into two sides — currently
   * ASLR and rotary stability. `score` above stays the whole-clip figure; these
   * are additive.
   */
  sides?: FmsSideResult[];
  /** The lower of the two side scores — the clinical figure. */
  finalScore?: number | null;
  /**
   * How much of a bilateral test this attempt covers.
   * 'internal' — the test scores both sides itself (shoulder mobility)
   * 'split'    — two sides were found and scored separately
   * 'single'   — only one side is present, so its score is the final score
   * 'both'     — both sides present but not separable, so no final score
   * 'unknown'  — no signal strong enough to say
   */
  sideCoverage?: 'internal' | 'split' | 'single' | 'both' | 'unknown';
  /** The side the doctor stated at upload, which overrides detection. */
  declaredSide?: string | null;
  /** What detection would have said on its own; set only when a side was declared. */
  detectedCoverage?: 'internal' | 'split' | 'single' | 'both' | 'unknown' | null;
  /**
   * True when a side was declared but detection independently found both sides.
   * The declaration still stands — this only stops the disagreement being
   * silent.
   */
  declarationConflict?: boolean;
  /** Absent when the overlay render failed or was not attempted. */
  annotatedVideo?: AnnotatedVideo;
  annotatedVideoError?: string;
}

export interface AnalysisJob {
  id: string;
  status: AnalysisStatus;
  exercise: FmsTestId;
  testName: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result: AnalysisResult | null;
  error: { message: string; trace?: string } | null;
}

export interface SessionSummary extends AnalysisResult {
  id: string;
  createdAt: string;
  /** Who submitted this screening - the patient themselves, or their doctor. */
  uploadedBy?: number;
  uploadedByName?: string | null;
  /** The clinician's own score, read-only on the patient screens. */
  manualScore?: number | null;
  manualScoreByName?: string | null;
  manualScoreAt?: string | null;
}

/** A row from GET /me/results or GET /patients/{id}/results. */
export interface StoredResult {
  id: number;
  patientId: number;
  uploadedBy: number;
  uploadedByName: string | null;
  jobId: string;
  createdAt: string;
  /**
   * The clinician's own 0–3 score, kept beside the automated one rather than
   * replacing it. Null means not yet scored — distinct from a manual 0, which
   * is the FMS score for pain during the movement.
   */
  manualScore: number | null;
  manualScoreByName: string | null;
  manualScoreAt: string | null;
  /** Full FMSScorer output, same shape a freshly polled job returns. */
  result: AnalysisResult;
}
