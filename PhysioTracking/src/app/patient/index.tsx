import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalysis } from '@/context/analysis-context';
import { averageScore, faultSummary, formatScore, scoreColor } from '@/lib/fms';

export default function HomeScreen() {
  const router = useRouter();
  const { latestSession, history } = useAnalysis();

  const average = averageScore(history);
  const averageText = average === null ? '—' : `${average.toFixed(1)}/3`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.overline}>TODAY&apos;S EXERCISE</Text>
          <Text style={styles.heroTitle}>{latestSession?.testName ?? 'Deep Squat'} Screen</Text>
          <Text style={styles.heroBody}>
            {latestSession
              ? `Last score ${formatScore(latestSession.score, latestSession.maxScore)}. Keep moving toward consistent form.`
              : 'Your physiotherapist records your movement screens. Results appear here once reviewed.'}
          </Text>
          <Pressable style={styles.primaryAction} onPress={() => router.push('/patient/progress')}>
            <Text style={styles.primaryActionText}>View my progress</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <StatCard
            label="Latest score"
            value={latestSession ? formatScore(latestSession.score, latestSession.maxScore) : '—'}
            highlight={latestSession ? scoreColor(latestSession.score) : undefined}
          />
          <StatCard label="Sessions" value={`${history.length}`} />
          <StatCard
            label="Avg score"
            value={averageText}
            highlight={average === null ? undefined : scoreColor(Math.round(average))}
          />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent sessions</Text>
            <Pressable onPress={() => router.push('/patient/progress')}>
              <Text style={styles.link}>See all</Text>
            </Pressable>
          </View>

          {history.length === 0 ? (
            <Text style={styles.mutedText}>
              No screenings yet. Your physiotherapist will record one for you.
            </Text>
          ) : (
            history.slice(0, 4).map((item) => (
              <View key={item.id} style={styles.sessionRow}>
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionName}>{item.testName}</Text>
                  <Text style={styles.sessionMeta} numberOfLines={1}>
                    {faultSummary(item.faults)}
                  </Text>
                </View>
                <Text style={[styles.sessionScore, { color: scoreColor(item.score) }]}>
                  {formatScore(item.score, item.maxScore)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, highlight ? { color: highlight } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
    gap: 14,
    paddingBottom: 88,
  },
  heroCard: {
    backgroundColor: '#10b7aa',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#0a7f77',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 3,
  },
  overline: {
    color: '#dcfffb',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  heroTitle: {
    marginTop: 8,
    color: '#f5fffd',
    fontWeight: '800',
    fontSize: 28,
    lineHeight: 32,
  },
  heroBody: {
    marginTop: 8,
    color: '#ddfffb',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryAction: {
    marginTop: 14,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
  },
  primaryActionText: {
    fontSize: 15,
    color: '#0f9f95',
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1e293b',
  },
  statLabel: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 12,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
  },
  link: {
    color: '#10b7aa',
    fontWeight: '700',
    fontSize: 13,
  },
  mutedText: {
    color: '#64748b',
    fontSize: 14,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  sessionInfo: {
    flex: 1,
    paddingRight: 12,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
  sessionMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  sessionScore: {
    fontSize: 14,
    fontWeight: '800',
  },
});
