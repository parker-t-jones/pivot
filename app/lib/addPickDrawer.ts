/**
 * Desktop add-a-pick stays on the current tab. The wide shell renders the drawer.
 * Phone and medium windows keep the `add-stake` route.
 */
let open = false;
let returnFocus: HTMLElement | null = null;
const listeners = new Set<() => void>();
const savedListeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeAddPick(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAddPickOpen(): boolean {
  return open;
}

export function openAddPick(): void {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    returnFocus = document.activeElement;
  }
  open = true;
  emit();
}

export function closeAddPick(): void {
  open = false;
  emit();
}

export function takeAddPickReturnFocus(): HTMLElement | null {
  const node = returnFocus;
  returnFocus = null;
  return node;
}

export function subscribeAddPickSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

export function notifyAddPickSaved(): void {
  for (const listener of savedListeners) listener();
}

export function resetAddPickForTests(): void {
  open = false;
  returnFocus = null;
  listeners.clear();
  savedListeners.clear();
}
