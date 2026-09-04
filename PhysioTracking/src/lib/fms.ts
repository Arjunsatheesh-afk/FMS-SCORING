import { SessionSummary } from '@/types/analysis';

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
