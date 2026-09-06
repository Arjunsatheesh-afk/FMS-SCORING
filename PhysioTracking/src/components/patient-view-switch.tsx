import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type PatientView = 'history' | 'report';

/**
 * History / Report switch shown on both patient screens.
 *
 * The two views are separate routes rather than local state so a report can be
 * linked to and survives a reload, and so the back button behaves the way a
 * doctor expects. `replace` rather than `push` keeps flipping between the tabs
 * from stacking history entries.
 */
export function PatientViewSwitch({ patientId, active }: { patientId: string; active: PatientView }) {
  const router = useRouter();

  return (
    <View style={styles.track}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'history' }}
        style={[styles.segment, active === 'history' && styles.segmentActive]}
        onPress={() => {
          if (active !== 'history') {
            router.replace({ pathname: '/doctor/patients/[id]', params: { id: patientId } });
          }
        }}>
        <Text style={[styles.label, active === 'history' && styles.labelActive]}>History</Text>
      </Pressable>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'report' }}
        style={[styles.segment, active === 'report' && styles.segmentActive]}
        onPress={() => {
          if (active !== 'report') {
            router.replace({
              pathname: '/doctor/patients/[id]/report',
              params: { id: patientId },
            });
          }
        }}>
        <Text style={[styles.label, active === 'report' && styles.labelActive]}>Report</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#e2e8ee',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segmentActive: { backgroundColor: '#ffffff' },
  label: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  labelActive: { color: '#1f2937' },
});
