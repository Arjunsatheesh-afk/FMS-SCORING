import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';

/**
 * Patient area guard. expo-router v56 has no Stack.Protected guard prop, so
 * the check lives in the layout and redirects with <Redirect>.
 *
 * Patients are view-only in this prototype: screenings are recorded by their
 * doctor, so there is no Record tab and no recorder route on this side. The
 * server rejects patient-role uploads outright, so this is a UI reflection of
 * that rule rather than the enforcement of it.
 */
export default function PatientLayout() {
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
  if (user.role !== 'patient') {
    return <Redirect href="/doctor" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.background, borderTopWidth: 0 },
        tabBarActiveTintColor: '#10b7aa',
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="feedback" options={{ title: 'Feedback' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
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
