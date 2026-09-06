import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatScore, scoreColor } from '@/lib/fms';

const CHOICES = [0, 1, 2, 3];

interface Props {
  /** The scorer's own figure, restated here so the two read as a pair. */
  automatedScore: number | null;
  maxScore: number;
  manualScore: number | null;
  manualScoreByName?: string | null;
  manualScoreAt?: string | null;
  /** Omit to render read-only — this is what the patient views pass. */
  onChange?: (score: number | null) => void;
  saving?: boolean;
  error?: string | null;
}

/**
 * The automated score with the clinician's own score directly beneath it.
 *
 * A four-button selector rather than a text field: the score has exactly four
 * valid values, so an invalid entry is impossible, no keyboard is needed on a
 * phone, and it takes one tap. Clear unsets it, because the column is nullable
 * and "not yet scored" must stay distinguishable from a manual 0 — which means
 * pain was reported.
 */
export function ManualScorePanel({
  automatedScore,
  maxScore,
  manualScore,
  manualScoreByName,
  manualScoreAt,
  onChange,
  saving,
  error,
}: Props) {
  const readOnly = onChange === undefined;
  const bothPresent = typeof automatedScore === 'number' && typeof manualScore === 'number';
  const delta = bothPresent ? automatedScore - manualScore : null;

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <View style={styles.labelBlock}>
          <Text style={styles.label}>FMS Score</Text>
          <Text style={styles.sub}>automated</Text>
        </View>
        <Text style={[styles.value, { color: scoreColor(automatedScore) }]}>
          {formatScore(automatedScore, maxScore)}
        </Text>
      </View>

      <View style={[styles.row, styles.rowDivided]}>
        <View style={styles.labelBlock}>
          <Text style={styles.label}>Manual FMS Score</Text>
          <Text style={styles.sub}>
            {error
              ? error
              : saving
                ? 'Saving…'
                : manualScore === null
                  ? readOnly
                    ? 'not scored by your physio yet'
                    : 'not set'
                  : manualScoreByName
                    ? `${manualScoreByName}${manualScoreAt ? ` · ${new Date(manualScoreAt).toLocaleDateString()}` : ''}`
                    : 'recorded'}
          </Text>
        </View>

        {readOnly ? (
          <Text style={[styles.value, { color: scoreColor(manualScore) }]}>
            {manualScore === null ? '—' : formatScore(manualScore, maxScore)}
          </Text>
        ) : (
          <View style={styles.selector}>
            {CHOICES.map((choice) => {
              const on = manualScore === choice;
              return (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.choice, on && styles.choiceOn]}
                  onPress={() => onChange(on ? null : choice)}>
                  <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{choice}</Text>
                </Pressable>
              );
            })}
            {manualScore !== null ? (
              <Pressable onPress={() => onChange(null)} hitSlop={6}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {delta !== null ? (
        <View style={styles.row}>
          <Text style={styles.agreeNote}>
            {delta === 0
              ? 'Automated and manual agree'
              : `Automated scores ${Math.abs(delta)} ${delta > 0 ? 'higher' : 'lower'}`}
          </Text>
          <Text style={[styles.agreeChip, delta === 0 ? styles.agreeMatch : styles.agreeDiffers]}>
            {delta === 0 ? '✓ Match' : 'Differs'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#f6f8fa',
    borderRadius: 10,
    padding: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  rowDivided: { borderTopWidth: 1, borderTopColor: '#e6ecf1', paddingTop: 8, marginTop: 2 },
  labelBlock: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155' },
  sub: { fontSize: 11, color: '#94a3b8' },
  value: { fontSize: 19, fontWeight: '800' },
  selector: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  choice: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#d5dee6',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: '#10b7aa', borderColor: '#10b7aa' },
  choiceText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  choiceTextOn: { color: '#ffffff' },
  clear: { fontSize: 11, fontWeight: '600', color: '#94a3b8', paddingLeft: 4 },
  agreeNote: { flex: 1, fontSize: 12, color: '#94a3b8' },
  agreeChip: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  agreeMatch: { color: '#1d7a5c', backgroundColor: '#e3f4ed' },
  agreeDiffers: { color: '#8a6a1f', backgroundColor: '#fdf3dc' },
});
