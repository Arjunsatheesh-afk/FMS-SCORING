export type UserRole = 'doctor' | 'patient';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  displayName: string;
  phoneNumber: string;
  createdBy: number | null;
  createdAt: string;
}

export interface SignInResult {
  token: string;
  user: AuthUser;
}

export interface RegisterPatientInput {
  email: string;
  displayName: string;
  phoneNumber: string;
  /** Omit to use the prototype default of "<phone>.physio". */
  password?: string;
}
