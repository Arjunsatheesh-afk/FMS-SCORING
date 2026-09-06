import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { fetchPatients } from '@/lib/api';
import { initials } from '@/lib/names';
import { AuthUser } from '@/types/auth';

export default function DoctorHomeScreen() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [patients, setPatients] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus so a patient registered on the next tab shows up here.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        if (!token) return;
        setError(null);
        try {
          const rows = await fetchPatients(token);
          if (active) setPatients(rows);
        } catch (err) {
          if (active) setError((err as Error).message);
        } finally {
          if (active) setLoading(false);
        }
      }
      void load();
      return () => {
        active = false;
      };
    }, [token]),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.column}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>{user?.displayName}</Text>
            <Text style={styles.heading}>My patients</Text>
            <Text style={styles.subheading}>{rosterSummary(patients)}</Text>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color="#10b7aa" />
          ) : error ? (
            <View style={styles.card}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : patients.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>
                No patients yet. Use the Add patient tab to register one.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {patients.map((patient, index) => (
                <Pressable
                  key={patient.id}
                  style={[styles.row, index === patients.length - 1 && styles.rowLast]}
                  onPress={() =>
                    router.push({
                      pathname: '/doctor/patients/[id]',
                      params: { id: String(patient.id) },
                    })
                  }>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(patient.displayName)}</Text>
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.name}>{patient.displayName}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {patient.email}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.countPill,
                      patient.screeningCount ? styles.countPillHas : styles.countPillNone,
                    ]}>
                    {screeningLabel(patient.screeningCount)}
                  </Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.note}>Tap a patient to see their screening history.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 'None yet' / '1 screening' / '4 screenings'. */
function screeningLabel(count: number | undefined) {
  if (!count) {
    return 'None yet';
  }
  return `${count} screening${count === 1 ? '' : 's'}`;
}

function rosterSummary(patients: AuthUser[]) {
  if (patients.length === 0) {
    return 'No patients registered';
  }
  const withScreenings = patients.filter((patient) => (patient.screeningCount ?? 0) > 0).length;
  return `${patients.length} registered · ${withScreenings} with screenings`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, paddingBottom: 86 },
  // Stops the roster stretching edge to edge in a desktop browser.
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 12 },
  titleBlock: { gap: 1 },
  // The doctor's own name reads as whose list this is, so it sits above the
  // title rather than below it as a caption.
  eyebrow: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  heading: { fontSize: 28, fontWeight: '800', color: '#1f2937', letterSpacing: -0.4 },
  subheading: { color: '#64748b', fontSize: 13 },
  loader: { marginTop: 24 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  rowLast: { borderBottomWidth: 0 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#d6f5f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0f9f95', fontWeight: '800', fontSize: 15 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
  meta: { fontSize: 13, color: '#64748b' },
  countPill: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  countPillHas: { color: '#0f9f95', backgroundColor: '#d6f5f2' },
  countPillNone: { color: '#94a3b8', backgroundColor: '#f1f5f9' },
  muted: { color: '#64748b', fontSize: 14 },
  error: { color: '#dc5f5f', fontSize: 13 },
  chevron: { color: '#94a3b8', fontSize: 20, fontWeight: '700' },
  note: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 2 },
});
