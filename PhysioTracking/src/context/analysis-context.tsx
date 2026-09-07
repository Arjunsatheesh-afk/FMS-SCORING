import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { fetchMyResults } from '@/lib/api';
import { SessionSummary, StoredResult } from '@/types/analysis';

interface AnalysisContextValue {
  latestSession: SessionSummary | null;
  history: SessionSummary[];
  addSession: (session: SessionSummary) => void;
  refresh: () => Promise<void>;
  isHydrated: boolean;
  error: string | null;
}

const AnalysisContext = createContext<AnalysisContextValue | undefined>(undefined);

/** Server row -> the shape every screen already renders. */
function toSession(row: StoredResult): SessionSummary {
  return {
    ...row.result,
    id: row.jobId,
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedByName,
    // Carried through so a patient sees their physio's own score read-only
    // beside the automated one.
    manualScore: row.manualScore,
    manualScoreByName: row.manualScoreByName,
    manualScoreAt: row.manualScoreAt,
  };
}

/**
 * Screening history now comes from the server (GET /me/results) rather than a
 * file on the device, so a doctor and a patient see the same record. Home,
 * feedback and progress all read this one context, which is what keeps them
 * consistent with each other.
 */
export function AnalysisProvider({ children }: PropsWithChildren) {
  const { status, token, user } = useAuth();
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token || user?.role !== 'patient') {
      // Doctors read a specific patient's results instead; there is no
      // meaningful "my own history" for a doctor account.
      setHistory([]);
      setIsHydrated(true);
      return;
    }
    try {
      const rows = await fetchMyResults(token);
      setHistory(rows.map(toSession));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsHydrated(true);
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedOut') {
      // Never leave one account's history on screen for the next sign-in.
      setHistory([]);
      setIsHydrated(true);
      return;
    }
    void refresh();
  }, [status, refresh]);

  /**
   * Shows the just-finished screening immediately; the next refresh replaces
   * it with the stored row.
   *
   * Deliberately a stable useCallback rather than an inline arrow in the memo
   * below. Defined inline it took a new identity on every `history` change,
   * and the recorder's polling effect lists it as a dependency - so the poll
   * interval was torn down and recreated with a fresh 1.5s clock whenever
   * history moved. A functional update needs no dependencies, so this is safe
   * to hold constant.
   */
  const addSession = useCallback((session: SessionSummary) => {
    setHistory((prev) => [session, ...prev]);
  }, []);

  const value = useMemo<AnalysisContextValue>(
    () => ({
      latestSession: history[0] ?? null,
      history,
      addSession,
      refresh,
      isHydrated,
      error,
    }),
    [history, addSession, refresh, isHydrated, error],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis() {
  const context = useContext(AnalysisContext);
  if (!context) {
    throw new Error('useAnalysis must be used within AnalysisProvider');
  }
  return context;
}
