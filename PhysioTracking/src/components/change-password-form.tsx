import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { changePassword } from '@/lib/api';

/**
 * Shared by the doctor and patient profile screens. The current password is
 * required server-side too - this form is convenience, not the check itself.
 */
export default function ChangePasswordForm() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  }

  async function submit() {
    if (busy || !token) return;
    setError(null);
    setDone(false);

    if (!current || !next) {
      setError('Fill in every field.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (next.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      await changePassword(token, current, next);
      reset();
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View style={styles.card}>
        <Pressable
          onPress={() => {
            setDone(false);
            setOpen(true);
          }}>
          <Text style={styles.link}>Change password</Text>
        </Pressable>
        {done ? <Text style={styles.success}>Password updated.</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Change password</Text>

      <Text style={styles.label}>Current password</Text>
      <TextInput
        style={styles.input}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        editable={!busy}
      />

      <Text style={styles.label}>New password</Text>
      <TextInput
        style={styles.input}
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
        editable={!busy}
      />

      <Text style={styles.label}>Confirm new password</Text>
      <TextInput
        style={styles.input}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        editable={!busy}
        onSubmitEditing={submit}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.cancel]}
          onPress={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.save, busy ? styles.disabled : null]}
          onPress={submit}
          disabled={busy}>
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveText}>Update</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, gap: 6 },
  title: { fontSize: 16, fontWeight: '700', color: '#1f2937', marginBottom: 4 },
  link: { color: '#10b7aa', fontWeight: '700', fontSize: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
    color: '#1f2937',
    backgroundColor: '#f8fafc',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  save: { backgroundColor: '#10b7aa' },
  cancel: { backgroundColor: '#e7ebf0' },
  saveText: { color: '#ffffff', fontWeight: '700' },
  cancelText: { color: '#475569', fontWeight: '700' },
  disabled: { opacity: 0.6 },
  error: { color: '#dc5f5f', fontSize: 13, marginTop: 8 },
  success: { color: '#0f9f7c', fontSize: 13, marginTop: 6 },
});
