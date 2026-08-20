import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import http from 'http';
import { exec } from 'child_process';
import { google } from 'googleapis';
import 'dotenv/config'; // Loads existing .env if present

const ENV_PATH = path.resolve('.env');
const TOKEN_DIR = path.resolve('.credentials');
const TOKEN_PATH = path.join(TOKEN_DIR, 'google-token.json');

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('=========================================');
  console.log('      Work Summary Generator Setup       ');
  console.log('=========================================');
  console.log('This script will guide you through setting up credentials for Google Calendar, Fathom, Linear, GitHub, and Gemini.');
  console.log('Press Enter to keep current values in brackets [like this].\n');

  // Load existing credentials to pre-fill
  const existingConfig = {
    USER_NAME: process.env.USER_NAME || 'Nick Moline',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    GITHUB_USERNAME: process.env.GITHUB_USERNAME || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    LINEAR_TOKEN: process.env.LINEAR_TOKEN || '',
    FATHOM_TOKEN: process.env.FATHOM_TOKEN || '',
    SLACK_USER_TOKEN: process.env.SLACK_USER_TOKEN || process.env.SLACK_TOKEN || '',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
  };

  const answers = {};

  // 1. Full Name
  const realName = await rl.question(`Your Full Name (used to attribute meeting activity correctly) [${existingConfig.USER_NAME}]: `);
  answers.USER_NAME = realName.trim() || existingConfig.USER_NAME;

  // 2. Gemini API Key
  const geminiInput = await rl.question(`Gemini API Key (get from AI Studio) [${mask(existingConfig.GEMINI_API_KEY)}]: `);
  answers.GEMINI_API_KEY = geminiInput.trim() || existingConfig.GEMINI_API_KEY;

  // 3. Gemini Model
  const geminiModelInput = await rl.question(`Gemini Model [${existingConfig.GEMINI_MODEL}]: `);
  answers.GEMINI_MODEL = geminiModelInput.trim() || existingConfig.GEMINI_MODEL;

  // 3. GitHub Username
  const ghUser = await rl.question(`GitHub Username [${existingConfig.GITHUB_USERNAME}]: `);
  answers.GITHUB_USERNAME = ghUser.trim() || existingConfig.GITHUB_USERNAME;

  // 4. GitHub Token
  const ghToken = await rl.question(`GitHub PAT (Personal Access Token) [${mask(existingConfig.GITHUB_TOKEN)}]: `);
  answers.GITHUB_TOKEN = ghToken.trim() || existingConfig.GITHUB_TOKEN;

  // 5. Linear Token
  const linearToken = await rl.question(`Linear Personal API Key [${mask(existingConfig.LINEAR_TOKEN)}]: `);
  answers.LINEAR_TOKEN = linearToken.trim() || existingConfig.LINEAR_TOKEN;

  // 6. Fathom Token
  const fathomToken = await rl.question(`Fathom.video API Key [${mask(existingConfig.FATHOM_TOKEN)}]: `);
  answers.FATHOM_TOKEN = fathomToken.trim() || existingConfig.FATHOM_TOKEN;

  // 7. Slack User Token
  const slackToken = await rl.question(`Slack User OAuth Token (xoxp-...) [${mask(existingConfig.SLACK_USER_TOKEN)}]: `);
  answers.SLACK_USER_TOKEN = slackToken.trim() || existingConfig.SLACK_USER_TOKEN;

  console.log('\n--- Google Calendar API Credentials ---');
  console.log('To set up Google Calendar:');
  console.log('1. Go to Google Cloud Console (https://console.cloud.google.com).');
  console.log('2. Create a project and enable the "Google Calendar API".');
  console.log('3. Set up the OAuth consent screen (Desktop App).');
  console.log('4. Create OAuth Client Credentials. Set Redirect URI to:');
  console.log('   http://localhost:3000/oauth2callback');
  console.log('5. Copy the Client ID and Client Secret here.');

  const googleClientId = await rl.question(`Google OAuth Client ID [${mask(existingConfig.GOOGLE_CLIENT_ID)}]: `);
  answers.GOOGLE_CLIENT_ID = googleClientId.trim() || existingConfig.GOOGLE_CLIENT_ID;

  const googleClientSecret = await rl.question(`Google OAuth Client Secret [${mask(existingConfig.GOOGLE_CLIENT_SECRET)}]: `);
  answers.GOOGLE_CLIENT_SECRET = googleClientSecret.trim() || existingConfig.GOOGLE_CLIENT_SECRET;

  answers.GOOGLE_REDIRECT_URI = existingConfig.GOOGLE_REDIRECT_URI;

  rl.close();

  // Write .env file
  let envContent = '';
  for (const [key, value] of Object.entries(answers)) {
    envContent += `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
  console.log(`\n[+] Credentials saved to ${ENV_PATH}`);

  // Re-inject into process.env so we can use them in this process
  Object.assign(process.env, answers);

  // Google Calendar OAuth flow
  if (answers.GOOGLE_CLIENT_ID && answers.GOOGLE_CLIENT_SECRET) {
    console.log('\n[*] Initiating Google Calendar Authorization Flow...');
    try {
      await runGoogleOAuth(answers);
      console.log('[+] Google Calendar successfully authorized!');
    } catch (err) {
      console.error('[!] Google authorization failed:', err.message);
    }
  } else {
    console.log('\n[-] Google credentials omitted. Skipping Calendar authorization.');
  }

  // Create Launchd plist scheduling file
  createLaunchDaemon();

  console.log('\n=========================================');
  console.log('         Setup Completed!                ');
  console.log('=========================================');
  console.log('To test the script:');
  console.log('  node index.js --hours 24');
}

/**
 * Runs a local server to handle OAuth redirect from Google and exchange authorization code.
 */
function runGoogleOAuth(config) {
  return new Promise((resolve, reject) => {
    const oAuth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
      prompt: 'consent' // Forces refresh token generation
    });

    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/oauth2callback')) {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const code = urlObj.searchParams.get('code');

        if (code) {
          try {
            const { tokens } = await oAuth2Client.getToken(code);
            
            // Ensure credentials directory exists
            if (!fs.existsSync(TOKEN_DIR)) {
              fs.mkdirSync(TOKEN_DIR, { recursive: true });
            }

            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 100px; background-color: #f7f7f7;">
                  <h1 style="color: #4caf50;">Authentication Successful!</h1>
                  <p style="font-size: 18px;">You have successfully connected Google Calendar.</p>
                  <p>You can close this tab and return to the terminal.</p>
                </body>
              </html>
            `);

            server.close();
            resolve();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Error getting tokens: ${err.message}`);
            server.close();
            reject(err);
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code parameter');
          server.close();
          reject(new Error('OAuth callback missing code.'));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(3000, () => {
      console.log(`\n[>] Open the following URL in your browser to authorize Google Calendar:\n`);
      console.log(authUrl);
      console.log('\n[*] Attempting to open browser page automatically...');
      
      // Auto-open on macOS
      exec(`open "${authUrl}"`);
    });
  });
}

/**
 * Creates the plist file for launchd and shows load instructions.
 */
function createLaunchDaemon() {
  const plistPath = path.resolve('com.user.work-summary.plist');
  const nodePath = process.execPath;
  const scriptPath = path.resolve('index.js');
  const workingDir = process.cwd();

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.work-summary</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <!-- Monday -->
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>30</integer>
        </dict>
        <!-- Tuesday -->
        <dict>
            <key>Weekday</key>
            <integer>2</integer>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>30</integer>
        </dict>
        <!-- Wednesday -->
        <dict>
            <key>Weekday</key>
            <integer>3</integer>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>30</integer>
        </dict>
        <!-- Thursday -->
        <dict>
            <key>Weekday</key>
            <integer>4</integer>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>30</integer>
        </dict>
        <!-- Friday -->
        <dict>
            <key>Weekday</key>
            <integer>5</integer>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>30</integer>
        </dict>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDir}</string>
    <key>StandardOutPath</key>
    <string>${workingDir}/launchd-out.log</string>
    <key>StandardErrorPath</key>
    <string>${workingDir}/launchd-err.log</string>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plistContent, 'utf-8');
  console.log(`\n[+] Created launchd configuration: ${plistPath}`);
  console.log('\n--- Scheduling instructions ---');
  console.log('To schedule this script to run weekdays at 8:30 am and send summaries:');
  console.log('1. Copy the plist file to your LaunchAgents directory:');
  console.log(`   cp com.user.work-summary.plist ~/Library/LaunchAgents/`);
  console.log('2. Load the LaunchAgent:');
  console.log(`   launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.user.work-summary.plist`);
  console.log('   (or: launchctl load ~/Library/LaunchAgents/com.user.work-summary.plist)');
}

function mask(str) {
  if (!str) return 'not set';
  if (str.length <= 8) return '********';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

main().catch(err => {
  console.error('[!] Setup error:', err);
  process.exit(1);
});
