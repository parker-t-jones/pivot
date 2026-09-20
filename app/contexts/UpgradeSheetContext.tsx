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
  openUpgrade: () => void;
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

  const openUpgrade = useCallback(() => setIsOpen(true), []);
  const closeUpgrade = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, openUpgrade, closeUpgrade }),
    [isOpen, openUpgrade, closeUpgrade],
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
