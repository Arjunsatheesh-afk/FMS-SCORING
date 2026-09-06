import {
  AnalysisResult,
  FmsCheck,
  FmsScoreBand,
  FmsSideResult,
  FmsTestId,
  SessionSummary,
  StoredResult,
} from '@/types/analysis';

/** The seven tests in the order a clinical FMS sheet lists them. */
export const FMS_TEST_ORDER: FmsTestId[] = [
  'deep_squat',
  'hurdle_step',
  'inline_lunge',
  'shoulder_mobility',
  'active_straight_leg_raise',
  'trunk_stability_pushup',
  'rotary_stability',
];

export const FMS_TEST_NAMES: Record<FmsTestId, string> = {
  deep_squat: 'Deep Squat',
  hurdle_step: 'Hurdle Step',
  inline_lunge: 'Inline Lunge',
  shoulder_mobility: 'Shoulder Mobility',
  active_straight_leg_raise: 'Active Straight-Leg Raise',
  trunk_stability_pushup: 'Trunk Stability Push-Up',
  rotary_stability: 'Rotary Stability',
};

/**
 * Tests the clinical protocol scores on each side, recording the lower of the
 * two. The scorer produces one score per video from one frame, so a final
 * clinical score cannot be derived for these until the left/right recording
 * protocol is settled with the physiotherapy department. See PROJECT_STATUS.md
 * section 13, item 4.
 */
export const BILATERAL_TESTS: ReadonlySet<FmsTestId> = new Set<FmsTestId>([
  'hurdle_step',
  'inline_lunge',
  'shoulder_mobility',
  'active_straight_leg_raise',
  'rotary_stability',
]);

/**
 * Final score for the report sheet.
 *
 * `null` means "cannot be computed yet" rather than "no score": the two
 * single-score tests take the raw score directly, while the five bilateral ones
 * stay pending until side pairing exists. The report renders that difference
 * explicitly - a blank cell would read as an oversight.
 */
export function finalScoreFor(testId: FmsTestId, rawScore: number | null) {
  if (BILATERAL_TESTS.has(testId)) {
    return null;
  }
  return rawScore;
}

/**
 * Tests whose two sides are now scored separately from one video.
 *
 * Hurdle step and inline lunge are deliberately absent: hurdle step alternates
 * legs rep by rep rather than in two blocks, and inline lunge subjects were
 * inconsistent about whether they swapped the lead foot or turned around. Both
 * wait for separate left/right recordings from the department. Shoulder
 * mobility needs nothing — it already scores each hand and reports the lower.
 */
export const SIDE_SPLIT_TESTS: ReadonlySet<FmsTestId> = new Set<FmsTestId>([
  'active_straight_leg_raise',
  'rotary_stability',
]);

/**
 * Tests that already score both sides within one attempt and report the lower.
 * Shoulder mobility measures each top-hand side on every frame, so its raw
 * score IS the bilateral figure — it must not read as pending, and equally must
 * not read as single-sided.
 */
export const SCORES_BOTH_SIDES_INTERNALLY: ReadonlySet<FmsTestId> = new Set<FmsTestId>([
  'shoulder_mobility',
]);

/** Why a row's Final Score is what it is — shown under the figure. */
export type FinalBasis =
  | 'lower side'
  | 'both sides scored'
  | 'single side recorded'
  | '= raw'
  | null;

export interface MeasurementSpec {
  key: string;
  label: string;
  /** Rendered immediately after the value; '°' is joined, words are spaced. */
  unit?: string;
  decimals?: number;
  /** Show a leading '+' for positive values, where the sign carries meaning. */
  signed?: boolean;
}

/**
 * Which measurements to show per test, in clinical reading order, with the
 * units the raw numbers lack on their own.
 *
 * 'torso' means multiples of the shoulder-to-hip distance, 'leg' multiples of
 * hip-to-ankle, and 'hand' multiples of the patient's hand length - the
 * normalisers fms_scoring.py uses so the values survive a change of camera
 * distance. `scoredFrame` is deliberately absent from every list: it is the
 * internal index of the frame the scorer picked, not a clinical measurement.
 */
export const MEASUREMENT_SPEC: Record<FmsTestId, MeasurementSpec[]> = {
  deep_squat: [
    { key: 'kneeAngle', label: 'Knee angle', unit: '°', decimals: 1 },
    { key: 'hipAngle', label: 'Hip angle', unit: '°', decimals: 1 },
    { key: 'trunkLeanDeg', label: 'Trunk lean', unit: '°', decimals: 1 },
    { key: 'kneeMedialOffset', label: 'Knee medial offset', unit: 'torso', decimals: 2, signed: true },
  ],
  hurdle_step: [
    { key: 'kneeAngle', label: 'Knee angle', unit: '°', decimals: 1 },
    { key: 'hipAngle', label: 'Hip angle', unit: '°', decimals: 1 },
    { key: 'stepHeightNorm', label: 'Step height', unit: 'leg', decimals: 2 },
    { key: 'pelvisTiltNorm', label: 'Pelvis tilt', unit: 'torso', decimals: 2 },
    { key: 'kneeOffsetAbs', label: 'Knee offset', unit: 'torso', decimals: 2 },
  ],
  inline_lunge: [
    { key: 'kneeAngle', label: 'Knee angle', unit: '°', decimals: 1 },
    { key: 'hipAngle', label: 'Hip angle', unit: '°', decimals: 1 },
    { key: 'trunkLeanDeg', label: 'Trunk lean', unit: '°', decimals: 1 },
  ],
  shoulder_mobility: [
    { key: 'bestDistanceHandLengths', label: 'Hand separation', unit: 'hand', decimals: 2 },
    { key: 'bestDistanceIn', label: 'Distance', unit: 'in', decimals: 1 },
    { key: 'topHand', label: 'Top hand' },
    { key: 'handLengthIn', label: 'Hand length used', unit: 'in', decimals: 1 },
  ],
  active_straight_leg_raise: [
    { key: 'raisedHipAngle', label: 'Raised hip angle', unit: '°', decimals: 1 },
    { key: 'raisedKneeAngle', label: 'Raised knee angle', unit: '°', decimals: 1 },
    { key: 'oppositeKneeAngle', label: 'Opposite knee angle', unit: '°', decimals: 1 },
    { key: 'oppositeHipAngle', label: 'Opposite hip angle', unit: '°', decimals: 1 },
    { key: 'raisedSide', label: 'Raised side' },
  ],
  trunk_stability_pushup: [
    { key: 'elbowAngle', label: 'Elbow angle', unit: '°', decimals: 1 },
    { key: 'kneeAngle', label: 'Knee angle', unit: '°', decimals: 1 },
    { key: 'bodyLineErrorNorm', label: 'Body-line error', unit: 'body', decimals: 3 },
  ],
  rotary_stability: [
    { key: 'elbowKneeDistanceNorm', label: 'Elbow-to-knee gap', unit: 'limb', decimals: 3 },
  ],
};

/**
 * Internal fields that must never appear in a clinical measurement list.
 * `scoredFrame` is a frame index; presenting it beside joint angles invites a
 * clinician to read it as a finding.
 */
export const NON_CLINICAL_MEASUREMENTS: ReadonlySet<string> = new Set([
  'scoredFrame',
  'usableFrames',
  'notAssessed',
  'sideResults',
  'note',
]);

/** '169.8°', '+0.19 torso', 'Left', or null when the value is absent. */
export function formatSpecValue(value: unknown, spec: MeasurementSpec) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    const text = value.toFixed(spec.decimals ?? 2);
    const signed = spec.signed && value > 0 ? `+${text}` : text;
    if (!spec.unit) return signed;
    // Degrees sit tight against the number; word units get a space.
    return spec.unit === '°' ? `${signed}°` : `${signed} ${spec.unit}`;
  }
  if (typeof value === 'string') {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return null;
}

/** How many decimals a measurement is shown to, from its display spec. */
function decimalsFor(testId: FmsTestId, measurement: string | null) {
  if (!measurement) return 2;
  return MEASUREMENT_SPEC[testId].find((spec) => spec.key === measurement)?.decimals ?? 2;
}

/** '115°' or '0.10 torso' — a threshold value with its unit attached. */
export function formatThresholdValue(value: number, unit: string | null, decimals: number) {
  const text = value.toFixed(decimals);
  if (!unit) return text;
  return unit === '°' ? `${text}°` : `${text} ${unit}`;
}

/**
 * 'depth fault > 115°' or 'not completed > 140°'.
 *
 * A completion gate decides a score of 1 rather than a named fault, so it is
 * phrased differently — a clinician reading the sheet needs to know which of
 * the two a breach would cost.
 */
export function formatCheck(check: FmsCheck, testId: FmsTestId) {
  if (check.value === null || check.comparison === null) {
    return check.rule ?? check.label;
  }
  const arrow = check.comparison === 'gt' ? '>' : '<';
  const amount = formatThresholdValue(
    check.value,
    check.unit,
    decimalsFor(testId, check.measurement),
  );
  return check.kind === 'completion'
    ? `not completed ${arrow} ${amount}`
    : `${check.label} fault ${arrow} ${amount}`;
}

/** True when the measured value breaches the check. Mirrors Check.fails. */
export function checkFails(check: FmsCheck, measured: number | undefined) {
  if (measured === undefined || check.value === null || check.comparison === null) {
    return false;
  }
  return check.comparison === 'gt' ? measured > check.value : measured < check.value;
}

export interface ThresholdChip {
  text: string;
  /**
   * 'breached' — the measurement crossed a cutoff and the fault fired.
   * 'within'   — it stayed inside.
   * 'landed'   — for score bands, the band the measurement fell into. Landing
   *              in a band is not a failure, so it must not read as one.
   * 'none'     — nothing to judge against.
   */
  state: 'breached' | 'within' | 'landed' | 'none';
}

export interface MeasurementRow {
  key: string;
  label: string;
  /** Formatted value, or null for a check the scorer never records a value for. */
  value: string | null;
  breached: boolean;
  chips: ThresholdChip[];
}

/**
 * The measurement rows for one screened test, each with the thresholds that
 * judged it.
 *
 * Three shapes end up here. A measurement with thresholds gets a chip per
 * check, marked breached or within. A measurement with none is labelled as
 * such, so showing it beside checked values does not imply it was judged. And
 * a check with no stored measurement — the deep squat's arms-overhead check and
 * the hurdle step's single-leg check — appears last with its rule in words and
 * no value, because omitting it would misrepresent how many checks ran.
 */
export function buildMeasurementRows(
  testId: FmsTestId,
  measurements: Record<string, unknown> | undefined,
  thresholds: { checks: FmsCheck[]; scoreBands?: FmsScoreBand[] } | undefined,
): MeasurementRow[] {
  const values = measurements ?? {};
  const checks = thresholds?.checks ?? [];
  const bands = thresholds?.scoreBands ?? [];
  const rows: MeasurementRow[] = [];

  for (const spec of MEASUREMENT_SPEC[testId]) {
    const raw = values[spec.key];
    const value = formatSpecValue(raw, spec);
    if (value === null) continue;

    const applicable = checks.filter((check) => check.measurement === spec.key);
    const numeric = typeof raw === 'number' ? raw : undefined;
    let chips: ThresholdChip[] = applicable.map((check) => ({
      text: formatCheck(check, testId),
      state: checkFails(check, numeric) ? 'breached' : 'within',
    }));

    // Shoulder mobility has bands rather than cutoffs, so its chips mark which
    // band the measurement landed in instead of pass/fail.
    const bandsHere = bands.filter((band) => band.measurement === spec.key);
    if (bandsHere.length > 0) {
      // Bands are served narrowest first, so the first one the value fits is
      // the one it scored in. The last band is open-ended.
      const landed = bandsHere.find(
        (band) => band.maxHandLengths === null || (numeric ?? Infinity) <= band.maxHandLengths,
      );
      const widest = Math.max(
        ...bandsHere.map((band) => band.maxHandLengths ?? Number.NEGATIVE_INFINITY),
      );
      chips = bandsHere.map((band) => ({
        text:
          band.maxHandLengths === null
            ? `> ${widest.toFixed(1)} hand → scores ${band.score}`
            : `≤ ${band.maxHandLengths.toFixed(1)} hand → scores ${band.score}`,
        state: band === landed ? 'landed' : 'none',
      }));
    }

    rows.push({
      key: spec.key,
      label: spec.label,
      value,
      breached: chips.some((chip) => chip.state === 'breached'),
      chips:
        chips.length > 0
          ? chips
          : [{ text: 'no threshold — recorded for reference', state: 'none' }],
    });
  }

  // Valueless checks the scorer DOES evaluate, e.g. the deep squat's
  // arms-overhead rule. Pending checks are excluded — they are not evaluated at
  // all and get their own section, with a target and a reason.
  for (const check of checks.filter(
    (item) => item.measurement === null && item.kind !== 'pending',
  )) {
    rows.push({
      key: check.key,
      label: check.label,
      value: null,
      breached: false,
      chips: [{ text: `checked · ${check.rule ?? ''}`.trim(), state: 'none' }],
    });
  }

  return rows;
}

export interface PendingRow {
  key: string;
  label: string;
  /** The department's target, or null where they supplied none. */
  target: string | null;
  reason: string;
}

/** '15–30° DF', 'heel remains in contact', or null when no target exists. */
function formatTarget(check: FmsCheck) {
  if (check.targetText) {
    return check.targetText;
  }
  if (check.targetMin === null || check.targetMax === null) {
    return null;
  }
  // Every declared unit begins with '°', so it butts against the number.
  return `${check.targetMin}–${check.targetMax}${check.targetUnit ?? ''}`;
}

/**
 * Checks this system does not measure yet, each with the department's target
 * and why it is outstanding.
 *
 * A null target is not an omission: the department's data is joint-angle
 * ranges, and the camera-angle casualties are qualitative compensations they
 * never gave a window for. The report says so rather than inventing one.
 */
export function buildPendingRows(checks: FmsCheck[]): PendingRow[] {
  return checks
    .filter((check) => check.kind === 'pending')
    .map((check) => ({
      key: check.key,
      label: check.label,
      target: formatTarget(check),
      reason: check.reason ?? '',
    }));
}

export interface ReportRow {
  testId: FmsTestId;
  testName: string;
  bilateral: boolean;
  /** The screening this row is built from, or null when never screened. */
  screening: StoredResult | null;
  /** Per-side results where the clip could be split, else null. */
  sides: FmsSideResult[] | null;
  /** Scorer-computed side coverage; see AnalysisResult.sideCoverage. */
  coverage: AnalysisResult['sideCoverage'] | null;
  rawScore: number | null;
  /** null when no rule produced a figure, or when there is no screening. */
  finalScore: number | null;
  /** Why the final score is what it is, shown under the figure. */
  finalBasis: FinalBasis;
  finalPending: boolean;
}

/**
 * One row per test, always all seven, in clinical order.
 *
 * A patient may have several screenings for the same test; the most recent one
 * feeds the row, matching what a clinician means by "their current score". A
 * test with no screening still gets a row - a sheet that omits them hides what
 * has not been done yet.
 */
export function buildReportRows(results: StoredResult[]): ReportRow[] {
  const latest = new Map<FmsTestId, StoredResult>();
  for (const row of results) {
    const testId = row.result.test;
    const held = latest.get(testId);
    if (!held || new Date(row.createdAt) > new Date(held.createdAt)) {
      latest.set(testId, row);
    }
  }

  return FMS_TEST_ORDER.map((testId) => {
    const screening = latest.get(testId) ?? null;
    const rawScore = screening?.result.score ?? null;
    const bilateral = BILATERAL_TESTS.has(testId);
    const sides = screening?.result.sides ?? null;
    const coverage = screening?.result.sideCoverage ?? null;

    // Four outcomes, in priority order. Nothing here is derived from pose data:
    // both `sides` and `sideCoverage` are computed by the scorer and stored.
    let finalScore: number | null = null;
    let finalBasis: FinalBasis = null;
    if (screening) {
      if (sides && typeof screening.result.finalScore === 'number') {
        finalScore = screening.result.finalScore;
        finalBasis = 'lower side';
      } else if (SCORES_BOTH_SIDES_INTERNALLY.has(testId)) {
        // The raw score already IS the lower of the two sides.
        finalScore = rawScore;
        finalBasis = 'both sides scored';
      } else if (coverage === 'single') {
        // One side only, so that side's score stands. It is the lower of one
        // rather than of two, which is why the label has to say so.
        finalScore = rawScore;
        finalBasis = 'single side recorded';
      } else if (!bilateral) {
        finalScore = finalScoreFor(testId, rawScore);
        finalBasis = '= raw';
      }
    }

    return {
      testId,
      testName: screening?.result.testName ?? FMS_TEST_NAMES[testId],
      bilateral,
      screening,
      rawScore,
      sides,
      coverage,
      finalScore,
      finalBasis,
      // Pending only when a screening exists and none of the four rules
      // produced a figure; an unscreened test is absent, shown as an em dash.
      finalPending: screening !== null && finalScore === null,
    };
  });
}

/**
 * Sum of the raw scores actually available, with how many tests contributed.
 *
 * This is NOT the FMS composite: the composite needs a final score for all
 * seven movements, and five of them are pending side pairing. Callers must
 * label it as provisional.
 */
export function rawSubtotal(rows: ReportRow[]) {
  const scored = rows.filter((row) => typeof row.rawScore === 'number');
  return {
    total: scored.reduce((sum, row) => sum + (row.rawScore ?? 0), 0),
    outOf: scored.length * 3,
    testCount: scored.length,
  };
}

/** Human-readable text for every fault id emitted by fms_scoring.py. */
export const FAULT_LABELS: Record<string, string> = {
  pain_reported: 'Pain reported during movement',
  manual_scoring_required: 'Needs manual scoring',
  insufficient_pose_data: 'Not enough clear pose data',
  insufficient_wrist_or_shoulder_data: 'Wrists or shoulders not visible enough',
  // Deep squat
  insufficient_depth: 'Squat depth too shallow',
  trunk_leans_forward: 'Trunk leans forward',
  knees_inward_valgus: 'Knees collapse inward',
  knees_outward_varus: 'Knees track outward',
  arms_not_maintained_overhead: 'Arms not held overhead',
  // Hurdle step
  insufficient_step_clearance: 'Not enough step clearance',
  pelvis_tilt: 'Pelvis tilts',
  knee_internal_external_rotation: 'Knee rotates in or out',
  limited_single_leg_motion: 'Limited single-leg motion',
  // Inline lunge
  insufficient_knee_flexion: 'Not enough knee bend',
  forward_trunk_lean: 'Forward trunk lean',
  knee_alignment_compensation: 'Knee alignment compensation',
  balance_or_pelvis_shift: 'Balance or pelvis shift',
  // Shoulder mobility
  hands_more_than_one_hand_length_apart: 'Hands more than one hand length apart',
  hands_more_than_one_and_half_hand_lengths_apart:
    'Hands more than 1.5 hand lengths apart',
  // Active straight-leg raise
  insufficient_leg_raise: 'Leg not raised far enough',
  same_side_knee_flexion: 'Raised knee bends',
  opposite_side_knee_flexion: 'Opposite knee bends',
  opposite_side_hip_flexion: 'Resting leg lifts at the hip',
  pelvis_lift_or_rotation: 'Pelvis lifts or rotates',
  // Trunk stability push-up
  insufficient_pushup_range: 'Not enough push-up range',
  trunk_extension_or_sag: 'Trunk sags or extends',
  knee_flexion: 'Knees bend',
  // Rotary stability
  fail_to_touch_elbow_to_knee: 'Elbow did not reach knee',
  shoulder_or_pelvis_rotation: 'Shoulder or pelvis rotates',
  shoulder_lowering: 'Shoulder drops',
};

export function formatFault(fault: string) {
  return (
    FAULT_LABELS[fault] ??
    fault.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())
  );
}

/** '2/3', or an em dash when the attempt could not be scored. */
export function formatScore(score: number | null, maxScore = 3) {
  return score === null ? '—' : `${score}/${maxScore}`;
}

export function scoreColor(score: number | null) {
  if (score === null) {
    return '#94a3b8';
  }
  if (score >= 3) {
    return '#0f9f7c';
  }
  if (score === 2) {
    return '#d99106';
  }
  return '#dc5f5f';
}

/** Why a result has no score, phrased for the UI. */
export function statusLabel(status: SessionSummary['status']) {
  if (status === 'manual_required') {
    return 'Manual scoring required';
  }
  if (status === 'insufficient_data') {
    return 'Not enough usable pose data';
  }
  return 'Scored';
}

/**
 * Who recorded a screening, from the viewer's perspective. Patients see this
 * on their own history: a screening their physio recorded for them should not
 * look identical to one they recorded themselves.
 *
 * NOTE: the 'Self-recorded' branch is currently unreachable. Patients cannot
 * upload in this prototype - the server rejects patient-role uploads with 403
 * and the patient app has no recorder - so every stored screening is recorded
 * by a doctor. The branch is kept deliberately: patient self-upload may be
 * re-enabled as a feature after the prototype submission, and this is the only
 * place the distinction needs to be expressed.
 */
export function uploaderLabel(
  session: Pick<SessionSummary, 'uploadedBy' | 'uploadedByName'>,
  viewerId: number | undefined,
) {
  if (session.uploadedBy === undefined) {
    return null;
  }
  if (viewerId !== undefined && session.uploadedBy === viewerId) {
    return 'Self-recorded';
  }
  return session.uploadedByName ? `Recorded by ${session.uploadedByName}` : 'Recorded by your physio';
}

export function faultSummary(faults: string[]) {
  if (faults.length === 0) {
    return 'No faults detected';
  }
  if (faults.length === 1) {
    return formatFault(faults[0]);
  }
  return `${formatFault(faults[0])} +${faults.length - 1} more`;
}

export function scoredSessions(sessions: SessionSummary[]) {
  return sessions.filter(
    (session): session is SessionSummary & { score: number } => typeof session.score === 'number',
  );
}

export function averageScore(sessions: SessionSummary[]) {
  const scored = scoredSessions(sessions);
  if (scored.length === 0) {
    return null;
  }
  return scored.reduce((sum, session) => sum + session.score, 0) / scored.length;
}

/** camelCase measurement key -> 'Camel case' label. */
export function formatMeasurementKey(key: string) {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Measurements hold nested values (e.g. shoulder mobility's sideResults), which
 * are skipped rather than rendered as [object Object].
 */
export function formatMeasurementValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}
