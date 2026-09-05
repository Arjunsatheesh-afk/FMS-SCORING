import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalysis } from '@/context/analysis-context';
import { useAuth } from '@/context/auth-context';
import {
  averageScore,
  faultSummary,
  formatScore,
  scoreColor,
  scoredSessions,
  uploaderLabel,
} from '@/lib/fms';

export default function ProgressScreen() {
  const { history } = useAnalysis();
  const { user } = useAuth();

  const scored = scoredSessions(history);
  const bestScore = scored.length > 0 ? Math.max(...scored.map((item) => item.score)) : null;
  const average = averageScore(history);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>My progress</Text>
        <Text style={styles.subheading}>Recent AI-reviewed sessions</Text>

        <View style={styles.summaryRow}>
          <Stat title="Best" value={bestScore === null ? '—' : `${bestScore}/3`} />
          <Stat title="Average" value={average === null ? '—' : `${average.toFixed(1)}/3`} />
          <Stat title="Sessions" value={`${history.length}`} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Score trend</Text>
          {history.length === 0 ? (
            <Text style={styles.emptyText}>No sessions yet</Text>
          ) : (
            history.slice(0, 8).map((session) => (
              <View key={session.id} style={styles.trendRow}>
                <Text style={styles.trendLabel} numberOfLines={1}>
                  {session.testName}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${
                          session.score === null
                            ? 0
                            : Math.max(8, (session.score / session.maxScore) * 100)
                        }%`,
                        backgroundColor: scoreColor(session.score),
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.trendValue, { color: scoreColor(session.score) }]}>
                  {formatScore(session.score, session.maxScore)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session details</Text>
          {history.length === 0 ? (
            <Text style={styles.emptyText}>
              Screenings recorded by your physiotherapist will appear here.
            </Text>
          ) : (
            history.map((session) => (
              <View key={session.id} style={styles.detailRow}>
                <View style={styles.detailInfo}>
                  <Text style={styles.detailName}>{session.testName}</Text>
                  <Text style={styles.detailMeta} numberOfLines={1}>
                    {faultSummary(session.faults)}
                  </Text>
                  {uploaderLabel(session, user?.id) ? (
                    <Text style={styles.detailUploader}>{uploaderLabel(session, user?.id)}</Text>
                  ) : null}
                </View>
                <Text style={[styles.detailScore, { color: scoreColor(session.score) }]}>
                  {formatScore(session.score, session.maxScore)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
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
  },
  subheading: {
    color: '#64748b',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    flex: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f9f95',
  },
  statTitle: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 12,
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
  emptyText: {
    color: '#64748b',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  trendLabel: {
    width: 90,
    fontSize: 13,
    textTransform: 'capitalize',
    color: '#334155',
    fontWeight: '600',
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#edf2f7',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#10b7aa',
  },
  trendValue: {
    width: 42,
    textAlign: 'right',
    fontWeight: '700',
  },
  detailRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailInfo: {
    flex: 1,
    paddingRight: 12,
  },
  detailName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  detailMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  detailUploader: {
    fontSize: 11,
    color: '#0f9f95',
    fontWeight: '700',
  },
  detailScore: {
    fontWeight: '700',
  },
});
