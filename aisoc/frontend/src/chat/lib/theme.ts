/**
 * Single-theme palette for AISOC 1.0.
 *
 * The values mirror the design tokens in design-system/aisoc/MASTER.md (v3,
 * "aisoc-night"). The main purpose today is the A2UI `{theme_color}` message
 * argument: agent-generated HTML deliverables restyle themselves to match the
 * host UI. A theme switcher can layer on top later without protocol changes.
 */

export interface AisocTheme {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  preview: {
    background: string;
    surface: string;
    accent: string;
    text: string;
    muted: string;
    border: string;
  };
}

export const AISOC_NIGHT_THEME: AisocTheme = {
  id: 'aisoc-night',
  name: 'AISOC Night',
  description: 'Deep-space contrast for focused security operations.',
  mode: 'dark',
  preview: {
    background: '#020408',
    surface: '#05080F',
    accent: '#22D3EE',
    text: '#F8FAFC',
    muted: '#94A3B8',
    border: '#1E293B',
  },
};

export function getActiveTheme(): AisocTheme {
  return AISOC_NIGHT_THEME;
}

/**
 * Serialize the active theme for the A2UI `{theme_color}` message argument
 * (consumed by the a2ui instruct template's `<theme>` contract).
 */
export function getThemeMessageArgument(theme: AisocTheme = getActiveTheme()): string {
  return JSON.stringify(
    {
      style: theme.description,
      background_surface: `${theme.preview.background} / ${theme.preview.surface}`,
      accent: theme.preview.accent,
      text_muted: `${theme.preview.text} / ${theme.preview.muted}`,
      border: theme.preview.border,
    },
    null,
    0,
  );
}
