import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Copies string content to the macOS system clipboard using pbcopy.
 * @param {string} text Text to copy
 * @returns {Promise<void>}
 */
export function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pbcopy');
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pbcopy exited with code ${code}`));
      }
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * Saves the summary to a Markdown file inside the summaries/ directory
 * and copies it to the macOS clipboard.
 * @param {string} summary Markdown summary text
 * @param {string} dateStr ISO date string or custom date format for filename
 * @returns {Promise<string>} Saved file path
 */
export async function saveAndNotify(summary, dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Format as YYYY-MM-DD.md which integrates perfectly with Obsidian Daily Notes
  const filename = `${year}-${month}-${day}.md`;
  const outputDir = path.resolve('summaries');
  const filePath = path.join(outputDir, filename);

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save the file
  fs.writeFileSync(filePath, summary, 'utf-8');
  console.log(`[+] Summary successfully saved to: ${filePath}`);

  // Copy to Clipboard
  try {
    await copyToClipboard(summary);
    console.log('[+] Summary copied to macOS clipboard.');
  } catch (err) {
    console.error('[!] Failed to copy summary to clipboard:', err.message);
  }

  return filePath;
}
