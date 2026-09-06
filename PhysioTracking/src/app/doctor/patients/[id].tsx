import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ManualScorePanel } from '@/components/manual-score-panel';
import { PatientViewSwitch } from '@/components/patient-view-switch';
import { useAuth } from '@/context/auth-context';
import { API_BASE_URL, fetchPatientResults, fetchThresholds, setManualScore } from '@/lib/api';
import {
  buildMeasurementRows,
  faultSummary,
  formatFault,
  formatScore,
  scoreColor,
  statusLabel,
} from '@/lib/fms';
import { initials } from '@/lib/names';
import { useAuthedVideoSource } from '@/lib/use-authed-video-source';
import { AuthUser } from '@/types/auth';
import { FmsTestThresholds, StoredResult } from '@/types/analysis';

/**
 * Inline lunge and rotary stability lost checks that cannot be recovered from
 * the camera angle this dataset is filmed at, so their scores read high. A
 * doctor-facing screen must not present them as settled clinical findings.
 */
const PROVISIONAL_TESTS = new Set(['inline_lunge', 'rotary_stability']);

export default function PatientDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();

  const [patient, setPatient] = useState<AuthUser | null>(null);
  const [results, setResults] = useState<StoredResult[]>([]);
  const [thresholds, setThresholds] = useState<FmsTestThresholds[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingScore, setSavingScore] = useState<number | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
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

  /** Saves on tap. The row updates optimistically and rolls back on failure. */
  const saveManualScore = useCallback(
    async (row: StoredResult, next: number | null) => {
      if (!token) return;
      const previous = results;
      setScoreError(null);
      setSavingScore(row.id);
      setResults((current) =>
        current.map((item) => (item.id === row.id ? { ...item, manualScore: next } : item)),
      );
      try {
        const updated = await setManualScore(token, row.jobId, next);
        setResults((current) =>
          current.map((item) => (item.id === row.id ? { ...item, ...updated } : item)),
        );
      } catch (err) {
        setResults(previous);
        setScoreError((err as Error).message);
      } finally {
        setSavingScore(null);
      }
    },
    [token, results],
  );

  // Refetch on focus, not just on mount: returning here after recording a
  // screening would otherwise show the stale list without the new result.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One player, pointed at whichever row is open. Hooks cannot be called from
  // inside the results.map(), and only one video is visible at a time anyway.
  const openRow = results.find((row) => row.id === expanded) ?? null;
  const hasVideo = Boolean(openRow?.result?.annotatedVideo);
  const videoUrl =
    openRow && hasVideo ? `${API_BASE_URL}/results/${openRow.jobId}/video` : null;

  // The route is doctor-only and ownership-checked; this carries the bearer
  // token in the way each platform actually supports.
  const { source: videoSource, loading: videoLoading, error: videoError } = useAuthedVideoSource(
    videoUrl,
    token,
  );
  const player = useVideoPlayer(videoSource);

  // The overlay is rendered at the source footage's own shape, which for these
  // screenings is portrait. A fixed 16:9 box padded that into a mostly-black
  // slab, so the box takes its ratio from the render the API reports.
  // VideoView has no natural-dimension prop, so this has to come from the data.
  const overlay = openRow?.result?.annotatedVideo;
  const videoBoxStyle = overlayBoxStyle(overlay?.width, overlay?.height);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.column}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>‹ Patients</Text>
        </Pressable>

        <View style={styles.patientHead}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {initials(patient?.displayName ?? '?')}
            </Text>
          </View>
          <View style={styles.patientHeadInfo}>
            <Text style={styles.heading}>{patient?.displayName ?? 'Patient'}</Text>
            {patient ? (
              <Text style={styles.subheading} numberOfLines={1}>
                {patient.email} · {patient.phoneNumber}
              </Text>
            ) : null}
          </View>
        </View>

        {id ? <PatientViewSwitch patientId={String(id)} active="history" /> : null}

        <Pressable
          style={styles.primary}
          onPress={() =>
            router.push({
              pathname: '/doctor/patients/[id]/record',
              params: { id: String(id), name: patient?.displayName ?? '' },
            })
          }>
          <Text style={styles.primaryText}>+ New screening</Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator style={styles.loader} color="#10b7aa" />
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No screenings recorded yet.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Screenings ({results.length})</Text>
            {results.map((row) => {
              const open = expanded === row.id;
              const provisional = PROVISIONAL_TESTS.has(row.result.test);
              return (
                <View key={row.id} style={styles.attempt}>
                  <Pressable
                    style={styles.attemptHeader}
                    onPress={() => setExpanded(open ? null : row.id)}>
                    <View style={styles.attemptInfo}>
                      <Text style={styles.attemptName}>{row.result.testName}</Text>
                      <Text style={styles.attemptMeta} numberOfLines={1}>
                        {new Date(row.createdAt).toLocaleDateString()} ·{' '}
                        {faultSummary(row.result.faults)}
                      </Text>
                      <Text style={styles.attemptMeta}>
                        Uploaded by {row.uploadedByName ?? 'unknown'}
                      </Text>
                    </View>
                    <Text style={[styles.attemptScore, { color: scoreColor(row.result.score) }]}>
                      {formatScore(row.result.score, row.result.maxScore)}
                    </Text>
                  </Pressable>

                  {open ? (
                    <View style={styles.detail}>
                      {provisional ? (
                        <View style={styles.warning}>
                          <Text style={styles.warningText}>
                            Provisional: some checks for this test cannot be assessed from the
                            camera angle used, so the score reads higher than a full screen.
                          </Text>
                        </View>
                      ) : null}

                      <Text style={styles.detailLine}>
                        {statusLabel(row.result.status)} · pose confidence{' '}
                        {Math.round(row.result.confidence * 100)}%
                      </Text>

                      {row.result.annotatedVideo ? (
                        <>
                          <Text style={styles.detailTitle}>Skeleton overlay</Text>
                          {videoLoading ? (
                            <View style={[styles.videoLoading, videoBoxStyle]}>
                              <ActivityIndicator color="#10b7aa" />
                            </View>
                          ) : videoError ? (
                            <Text style={styles.videoError}>{videoError}</Text>
                          ) : (
                            <VideoView
                              style={[styles.video, videoBoxStyle]}
                              player={player}
                              nativeControls
                              contentFit="contain"
                            />
                          )}
                        </>
                      ) : row.result.annotatedVideoError ? (
                        <Text style={styles.videoError}>
                          Overlay unavailable for this screening.
                        </Text>
                      ) : null}

                      <Text style={styles.detailTitle}>Faults</Text>
                      {row.result.faults.length === 0 ? (
                        <Text style={styles.muted}>None detected.</Text>
                      ) : (
                        row.result.faults.map((fault) => (
                          <Text key={fault} style={styles.fault}>
                            • {formatFault(fault)}
                          </Text>
                        ))
                      )}

                      {Array.isArray(row.result.measurements?.notAssessed) &&
                      (row.result.measurements.notAssessed as string[]).length > 0 ? (
                        <>
                          <Text style={styles.detailTitle}>Not assessed from this view</Text>
                          {(row.result.measurements.notAssessed as string[]).map((item) => (
                            <Text key={item} style={styles.notAssessed}>
                              • {formatFault(item)}
                            </Text>
                          ))}
                        </>
                      ) : null}

                      <Text style={styles.detailTitle}>Measurements</Text>

                      <ManualScorePanel
                        automatedScore={row.result.score}
                        maxScore={row.result.maxScore}
                        manualScore={row.manualScore}
                        manualScoreByName={row.manualScoreByName}
                        manualScoreAt={row.manualScoreAt}
                        saving={savingScore === row.id}
                        error={savingScore === row.id ? null : scoreError}
                        onChange={(next) => void saveManualScore(row, next)}
                      />

                      {/* Same rows the report renders, from the same helper -
                          each measurement beside the threshold that judged it. */}
                      {buildMeasurementRows(
                        row.result.test,
                        row.result.measurements,
                        thresholds.find((spec) => spec.testId === row.result.test),
                      ).map((measurement) => (
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
                              ]}>
                              {measurement.value ?? 'not recorded'}
                            </Text>
                          </View>
                          <View style={styles.chipRow}>
                            {measurement.chips.map((chip) => (
                              <Text
                                key={chip.text}
                                style={[styles.tChip, CHIP_STYLES[chip.state]]}>
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
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Shared with the report screen so the two views read identically. */
const CHIP_STYLES = {
  breached: { color: '#c0392f', backgroundColor: '#fdeaea' },
  within: { color: '#1d7a5c', backgroundColor: '#e3f4ed' },
  landed: { color: '#0f9f95', backgroundColor: '#d6f5f2' },
  none: { color: '#64748b', backgroundColor: '#eef2f6', fontWeight: '500' as const },
};

/** Tallest a portrait overlay may be, so it cannot swallow the whole card. */
const MAX_VIDEO_HEIGHT = 380;

/**
 * A box shaped like the rendered overlay rather than a fixed 16:9.
 *
 * Landscape fills the available width. Portrait is driven from its height
 * instead - a full-width portrait box would be taller than the screen on
 * anything wider than a phone - and centred, so the card keeps its margins.
 */
function overlayBoxStyle(width?: number, height?: number) {
  if (!width || !height) {
    return { width: '100%' as const, aspectRatio: 16 / 9 };
  }
  const ratio = width / height;
  if (ratio >= 1) {
    return { width: '100%' as const, aspectRatio: ratio };
  }
  return { height: MAX_VIDEO_HEIGHT, aspectRatio: ratio, alignSelf: 'center' as const };
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, paddingBottom: 86 },
  // Matches the report screen so the two views keep the same measure.
  column: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 12 },
  back: { color: '#0f9f95', fontWeight: '700', fontSize: 14 },
  patientHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  patientHeadInfo: { flex: 1, minWidth: 0 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#d6f5f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0f9f95', fontWeight: '800', fontSize: 15 },
  heading: { fontSize: 24, fontWeight: '800', color: '#1f2937', letterSpacing: -0.3 },
  subheading: { color: '#64748b', fontSize: 13 },
  // Outlined rather than solid: the results below are the subject of the
  // screen, and a full-width teal bar outshouted them.
  primary: {
    height: 44,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#0f9f95', fontWeight: '700', fontSize: 14 },
  loader: { marginTop: 20 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
  muted: { color: '#64748b', fontSize: 14 },
  error: { color: '#dc5f5f', fontSize: 13 },
  attempt: { borderBottomWidth: 1, borderBottomColor: '#edf2f7', paddingVertical: 4 },
  attemptHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  attemptInfo: { flex: 1 },
  attemptName: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
  attemptMeta: { fontSize: 12, color: '#64748b' },
  attemptScore: { fontSize: 16, fontWeight: '800' },
  detail: { paddingBottom: 12, gap: 4 },
  detailLine: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  detailTitle: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 8 },
  fault: { fontSize: 14, color: '#dc5f5f', lineHeight: 20 },
  notAssessed: { fontSize: 14, color: '#94a3b8', lineHeight: 20 },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  tChip: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  // Dimensions come from overlayBoxStyle; this carries only the chrome.
  video: { borderRadius: 10, backgroundColor: '#000000' },
  videoError: { fontSize: 12, color: '#dc5f5f', marginTop: 4 },
  videoLoading: {
    borderRadius: 10,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warning: { backgroundColor: '#fff4e5', borderRadius: 10, padding: 10, marginBottom: 6 },
  warningText: { color: '#8a5a00', fontSize: 12, lineHeight: 17 },
});
