import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { fetchPatients } from '@/lib/api';
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
        <Text style={styles.heading}>My patients</Text>
        <Text style={styles.subheading}>{user?.displayName}</Text>

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
            {patients.map((patient) => (
              <Pressable
                key={patient.id}
                style={styles.row}
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
                  <Text style={styles.meta}>{patient.phoneNumber}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.note}>Tap a patient to see their screening history.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, gap: 12, paddingBottom: 86 },
  heading: { fontSize: 32, fontWeight: '800', color: '#1f2937' },
  subheading: { color: '#64748b', fontSize: 13 },
  loader: { marginTop: 24 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#d6f5f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0f9f95', fontWeight: '800' },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: '#1f2937' },
  meta: { fontSize: 12, color: '#64748b' },
  muted: { color: '#64748b', fontSize: 14 },
  error: { color: '#dc5f5f', fontSize: 13 },
  chevron: { color: '#94a3b8', fontSize: 22, fontWeight: '700' },
  note: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginTop: 4 },
});
