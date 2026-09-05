import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChangePasswordForm from '@/components/change-password-form';
import { useAuth } from '@/context/auth-context';

export default function ProfileScreen() {
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
            <Text style={styles.badgeText}>Patient</Text>
          </View>
        </View>

        <View style={styles.detailCard}>
          <DetailRow label="Mobile" value={user?.phoneNumber ?? '-'} />
          <DetailRow label="Notifications" value="Enabled" />
          <DetailRow label="Data sharing" value="Doctor only" />
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
  safeArea: {
    flex: 1,
    backgroundColor: '#edf0f4',
  },
  container: {
    padding: 18,
    gap: 12,
    paddingBottom: 86,
  },
  signOut: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    color: '#dc5f5f',
    fontWeight: '800',
  },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1f2937',
  },
  mainCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
  },
  name: {
    marginTop: 12,
    fontSize: 22,
    color: '#1f2937',
    fontWeight: '800',
  },
  email: {
    marginTop: 4,
    color: '#64748b',
  },
  badge: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#d6f5f2',
  },
  badgeText: {
    color: '#0f9f95',
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  detailCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    color: '#334155',
    fontWeight: '600',
  },
  rowValue: {
    color: '#0f9f95',
    fontWeight: '700',
  },
});
