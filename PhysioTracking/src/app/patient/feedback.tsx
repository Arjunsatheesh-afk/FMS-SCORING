import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalysis } from '@/context/analysis-context';
import { useAuth } from '@/context/auth-context';
import {
  formatFault,
  formatMeasurementKey,
  formatMeasurementValue,
  formatScore,
  scoreColor,
  statusLabel,
  uploaderLabel,
} from '@/lib/fms';

export default function FeedbackScreen() {
  const { latestSession } = useAnalysis();
  const { user } = useAuth();

  if (!latestSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No feedback yet</Text>
          <Text style={styles.emptyBody}>
            Your physiotherapist will record a movement screen for you. Feedback appears here
            afterwards.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const color = scoreColor(latestSession.score);
  const { scoredFrame, ...otherMeasurements } = latestSession.measurements;
  const measurementRows = Object.entries(otherMeasurements)
    .map(([key, value]) => [key, formatMeasurementValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  const fps = latestSession.video.fps ?? null;
  const scoredAtSeconds =
    scoredFrame !== undefined && fps ? (scoredFrame / fps).toFixed(2) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>{latestSession.testName} feedback</Text>
        <Text style={styles.subheading}>
          {statusLabel(latestSession.status)} · pose confidence{' '}
          {Math.round(latestSession.confidence * 100)}%
        </Text>
        {uploaderLabel(latestSession, user?.id) ? (
          <Text style={styles.uploader}>{uploaderLabel(latestSession, user?.id)}</Text>
        ) : null}

        <View style={styles.scoreCard}>
          <View style={styles.scoreCircle}>
            <Text style={[styles.scoreValue, { color }]}>
              {formatScore(latestSession.score, latestSession.maxScore)}
            </Text>
            <Text style={styles.scoreLabel}>FMS score</Text>
          </View>

          <View style={styles.scoreStats}>
            <Text style={styles.metricLine}>
              Faults: {latestSession.faults.length === 0 ? 'none' : latestSession.faults.length}
            </Text>
            {scoredFrame !== undefined ? (
              <Text style={styles.metricLine}>
                Scored frame: {scoredFrame}
                {scoredAtSeconds ? ` (${scoredAtSeconds}s)` : ''}
              </Text>
            ) : null}
            {latestSession.painReported ? (
              <Text style={styles.metricLine}>Pain reported</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Movement faults</Text>
          {latestSession.faults.length === 0 ? (
            <Text style={styles.emptyLine}>No compensations detected on the scored frame.</Text>
          ) : (
            latestSession.faults.map((fault) => (
              <View key={fault} style={styles.faultRow}>
                <Text style={styles.faultLabel}>{formatFault(fault)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Measurements</Text>
          {measurementRows.length === 0 ? (
            <Text style={styles.emptyLine}>No measurements recorded for this attempt.</Text>
          ) : (
            measurementRows.map(([key, value]) => (
              <View key={key} style={styles.measurementRow}>
                <Text style={styles.measurementLabel}>{formatMeasurementKey(key)}</Text>
                <Text style={styles.measurementValue}>{value}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#edf0f4',
  },
  container: {
    padding: 18,
    gap: 12,
    paddingBottom: 86,
  },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1f2937',
    textTransform: 'capitalize',
  },
  subheading: {
    color: '#64748b',
    fontSize: 13,
  },
  uploader: {
    color: '#0f9f95',
    fontSize: 12,
    fontWeight: '700',
  },
  scoreCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scoreCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 7,
    borderColor: '#d6f5f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  scoreLabel: {
    color: '#64748b',
    fontSize: 11,
  },
  scoreStats: {
    flex: 1,
    gap: 6,
  },
  metricLine: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
  emptyLine: {
    color: '#64748b',
    fontSize: 14,
  },
  faultRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  faultLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#dc5f5f',
  },
  measurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  measurementLabel: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
  measurementValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 26,
    color: '#1f2937',
    fontWeight: '800',
  },
  emptyBody: {
    marginTop: 8,
    textAlign: 'center',
    color: '#64748b',
  },
});
