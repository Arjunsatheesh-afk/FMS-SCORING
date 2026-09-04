import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';

import { AnalysisJob, FmsExercise, FmsTestId } from '@/types/analysis';

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

function getExpoHostBaseUrl() {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  if (!hostUri) {
    return null;
  }

  const hostOnly = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0]?.split(':')[0];
  if (!hostOnly) {
    return null;
  }

  return `http://${hostOnly}:8000`;
}

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? getExpoHostBaseUrl() ?? DEFAULT_API_BASE_URL;

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body || 'No body'}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchExercises() {
  const response = await fetch(`${API_BASE_URL}/exercises`);
  return parseJson<{ exercises: FmsExercise[] }>(response);
}

export async function createAnalysisJob(params: {
  uri: string;
  name?: string;
  mimeType?: string;
  /** FMS test id, e.g. 'deep_squat'. */
  exercise: FmsTestId;
  /** Self-reported pain during the movement forces a score of 0. */
  pain?: boolean;
  /** Calibration used by shoulder_mobility scoring; server defaults apply when omitted. */
  handLengthIn?: number;
  shoulderWidthIn?: number;
}) {
  const file = new File(params.uri);
  const parameters: Record<string, string> = { exercise: params.exercise };
  if (params.pain !== undefined) {
    parameters.pain = String(params.pain);
  }
  if (params.handLengthIn !== undefined) {
    parameters.hand_length_in = String(params.handLengthIn);
  }
  if (params.shoulderWidthIn !== undefined) {
    parameters.shoulder_width_in = String(params.shoulderWidthIn);
  }

  const uploadTask = file.createUploadTask(`${API_BASE_URL}/analysis/jobs`, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: params.mimeType ?? file.type ?? 'video/mp4',
    parameters,
  });

  const result = await uploadTask.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Request failed (${result.status}): ${result.body || 'No body'}`);
  }

  return JSON.parse(result.body) as AnalysisJob;
}

export async function fetchAnalysisJob(jobId: string) {
  const response = await fetch(`${API_BASE_URL}/analysis/jobs/${jobId}`);
  return parseJson<AnalysisJob>(response);
}

export { API_BASE_URL };
