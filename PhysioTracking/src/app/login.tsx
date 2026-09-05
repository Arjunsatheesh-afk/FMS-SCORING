import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';

export default function LoginScreen() {
  const router = useRouter();
  const { status, user, signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (e.g. navigated back to /login): bounce to the right home.
  if (status === 'signedIn' && user) {
    return <Redirect href={user.role === 'doctor' ? '/doctor' : '/patient'} />;
  }

  async function submit() {
    if (busy) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    try {
      // The account's role decides the destination - it is never chosen here.
      const signedIn = await signIn(trimmedEmail, password);
      router.replace(signedIn.role === 'doctor' ? '/doctor' : '/patient');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>PhysioTracking</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#9aa5b1"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!busy}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#9aa5b1"
              secureTextEntry
              autoCapitalize="none"
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, busy ? styles.buttonDisabled : null]}
              onPress={submit}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Your physiotherapist creates your account. If you have not changed it, your password is
            your mobile number followed by .physio
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  flex: { flex: 1 },
  container: { padding: 22, gap: 10, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '800', color: '#1f2937' },
  subtitle: { color: '#64748b', fontSize: 14, marginBottom: 10 },
  card: { backgroundColor: '#ffffff', borderRadius: 18, padding: 18, gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    color: '#1f2937',
    backgroundColor: '#f8fafc',
  },
  button: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  error: { color: '#dc5f5f', fontSize: 13, marginTop: 8 },
  hint: { color: '#64748b', fontSize: 12, lineHeight: 17, marginTop: 14, textAlign: 'center' },
});
