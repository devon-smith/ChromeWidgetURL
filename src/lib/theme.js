// Shared theme application. 'system' clears data-theme (OS decides via
// prefers-color-scheme); 'light'/'dark' force it.

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function applyThemeFromSettings(settings) {
  applyTheme(settings?.theme || 'system');
}
