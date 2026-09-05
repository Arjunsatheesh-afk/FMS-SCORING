import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';

import { AnalysisJob, FmsExercise, FmsTestId, StoredResult } from '@/types/analysis';
import { AuthUser, RegisterPatientInput, SignInResult } from '@/types/auth';

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

async function postJson<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // FastAPI puts the human-readable reason in `detail`.
    let message = `Request failed (${response.status})`;
    try {
      const parsed = await response.json();
      if (typeof parsed?.detail === 'string') {
        message = parsed.detail;
      }
    } catch {
      /* keep the status-only message */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function signIn(email: string, password: string) {
  return postJson<SignInResult>('/auth/login', { email, password });
}

export async function signOut(token: string) {
  return postJson<{ status: string }>('/auth/logout', {}, token);
}

export async function fetchMe(token: string) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson<{ user: AuthUser }>(response);
  return body.user;
}

export async function changePassword(token: string, currentPassword: string, newPassword: string) {
  return postJson<{ status: string }>(
    '/auth/change-password',
    { currentPassword, newPassword },
    token,
  );
}

export async function registerPatient(token: string, input: RegisterPatientInput) {
  const body = await postJson<{ patient: AuthUser }>('/patients', input, token);
  return body.patient;
}

export async function fetchPatients(token: string) {
  const response = await fetch(`${API_BASE_URL}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson<{ patients: AuthUser[] }>(response);
  return body.patients;
}

export async function fetchExercises() {
  const response = await fetch(`${API_BASE_URL}/exercises`);
  return parseJson<{ exercises: FmsExercise[] }>(response);
}

export async function fetchMyResults(token: string) {
  const response = await fetch(`${API_BASE_URL}/me/results`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson<{ results: StoredResult[] }>(response);
  return body.results;
}

export async function fetchPatientResults(token: string, patientId: number) {
  const response = await fetch(`${API_BASE_URL}/patients/${patientId}/results`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<{ patient: AuthUser; results: StoredResult[] }>(response);
}

export async function createAnalysisJob(params: {
  uri: string;
  name?: string;
  mimeType?: string;
  /** FMS test id, e.g. 'deep_squat'. */
  exercise: FmsTestId;
  /** Required: uploads are attributed to a patient server-side. */
  token: string;
  /**
   * Required when a doctor uploads, rejected when a patient names anyone but
   * themselves. Omit for a patient recording their own screening.
   */
  patientId?: number;
  /** Self-reported pain during the movement forces a score of 0. */
  pain?: boolean;
  /** Calibration used by shoulder_mobility scoring; server defaults apply when omitted. */
  handLengthIn?: number;
  shoulderWidthIn?: number;
}) {
  const file = new File(params.uri);
  const parameters: Record<string, string> = { exercise: params.exercise };
  if (params.patientId !== undefined) {
    parameters.patient_id = String(params.patientId);
  }
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
    headers: { Authorization: `Bearer ${params.token}` },
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
