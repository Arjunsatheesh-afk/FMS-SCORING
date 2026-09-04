import { File, Paths } from 'expo-file-system';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { SessionSummary } from '@/types/analysis';

const ANALYSIS_HISTORY_STORAGE_KEY = 'physiotracking.analysis.history';
const analysisHistoryFile = new File(Paths.document, `${ANALYSIS_HISTORY_STORAGE_KEY}.json`);

interface AnalysisContextValue {
  latestSession: SessionSummary | null;
  history: SessionSummary[];
  addSession: (session: SessionSummary) => void;
  isHydrated: boolean;
}

const AnalysisContext = createContext<AnalysisContextValue | undefined>(undefined);

export function AnalysisProvider({ children }: PropsWithChildren) {
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      try {
        if (analysisHistoryFile.exists) {
          const storedHistory = await analysisHistoryFile.text();
          if (storedHistory && isMounted) {
            setHistory(JSON.parse(storedHistory) as SessionSummary[]);
          }
        }
      } catch {
        if (isMounted) {
          setHistory([]);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void analysisHistoryFile.write(JSON.stringify(history));
  }, [history, isHydrated]);

  const value = useMemo<AnalysisContextValue>(
    () => ({
      latestSession: history[0] ?? null,
      history,
      addSession: (session) => {
        setHistory((prev) => [session, ...prev]);
      },
      isHydrated,
    }),
    [history, isHydrated],
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
