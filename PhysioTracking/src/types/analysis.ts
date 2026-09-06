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
  kind: 'fault' | 'completion';
  rule: string | null;
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
}

/** A row from GET /me/results or GET /patients/{id}/results. */
export interface StoredResult {
  id: number;
  patientId: number;
  uploadedBy: number;
  uploadedByName: string | null;
  jobId: string;
  createdAt: string;
  /** Full FMSScorer output, same shape a freshly polled job returns. */
  result: AnalysisResult;
}
