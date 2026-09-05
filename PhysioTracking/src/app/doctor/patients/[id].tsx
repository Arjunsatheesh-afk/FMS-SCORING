import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { fetchPatientResults } from '@/lib/api';
import {
  faultSummary,
  formatFault,
  formatMeasurementKey,
  formatMeasurementValue,
  formatScore,
  scoreColor,
  statusLabel,
} from '@/lib/fms';
import { AuthUser } from '@/types/auth';
import { StoredResult } from '@/types/analysis';

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
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const body = await fetchPatientResults(token, Number(id));
      setPatient(body.patient);
      setResults(body.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>‹ Patients</Text>
        </Pressable>

        <Text style={styles.heading}>{patient?.displayName ?? 'Patient'}</Text>
        {patient ? (
          <Text style={styles.subheading}>
            {patient.email} · {patient.phoneNumber}
          </Text>
        ) : null}

        <Pressable
          style={styles.primary}
          onPress={() =>
            router.push({
              pathname: '/doctor/patients/[id]/record',
              params: { id: String(id), name: patient?.displayName ?? '' },
            })
          }>
          <Text style={styles.primaryText}>New screening</Text>
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
                      {Object.entries(row.result.measurements ?? {})
                        .map(([key, value]) => [key, formatMeasurementValue(value)] as const)
                        .filter((entry): entry is readonly [string, string] => entry[1] !== null)
                        .map(([key, value]) => (
                          <View key={key} style={styles.measurement}>
                            <Text style={styles.measurementKey}>{formatMeasurementKey(key)}</Text>
                            <Text style={styles.measurementValue}>{value}</Text>
                          </View>
                        ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, gap: 12, paddingBottom: 86 },
  back: { color: '#10b7aa', fontWeight: '700', fontSize: 14 },
  heading: { fontSize: 28, fontWeight: '800', color: '#1f2937' },
  subheading: { color: '#64748b', fontSize: 13 },
  primary: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#ffffff', fontWeight: '800' },
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
  fault: { fontSize: 13, color: '#dc5f5f' },
  notAssessed: { fontSize: 13, color: '#94a3b8' },
  measurement: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  measurementKey: { flex: 1, fontSize: 12, color: '#334155' },
  measurementValue: { fontSize: 12, fontWeight: '700', color: '#1f2937' },
  warning: { backgroundColor: '#fff4e5', borderRadius: 10, padding: 10, marginBottom: 6 },
  warningText: { color: '#8a5a00', fontSize: 12, lineHeight: 17 },
});
