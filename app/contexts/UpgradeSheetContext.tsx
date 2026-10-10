import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

interface UpgradeSheetContextValue {
  isOpen: boolean;
  /** Cap code passed to `openUpgrade`, or null when the sheet was opened with no code. */
  code: string | null;
  openUpgrade: (code?: string) => void;
  closeUpgrade: () => void;
}

const UpgradeSheetContext = createContext<UpgradeSheetContextValue | undefined>(undefined);

/**
 * Global "Upgrade to Pro" sheet state. The actual overlay (`components/UpgradeSheet.tsx`) is
 * mounted once in `(app)/_layout.tsx`; any screen calls `useUpgradeSheet().openUpgrade()` to
 * surface it on top of whatever it's currently showing. Deliberately not a router screen — see
 * `UpgradeSheet`'s docstring.
 */
export function UpgradeSheetProvider({ children }: PropsWithChildren) {
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const openUpgrade = useCallback((nextCode?: string) => {
    setCode(typeof nextCode === 'string' ? nextCode : null);
    setIsOpen(true);
  }, []);
  const closeUpgrade = useCallback(() => {
    setIsOpen(false);
    setCode(null);
  }, []);

  const value = useMemo(
    () => ({ isOpen, code, openUpgrade, closeUpgrade }),
    [isOpen, code, openUpgrade, closeUpgrade],
  );

  return <UpgradeSheetContext.Provider value={value}>{children}</UpgradeSheetContext.Provider>;
}

export function useUpgradeSheet(): UpgradeSheetContextValue {
  const value = useContext(UpgradeSheetContext);
  if (!value) {
    throw new Error('useUpgradeSheet must be used within an UpgradeSheetProvider.');
  }
  return value;
}
