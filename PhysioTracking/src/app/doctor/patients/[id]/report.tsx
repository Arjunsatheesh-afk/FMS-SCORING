import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PatientViewSwitch } from '@/components/patient-view-switch';
import { useAuth } from '@/context/auth-context';
import { fetchPatientResults, fetchThresholds } from '@/lib/api';
import {
  ReportRow,
  SIDE_SPLIT_TESTS,
  buildMeasurementRows,
  buildPendingRows,
  buildReportRows,
  formatFault,
  rawSubtotal,
  scoreColor,
} from '@/lib/fms';
import { AuthUser } from '@/types/auth';
import { FmsTestThresholds, StoredResult } from '@/types/analysis';

/**
 * Per-patient FMS scoring sheet.
 *
 * Deliberately has no video: this is the structured score record, while the
 * history view remains the place to watch a screening back.
 */
export default function PatientReportScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();

  const [patient, setPatient] = useState<AuthUser | null>(null);
  const [results, setResults] = useState<StoredResult[]>([]);
  const [thresholds, setThresholds] = useState<FmsTestThresholds[]>([]);
  // Screened rows start open: this is a sheet to be read, not navigated. The
  // set holds the rows the doctor has since collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const [body, spec] = await Promise.all([
        fetchPatientResults(token, Number(id)),
        fetchThresholds(),
      ]);
      setPatient(body.patient);
      setResults(body.results);
      setThresholds(spec);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = buildReportRows(results);
  const subtotal = rawSubtotal(rows);
  const screenedCount = rows.filter((row) => row.screening !== null).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.column}>
          <Pressable onPress={() => router.push('/doctor')} hitSlop={8}>
            <Text style={styles.back}>‹ Patients</Text>
          </Pressable>

          <Text style={styles.heading}>FMS Report</Text>
          <Text style={styles.subheading}>
            {patient?.displayName ?? 'Patient'} · most recent screening per movement
          </Text>

          {id ? <PatientViewSwitch patientId={String(id)} active="report" /> : null}

          {loading ? (
            <ActivityIndicator style={styles.loader} color="#10b7aa" />
          ) : error ? (
            <View style={styles.card}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.sectionLabel}>Movement screen</Text>
                  <Text style={styles.screenedPill}>{screenedCount} of 7 screened</Text>
                </View>

                <View style={styles.headerRow}>
                  <Text style={[styles.headerCell, styles.colMovement]}>Movement</Text>
                  <Text style={[styles.headerCell, styles.colScore]}>Raw</Text>
                  <Text style={[styles.headerCell, styles.colFinal]}>Final</Text>
                </View>

                {rows.map((row, index) => (
                  <ReportRowView
                    key={row.testId}
                    row={row}
                    ordinal={index + 1}
                    thresholds={thresholds.find((spec) => spec.testId === row.testId)}
                    open={row.screening !== null && !collapsed.has(row.testId)}
                    onToggle={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(row.testId)) {
                          next.delete(row.testId);
                        } else {
                          next.add(row.testId);
                        }
                        return next;
                      })
                    }
                  />
                ))}
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Composite FMS score</Text>
                <View style={styles.compositeRow}>
                  <Text style={styles.compositeNote}>
                    Needs a final score for all seven movements.
                  </Text>
                  <Text style={styles.pendingChip}>Pending</Text>
                </View>
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>Raw subtotal</Text>
                  <Text style={styles.subtotalValue}>
                    {subtotal.total} / {subtotal.outOf}
                  </Text>
                </View>
                <Text style={styles.compositeCaveat}>
                  Sum of raw scores across the {subtotal.testCount} movement
                  {subtotal.testCount === 1 ? '' : 's'} screened so far.{' '}
                  <Text style={styles.compositeCaveatStrong}>
                    This is not the FMS composite
                  </Text>{' '}
                  — five movements are scored on each side clinically, and that pairing is
                  not implemented yet.
                </Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportRowView({
  row,
  ordinal,
  thresholds,
  open,
  onToggle,
}: {
  row: ReportRow;
  ordinal: number;
  thresholds: FmsTestThresholds | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const screening = row.screening;
  const measurementRows = screening
    ? buildMeasurementRows(row.testId, screening.result.measurements, thresholds)
    : [];
  // Driven by the served spec rather than the stored notAssessed array: the
  // spec is complete (it also covers the joints never measured at all) and it
  // carries the department's target and the reason for each gap.
  const pendingRows = buildPendingRows(thresholds?.checks ?? []);

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowHead}
        onPress={screening ? onToggle : undefined}
        disabled={screening === null}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: screening === null }}>
        <Text style={styles.ordinal}>{ordinal}</Text>

        <View style={styles.colMovement}>
          <Text style={styles.testName}>{row.testName}</Text>
          <Text style={styles.testMeta}>
            {screening
              ? `${new Date(screening.createdAt).toLocaleDateString()} · ${
                  row.bilateral ? 'left / right' : 'single score'
                }`
              : 'Not screened'}
          </Text>
        </View>

        <View style={styles.colScore}>
          {row.rawScore === null ? (
            <Text style={styles.scoreAbsent}>—</Text>
          ) : (
            <Text style={[styles.scoreValue, { color: scoreColor(row.rawScore) }]}>
              {row.rawScore}
              <Text style={styles.scoreMax}>/3</Text>
            </Text>
          )}
        </View>

        <View style={styles.colFinal}>
          {row.finalPending ? (
            <Text style={styles.pendingChipSmall}>Pending</Text>
          ) : row.finalScore === null ? (
            <Text style={styles.scoreAbsent}>—</Text>
          ) : (
            <>
              <Text style={[styles.scoreValue, { color: scoreColor(row.finalScore) }]}>
                {row.finalScore}
                <Text style={styles.scoreMax}>/3</Text>
              </Text>
              {/* Says which of the four rules produced this figure. A
                  single-side final is the lower of one rather than of two, so
                  the basis is never left implicit. */}
              <Text style={styles.equalsRaw}>{row.finalBasis}</Text>
            </>
          )}
        </View>

        {/* Without this the rows gave no sign they opened at all. */}
        <Text style={styles.chevron}>{screening ? (open ? '⌄' : '›') : ''}</Text>
      </Pressable>

      {open ? (
        <View style={styles.detail}>
          {screening === null ? (
            <Text style={styles.emptyDetail}>
              No screening recorded for this movement yet.
            </Text>
          ) : (
            <>
              {row.sides ? (
                <>
                  <Text style={styles.detailLabel}>
                    Sides · scored separately
                  </Text>
                  <View style={styles.sideRow}>
                    {row.sides.map((side) => {
                      const lowest =
                        typeof side.score === 'number' && side.score === row.finalScore;
                      return (
                        <View
                          key={side.position}
                          style={[styles.sideCard, lowest && styles.sideCardTaken]}>
                          <Text style={styles.sideLabel}>{sideLabel(side.label)}</Text>
                          <Text
                            style={[styles.sideScore, { color: scoreColor(side.score) }]}>
                            {side.score ?? '—'}
                            <Text style={styles.sideMax}>/3</Text>
                          </Text>
                          <Text style={styles.sideMeta}>{side.frameCount} frames</Text>
                          {lowest ? <Text style={styles.sideTaken}>taken as final</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.sideNote}>
                    The clip was split at the detected side switch and each half scored on
                    its own. The lower of the two is the final score, as the clinical
                    protocol requires.
                  </Text>
                </>
              ) : null}

              <Text style={styles.detailLabel}>Measurements &amp; thresholds</Text>
              {measurementRows.map((measurement) => (
                <View key={measurement.key} style={styles.measurement}>
                  <View style={styles.measurementTop}>
                    <Text
                      style={[
                        styles.measurementKey,
                        measurement.value === null && styles.measurementKeyMuted,
                      ]}>
                      {measurement.label}
                    </Text>
                    <Text
                      style={[
                        styles.measurementValue,
                        measurement.breached && styles.measurementValueBreached,
                        measurement.value === null && styles.measurementValueAbsent,
                      ]}>
                      {measurement.value ?? 'not recorded'}
                    </Text>
                  </View>
                  <View style={styles.chipRow}>
                    {measurement.chips.map((chip) => (
                      <Text key={chip.text} style={[styles.tChip, CHIP_STYLES[chip.state]]}>
                        {chip.state === 'breached'
                          ? `✗ ${chip.text}`
                          : chip.state === 'within'
                            ? `✓ ${chip.text}`
                            : chip.text}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}

              <Text style={styles.detailLabel}>Faults</Text>
              {screening.result.faults.length === 0 ? (
                <Text style={styles.noFaults}>None detected.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {screening.result.faults.map((fault) => (
                    <Text key={fault} style={styles.faultChip}>
                      {formatFault(fault)}
                    </Text>
                  ))}
                </View>
              )}

              {pendingRows.length > 0 ? (
                <>
                  <Text style={styles.detailLabel}>
                    Not yet assessed · {pendingRows.length}
                  </Text>
                  {pendingRows.map((item) => (
                    <View key={item.key} style={styles.measurement}>
                      <View style={styles.measurementTop}>
                        <Text style={[styles.measurementKey, styles.measurementKeyMuted]}>
                          {item.label}
                        </Text>
                        {/* Occupies the slot a reading would, but can never be
                            mistaken for one. No value is invented. */}
                        <Text style={styles.notMeasured}>not measured</Text>
                      </View>
                      <View style={styles.chipRow}>
                        <Text style={item.target ? styles.targetChip : styles.noTargetChip}>
                          {item.target ? `target ${item.target}` : 'no target provided'}
                        </Text>
                        <Text style={styles.reasonChip}>{item.reason}</Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : null}

              {row.finalPending ? (
                <Text style={styles.pendingNote}>
                  {row.coverage === 'both'
                    ? 'Final score pending: both sides are present in this clip but could not be separated, so neither can be scored on its own.'
                    : row.coverage === 'unknown'
                      ? 'Final score pending: the pose data is not clear enough to tell which side or sides this clip covers.'
                      : 'Final score pending: this movement is scored on each side clinically and the lower is recorded. Awaiting separate left/right recordings.'}
                </Text>
              ) : null}

              {row.finalBasis === 'single side recorded' ? (
                <Text style={styles.singleSideNote}>
                  Only one side was recorded, so this is that side&apos;s score — the lower
                  of one rather than of two. It may read higher than a full bilateral score.
                  {row.screening?.result.declaredSide
                    ? ` Side stated at upload: ${row.screening.result.declaredSide}.`
                    : ''}
                </Text>
              ) : null}

              {/* Advisory only. The declared side is still what was used — this
                  exists so a disagreement is never silent. */}
              {row.screening?.result.declarationConflict ? (
                <Text style={styles.conflictNote}>
                  Note: this clip appears to contain both sides; using your declared
                  single-side selection anyway.
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** 'left' -> 'Left leg'; 'first'/'second' -> 'First half' where no limb is named. */
function sideLabel(label: string) {
  if (label === 'left' || label === 'right') {
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} leg`;
  }
  return label === 'first' ? 'First half' : 'Second half';
}

const CHIP_STYLES = {
  breached: { color: '#c0392f', backgroundColor: '#fdeaea' },
  within: { color: '#1d7a5c', backgroundColor: '#e3f4ed' },
  landed: { color: '#0f9f95', backgroundColor: '#d6f5f2' },
  none: { color: '#64748b', backgroundColor: '#eef2f6', fontWeight: '500' as const },
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, paddingBottom: 90 },
  // Keeps the sheet readable instead of stretching across a desktop browser.
  column: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 12 },

  back: { color: '#0f9f95', fontWeight: '700', fontSize: 14 },
  heading: { fontSize: 28, fontWeight: '800', color: '#1f2937', letterSpacing: -0.4 },
  subheading: { color: '#64748b', fontSize: 13, marginTop: -2 },
  loader: { marginTop: 24 },

  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, gap: 2 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  screenedPill: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f9f95',
    backgroundColor: '#d6f5f2',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#dde5eb',
  },
  headerCell: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#8494a4',
  },

  // One shared column geometry for the header and every row.
  colMovement: { flex: 1, minWidth: 0 },
  colScore: { width: 56, alignItems: 'flex-end' },
  colFinal: { width: 74, alignItems: 'flex-end' },

  row: { borderBottomWidth: 1, borderBottomColor: '#edf2f7' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
  ordinal: { width: 16, fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  testName: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
  testMeta: { fontSize: 12, color: '#64748b', marginTop: 1 },

  scoreValue: { fontSize: 20, fontWeight: '800' },
  scoreMax: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  scoreAbsent: { fontSize: 20, fontWeight: '700', color: '#c2ccd6' },
  equalsRaw: { fontSize: 10, fontWeight: '700', color: '#94a3b8', marginTop: 1 },

  pendingChip: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8a6a1f',
    backgroundColor: '#fdf3dc',
    borderWidth: 1,
    borderColor: '#e0c07a',
    borderStyle: 'dashed',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  pendingChipSmall: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#8a6a1f',
    backgroundColor: '#fdf3dc',
    borderWidth: 1,
    borderColor: '#e0c07a',
    borderStyle: 'dashed',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },

  detail: { paddingBottom: 14, paddingLeft: 24, gap: 2 },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#8494a4',
    marginTop: 10,
    marginBottom: 3,
  },
  emptyDetail: { fontSize: 14, color: '#64748b', paddingTop: 4 },

  measurement: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  measurementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  measurementKey: { flex: 1, fontSize: 14, color: '#475569' },
  measurementKeyMuted: { color: '#94a3b8' },
  measurementValue: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
  measurementValueBreached: { color: '#c0392f' },
  measurementValueAbsent: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  tChip: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tChipBreached: { color: '#c0392f', backgroundColor: '#fdeaea' },
  tChipWithin: { color: '#1d7a5c', backgroundColor: '#e3f4ed' },
  tChipLanded: { color: '#0f9f95', backgroundColor: '#d6f5f2' },
  tChipNone: { color: '#64748b', backgroundColor: '#eef2f6', fontWeight: '500' },
  chevron: { color: '#94a3b8', fontSize: 15, fontWeight: '700', width: 12, textAlign: 'right' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  faultChip: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a03a3a',
    backgroundColor: '#fdeaea',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  sideRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  sideCard: {
    flex: 1,
    backgroundColor: '#f6f8fa',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#e6ecf1',
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: 1,
  },
  // The side that became the final score is outlined, so the "lower of the two"
  // rule is visible rather than something the reader has to work out.
  sideCardTaken: { borderColor: '#10b7aa', backgroundColor: '#f0fbfa' },
  sideLabel: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  sideScore: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  sideMax: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  sideMeta: { fontSize: 11, color: '#94a3b8' },
  sideTaken: { fontSize: 10, fontWeight: '700', color: '#0f9f95', marginTop: 2 },
  sideNote: { fontSize: 11.5, color: '#8494a4', lineHeight: 16, marginTop: 6 },
  notMeasured: {
    fontSize: 12.5,
    fontWeight: '600',
    fontStyle: 'italic',
    color: '#94a3b8',
  },
  // Dashed, so a target never reads as a measurement. The ✓/✗ threshold chips
  // above are solid and always sit beside a real value.
  targetChip: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7a5c12',
    backgroundColor: '#fdf7e6',
    borderWidth: 1,
    borderColor: '#ddc98b',
    borderStyle: 'dashed',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  noTargetChip: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#6b7785',
    backgroundColor: '#eef2f6',
    borderWidth: 1,
    borderColor: '#c6cfd8',
    borderStyle: 'dashed',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  reasonChip: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#64748b',
    backgroundColor: '#eef2f6',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  noFaults: { fontSize: 14, color: '#64748b' },
  pendingNote: { fontSize: 12, color: '#8a6a1f', lineHeight: 17, marginTop: 10 },
  singleSideNote: { fontSize: 12, color: '#8a6a1f', lineHeight: 17, marginTop: 10 },
  // Advisory, not an error: distinct enough to notice, not alarming.
  conflictNote: {
    fontSize: 12,
    color: '#8a5a00',
    lineHeight: 17,
    marginTop: 8,
    backgroundColor: '#fff4e5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },

  compositeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  compositeNote: { flex: 1, fontSize: 13, color: '#64748b' },
  subtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#edf2f7',
  },
  subtotalLabel: { fontSize: 14, color: '#475569', fontWeight: '600' },
  subtotalValue: { fontSize: 18, fontWeight: '800', color: '#1f2937' },
  compositeCaveat: { fontSize: 12, color: '#8494a4', lineHeight: 17, marginTop: 6 },
  compositeCaveatStrong: { fontWeight: '700', color: '#64748b' },

  error: { color: '#dc5f5f', fontSize: 13 },
});
