// Google Drive sync configuration. The client_id is PUBLIC (sent in the OAuth
// URL) — safe to commit. No client secret is used (token/implicit flow).

export const CLIENT_ID = '449476440421-d4el38pj7krkjs1brdtnt07pv8eis6el.apps.googleusercontent.com';

// drive.file = the app can only see files it created/opened — least privilege.
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// The single JSON blob we keep in the user's Drive.
export const DRIVE_FILENAME = 'local-toby-library.json';

// Periodic background sync cadence (minutes) and push debounce (ms).
export const SYNC_ALARM = 'local-toby-sync';
export const SYNC_PERIOD_MIN = 5;
export const PUSH_DEBOUNCE_MS = 8000;

// Automatic timestamped backups into a Drive folder.
export const BACKUP_ALARM = 'local-toby-backup';
export const BACKUP_PERIOD_MIN = 1440; // daily
export const BACKUP_FOLDER = 'Local Toby Backups';
export const BACKUP_KEEP = 10;

export function isConfigured() {
  return typeof CLIENT_ID === 'string' && CLIENT_ID.endsWith('.apps.googleusercontent.com');
}
