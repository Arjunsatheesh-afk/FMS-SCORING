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
}
