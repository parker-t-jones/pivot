import { describe, expect, it, vi } from 'vitest';

import { TeamBadge } from './TeamBadge';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: <T>(styles: T): T => styles,
  },
}));

interface ElementNode {
  type: string;
  props: {
    accessibilityLabel?: string;
    children?: ElementNode | string;
  };
}

function elementNode(value: ReturnType<typeof TeamBadge>): ElementNode {
  return value as unknown as ElementNode;
}

describe('TeamBadge', () => {
  it('renders the abbreviation and the team name as the accessible label', () => {
    const badge = elementNode(TeamBadge({ abbr: 'kc', size: 'md' }));
    expect(badge.type).toBe('View');
    expect(badge.props.accessibilityLabel).toBe('Chiefs');
    expect(badge.props.children).toMatchObject({ type: 'Text', props: { children: 'KC' } });
  });

  it('uses the abbreviation as the label when the team is unknown', () => {
    const badge = elementNode(TeamBadge({ abbr: 'wsh', size: 'sm' }));
    expect(badge.props.accessibilityLabel).toBe('WSH');
    expect(badge.props.children).toMatchObject({ type: 'Text', props: { children: 'WSH' } });
  });
});
