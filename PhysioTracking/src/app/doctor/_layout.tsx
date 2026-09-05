import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';

/** Doctor area guard - mirrors the patient layout. */
export default function DoctorLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color="#10b7aa" />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (user.role !== 'doctor') {
    return <Redirect href="/patient" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.background, borderTopWidth: 0 },
        tabBarActiveTintColor: '#10b7aa',
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Patients' }} />
      <Tabs.Screen name="register-patient" options={{ title: 'Add patient' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* Reached from the roster, not the tab bar. */}
      <Tabs.Screen name="patients/[id]" options={{ href: null }} />
      <Tabs.Screen name="patients/[id]/record" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf0f4',
  },
});
