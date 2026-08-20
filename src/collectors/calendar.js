import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const TOKEN_PATH = path.resolve('.credentials/google-token.json');

/**
 * Initializes and returns the OAuth2 client for Google APIs.
 */
async function getAuthClient(env) {
  const { googleClientId, googleClientSecret, googleRedirectUri } = env;
  
  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured.');
  }

  const oAuth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    googleRedirectUri
  );

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Google OAuth token file not found at ${TOKEN_PATH}. Run setup.js first.`);
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oAuth2Client.setCredentials(token);

  // Automatically save refreshed tokens
  oAuth2Client.on('tokens', (newTokens) => {
    try {
      const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      const updatedToken = { ...currentToken, ...newTokens };
      fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedToken, null, 2), 'utf-8');
    } catch (err) {
      console.error('Warning: Failed to save refreshed Google OAuth tokens:', err.message);
    }
  });

  return oAuth2Client;
}

export default {
  name: 'calendar',
  displayName: 'Google Calendar',
  enabled: true,
  async collect(sinceDate, nowDate, env) {
    // If not configured, gracefully skip
    if (!env.googleClientId || !env.googleClientSecret || !fs.existsSync(TOKEN_PATH)) {
      console.log('[-] Google Calendar is not configured (missing credentials or token). Skipping...');
      return null;
    }

    try {
      const auth = await getAuthClient(env);
      const calendar = google.calendar({ version: 'v3', auth });

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: sinceDate,
        timeMax: nowDate,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      const sinceTime = new Date(sinceDate).getTime();
      const untilTime = new Date(nowDate).getTime();

      const filtered = events.filter(event => {
        const startStr = event.start?.dateTime || event.start?.date;
        if (!startStr) return true;
        const t = new Date(startStr).getTime();
        return t >= sinceTime && t <= untilTime;
      });
      
      return filtered.map(event => ({
        summary: event.summary || '(No Title)',
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        description: event.description || '',
      }));
    } catch (error) {
      console.error('[!] Error collecting from Google Calendar:', error.message);
      return { error: error.message };
    }
  }
};
