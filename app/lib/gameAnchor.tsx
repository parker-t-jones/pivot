import { useEffect, useRef, type ReactNode } from 'react';
import {
  findNodeHandle,
  Platform,
  View,
  type ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Anchor = View;

const anchors = new Map<string, Set<Anchor>>();

export function gameAnchorId(gameId: string): string {
  return `pivot-game-${gameId}`;
}

function remember(gameId: string, node: Anchor): () => void {
  const set = anchors.get(gameId) ?? new Set<Anchor>();
  set.add(node);
  anchors.set(gameId, set);
  return () => {
    set.delete(node);
    if (set.size === 0) anchors.delete(gameId);
  };
}

/** Marks a Home card so a notification can scroll it into view. */
export function GameAnchor({
  gameId,
  children,
  style,
}: {
  gameId: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<Anchor | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return remember(gameId, node);
  }, [gameId]);
  return (
    <View ref={ref} collapsable={false} nativeID={gameAnchorId(gameId)} style={style}>
      {children}
    </View>
  );
}

/** Scroll the Home list so this game's card is in view. False when it is not mounted yet. */
export function scrollGameIntoView(gameId: string, scroll: ScrollView | null): boolean {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return false;
    const node = document.getElementById(gameAnchorId(gameId));
    if (!node) return false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }
  const anchor = anchors.get(gameId)?.values().next().value;
  if (!anchor || !scroll) return false;
  const relative = findNodeHandle(scroll);
  if (relative == null) return false;
  anchor.measureLayout(
    relative,
    (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 16), animated: true }),
    () => undefined,
  );
  return true;
}
