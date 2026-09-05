import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalysis } from '@/context/analysis-context';
import { useAuth } from '@/context/auth-context';
import { API_BASE_URL, createAnalysisJob, fetchAnalysisJob, fetchExercises } from '@/lib/api';
import { formatScore } from '@/lib/fms';
import { AnalysisJob, FmsExercise, FmsTestId, SessionSummary } from '@/types/analysis';

const POLL_MS = 1500;

interface ScreeningRecorderProps {
  /** Set when a doctor records for a patient; omitted for a patient's own screening. */
  patientId?: number;
  patientName?: string;
  /** Where to go once a screening finishes. */
  completeHref: string;
}

export default function ScreeningRecorder({
  patientId,
  patientName,
  completeHref,
}: ScreeningRecorderProps) {
  const router = useRouter();
  const { addSession, refresh } = useAnalysis();
  const { token } = useAuth();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');

  const [exercises, setExercises] = useState<FmsExercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<FmsTestId>('deep_squat');
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadExercises = useCallback(async () => {
    try {
      const response = await fetchExercises();
      if (response.exercises.length > 0) {
        setExercises(response.exercises);
        if (!response.exercises.some((exercise) => exercise.id === selectedExercise)) {
          setSelectedExercise(response.exercises[0].id);
        }
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }, [selectedExercise]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadExercises();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [loadExercises]);

  async function submitVideo(videoUri: string) {
    setErrorMessage(null);
    setJob(null);

    try {
      if (!token) {
        setErrorMessage('Your session has expired. Sign in again.');
        return;
      }
      const created = await createAnalysisJob({
        uri: videoUri,
        exercise: selectedExercise,
        token,
        patientId,
      });
      setJob(created);
      startPolling(created.id);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function analyzeRecordedVideo() {
    if (!recordedVideoUri) {
      return;
    }

    await submitVideo(recordedVideoUri);
    setRecordedVideoUri(null);
  }

  function startPolling(jobId: string) {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(async () => {
      try {
        const nextJob = await fetchAnalysisJob(jobId);
        setJob(nextJob);

        if (nextJob.status === 'completed' && nextJob.result) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          const summary: SessionSummary = {
            id: nextJob.id,
            createdAt: nextJob.updatedAt,
            ...nextJob.result,
          };
          addSession(summary);
          void refresh();
          router.push(completeHref as never);
        }

        if (nextJob.status === 'failed') {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setErrorMessage(nextJob.error?.message ?? 'Analysis failed');
        }
      } catch (error) {
        setErrorMessage((error as Error).message);
      }
    }, POLL_MS);
  }

  async function openCamera() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setErrorMessage('Camera permission is required to record exercise videos.');
        return;
      }
    }
    setShowCamera(true);
  }

  function toggleCameraFacing() {
    if (isRecording) {
      return;
    }

    setCameraFacing((current) => (current === 'back' ? 'front' : 'back'));
  }

  async function startRecording() {
    if (!cameraRef.current) {
      return;
    }

    try {
      setIsRecording(true);
      const recording = await cameraRef.current.recordAsync({
        maxDuration: 45,
      });
      setIsRecording(false);
      setShowCamera(false);

      if (recording?.uri) {
        setRecordedVideoUri(recording.uri);
      }
    } catch (error) {
      setIsRecording(false);
      setShowCamera(false);
      setErrorMessage((error as Error).message);
    }
  }

  function stopRecording() {
    cameraRef.current?.stopRecording();
    setIsRecording(false);
  }

  async function pickFromGallery() {
    if (!mediaPermission?.granted) {
      const permission = await requestMediaPermission();
      if (!permission.granted) {
        setErrorMessage('Media library permission is required to upload a video.');
        return;
      }
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
      allowsMultipleSelection: false,
    });

    if (!picked.canceled && picked.assets.length > 0) {
      await submitVideo(picked.assets[0].uri);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Record exercise</Text>
        <Text style={styles.subtitle}>
          {patientName
            ? `Recording for ${patientName}. `
            : ''}
          Capture in app or upload a clip. Server URL: {API_BASE_URL}
        </Text>

        <View style={styles.configCard}>
          <Text style={styles.cardTitle}>FMS test</Text>
          {exercises.length === 0 ? (
            <Text style={styles.hintText}>Loading tests from the analysis server…</Text>
          ) : (
            <View style={styles.chipRow}>
              {exercises.map((exercise) => {
                const active = selectedExercise === exercise.id;
                return (
                  <Pressable
                    key={exercise.id}
                    style={[styles.chip, active ? styles.chipActive : null]}
                    onPress={() => setSelectedExercise(exercise.id)}>
                    <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                      {exercise.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {showCamera ? (
          <View style={styles.cameraCard}>
            <View style={styles.cameraHeader}>
              <Text style={styles.cameraHeaderText}>
                {cameraFacing === 'back' ? 'Rear camera' : 'Front camera'}
              </Text>
              <Pressable
                style={[styles.cameraToggle, isRecording ? styles.cameraToggleDisabled : null]}
                onPress={toggleCameraFacing}
                disabled={isRecording}>
                <Text style={styles.cameraToggleText}>Switch camera</Text>
              </Pressable>
            </View>

            <CameraView
              ref={cameraRef}
              style={styles.cameraPreview}
              mode="video"
              facing={cameraFacing}
              mute
            />
            <View style={styles.cameraActions}>
              {isRecording ? (
                <Pressable style={[styles.actionButton, styles.stopButton]} onPress={stopRecording}>
                  <Text style={styles.actionText}>Stop recording</Text>
                </Pressable>
              ) : (
                <Pressable style={[styles.actionButton, styles.startButton]} onPress={startRecording}>
                  <Text style={styles.actionText}>Start recording</Text>
                </Pressable>
              )}
              <Pressable style={[styles.actionButton, styles.cancelButton]} onPress={() => setShowCamera(false)}>
                <Text style={styles.actionText}>Close camera</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.actionsCard}>
            <Pressable style={[styles.bigButton, styles.cameraButton]} onPress={openCamera}>
              <Text style={styles.bigButtonTitle}>Record with camera</Text>
              <Text style={styles.bigButtonMeta}>Film your rep and send it to the analysis server</Text>
            </Pressable>

            <Pressable style={[styles.bigButton, styles.uploadButton]} onPress={pickFromGallery}>
              <Text style={styles.bigButtonTitle}>Choose from gallery</Text>
              <Text style={styles.bigButtonMeta}>Upload MP4/MOV clip for feedback</Text>
            </Pressable>
          </View>
        )}

        {recordedVideoUri ? (
          <View style={styles.readyCard}>
            <Text style={styles.cardTitle}>Recording ready</Text>
            <Text style={styles.readyText}>
              Your video is saved locally. Tap Analyze to upload it to the server.
            </Text>
            <Pressable style={styles.analyzeButton} onPress={analyzeRecordedVideo}>
              <Text style={styles.analyzeButtonText}>Analyze video</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.progressCard}>
          <Text style={styles.cardTitle}>Analysis status</Text>
          {job ? (
            <>
              <Text style={styles.statusLine}>Job: {job.status}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(job.progress * 100)}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{Math.round(job.progress * 100)}%</Text>
              {job.result ? (
                <Text style={styles.statusLine}>
                  {job.result.testName}: {formatScore(job.result.score, job.result.maxScore)}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.statusLine}>No active job</Text>
          )}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#edf0f4',
  },
  container: {
    padding: 18,
    paddingBottom: 88,
    gap: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1f2937',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  configCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    backgroundColor: '#e7ebf0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#10b7aa',
  },
  chipText: {
    color: '#475569',
    fontWeight: '600',
  },
  hintText: {
    color: '#64748b',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#ffffff',
  },
  actionsCard: {
    gap: 10,
  },
  bigButton: {
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  cameraButton: {
    backgroundColor: '#10b7aa',
  },
  uploadButton: {
    backgroundColor: '#ffffff',
  },
  bigButtonTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  bigButtonMeta: {
    color: '#334155',
    fontSize: 13,
  },
  cameraCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  cameraHeader: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#111827',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  cameraHeaderText: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '700',
  },
  cameraToggle: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1f2937',
  },
  cameraToggleDisabled: {
    opacity: 0.5,
  },
  cameraToggleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  cameraPreview: {
    height: 360,
  },
  cameraActions: {
    padding: 12,
    gap: 8,
    backgroundColor: '#111827',
  },
  actionButton: {
    borderRadius: 12,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#10b7aa',
  },
  stopButton: {
    backgroundColor: '#dc5f5f',
  },
  cancelButton: {
    backgroundColor: '#475569',
  },
  actionText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  readyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  statusLine: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '600',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#edf2f7',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b7aa',
  },
  progressLabel: {
    color: '#0f9f7c',
    fontWeight: '700',
  },
  errorText: {
    color: '#dc5f5f',
    fontSize: 13,
  },
  readyText: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  analyzeButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#10b7aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzeButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
