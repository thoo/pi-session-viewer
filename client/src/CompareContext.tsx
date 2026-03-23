import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CompareSessionRef {
  dirName: string;
  filename: string;
  projectTitle?: string;
  timestamp?: string;
}

interface CompareContextValue {
  selected: CompareSessionRef[];
  isSelected: (session: CompareSessionRef) => boolean;
  toggleSelection: (session: CompareSessionRef) => void;
  removeSelection: (session: CompareSessionRef) => void;
  clearSelection: () => void;
  readyToCompare: boolean;
}

const STORAGE_KEY = "pi-session-viewer.compare-selection";

const CompareContext = createContext<CompareContextValue | null>(null);

function sameSession(a: CompareSessionRef, b: CompareSessionRef) {
  return a.dirName === b.dirName && a.filename === b.filename;
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<CompareSessionRef[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSelected(parsed.slice(0, 2));
      }
    } catch {
      // Ignore invalid saved state
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected.slice(0, 2)));
    } catch {
      // Ignore storage errors
    }
  }, [selected]);

  const value = useMemo<CompareContextValue>(() => {
    return {
      selected,
      isSelected: (session) =>
        selected.some((item) => sameSession(item, session)),
      toggleSelection: (session) => {
        setSelected((current) => {
          const exists = current.some((item) => sameSession(item, session));
          if (exists) {
            return current.filter((item) => !sameSession(item, session));
          }
          if (current.length < 2) {
            return [...current, session];
          }
          return [current[1], session];
        });
      },
      removeSelection: (session) => {
        setSelected((current) =>
          current.filter((item) => !sameSession(item, session)),
        );
      },
      clearSelection: () => setSelected([]),
      readyToCompare: selected.length === 2,
    };
  }, [selected]);

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

export function useCompare() {
  const context = useContext(CompareContext);
  if (!context) {
    throw new Error("useCompare must be used within CompareProvider");
  }
  return context;
}
