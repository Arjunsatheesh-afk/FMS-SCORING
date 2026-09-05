import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/context/auth-context';

/**
 * Entry point. Sends the user to login or to the home screen for their role.
 * Rendering a spinner while status is 'loading' is what prevents a flash of
 * the login screen on cold start before the stored session is restored.
 */
export default function IndexRedirect() {
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

  return <Redirect href={user.role === 'doctor' ? '/doctor' : '/patient'} />;
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf0f4',
  },
});
