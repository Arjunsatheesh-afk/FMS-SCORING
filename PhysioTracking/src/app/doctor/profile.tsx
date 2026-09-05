import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChangePasswordForm from '@/components/change-password-form';
import { useAuth } from '@/context/auth-context';

export default function DoctorProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Profile</Text>

        <View style={styles.mainCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLabel}>
              {(user?.displayName ?? '?').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{user?.displayName}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Physiotherapist</Text>
          </View>
        </View>

        <View style={styles.detailCard}>
          <DetailRow label="Mobile" value={user?.phoneNumber ?? '-'} />
          <DetailRow label="Role" value="Doctor" />
        </View>

        <ChangePasswordForm />

        <Pressable
          style={styles.signOut}
          onPress={async () => {
            await signOut();
            router.replace('/login');
          }}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  container: { padding: 18, gap: 12, paddingBottom: 86 },
  heading: { fontSize: 32, fontWeight: '800', color: '#1f2937' },
  mainCard: { backgroundColor: '#ffffff', borderRadius: 18, padding: 18, alignItems: 'center' },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#d6f5f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { fontSize: 22, fontWeight: '800', color: '#0f9f95' },
  name: { marginTop: 10, fontSize: 20, fontWeight: '800', color: '#1f2937' },
  email: { color: '#64748b', fontSize: 13 },
  badge: {
    marginTop: 10,
    backgroundColor: '#e8f8f5',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { color: '#0f9f7c', fontWeight: '700', fontSize: 12 },
  detailCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  rowLabel: { color: '#64748b', fontSize: 13 },
  rowValue: { color: '#1f2937', fontWeight: '700', fontSize: 13 },
  signOut: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: '#dc5f5f', fontWeight: '800' },
});
