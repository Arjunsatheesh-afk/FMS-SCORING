export type UserRole = 'doctor' | 'patient';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  displayName: string;
  phoneNumber: string;
  createdBy: number | null;
  createdAt: string;
  /**
   * How many screenings this patient has. Only GET /patients returns it, so it
   * is absent on the signed-in user and on a freshly registered patient.
   */
  screeningCount?: number;
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
