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
import { registerPatient } from '@/lib/api';

export default function RegisterPatientScreen() {
  const { token } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);

  async function submit() {
    if (busy || !token) return;
    setError(null);
    setCreated(null);

    const trimmed = {
      email: email.trim(),
      displayName: displayName.trim(),
      phoneNumber: phoneNumber.trim(),
    };
    if (!trimmed.email || !trimmed.displayName || !trimmed.phoneNumber) {
      setError('Email, name and mobile number are all required.');
      return;
    }

    setBusy(true);
    try {
      const patient = await registerPatient(token, trimmed);
      setCreated({
        name: patient.displayName,
        // Mirrors auth_store.default_password_for - prototype scheme.
        password: `${patient.phoneNumber}.physio`,
      });
      setEmail('');
      setDisplayName('');
      setPhoneNumber('');
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
          <Text style={styles.heading}>Add patient</Text>
          <Text style={styles.subheading}>
            The patient signs in with this email address.
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Ramesh Kumar"
              placeholderTextColor="#9aa5b1"
              editable={!busy}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="ramesh@example.com"
              placeholderTextColor="#9aa5b1"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
            />

            <Text style={styles.label}>Mobile number</Text>
            <TextInput
              style={styles.input}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="9876543210"
              placeholderTextColor="#9aa5b1"
              keyboardType="phone-pad"
              editable={!busy}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, busy ? styles.disabled : null]}
              onPress={submit}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Register patient</Text>
              )}
            </Pressable>
          </View>

          {created ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>{created.name} registered</Text>
              <Text style={styles.successBody}>
                Their password is <Text style={styles.mono}>{created.password}</Text>
              </Text>
              <Text style={styles.successHint}>
                Ask them to change it after their first sign-in, from Profile.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#edf0f4' },
  flex: { flex: 1 },
  container: { padding: 18, gap: 12, paddingBottom: 86 },
  heading: { fontSize: 32, fontWeight: '800', color: '#1f2937' },
  subheading: { color: '#64748b', fontSize: 13 },
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 44,
    color: '#1f2937',
    backgroundColor: '#f8fafc',
  },
  button: {
    marginTop: 16,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff', fontWeight: '800' },
  disabled: { opacity: 0.6 },
  error: { color: '#dc5f5f', fontSize: 13, marginTop: 8 },
  successCard: { backgroundColor: '#e8f8f5', borderRadius: 16, padding: 14, gap: 4 },
  successTitle: { fontSize: 15, fontWeight: '800', color: '#0f9f7c' },
  successBody: { color: '#334155', fontSize: 14 },
  successHint: { color: '#64748b', fontSize: 12 },
  mono: { fontWeight: '800', color: '#1f2937' },
});
