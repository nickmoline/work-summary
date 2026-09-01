import fs from 'fs';
import path from 'path';

/**
 * Parses local date and time from a transcript filename.
 * Supports patterns such as:
 * - 20260831-1227-jessica-hubley.txt
 * - 20260831_1227_jessica_hubley.txt
 * - 2026-08-31-12-27-jessica-hubley.txt
 * - 2026-08-31-1227-jessica-hubley.txt
 * - 2026-08-31_12-27_jessica_hubley.txt
 * - 20260831-jessica-hubley.txt (defaults to 12:00 PM local time)
 * - 2026-08-31-jessica-hubley.txt (defaults to 12:00 PM local time)
 *
 * @param {string} filename Base name of the file
 * @param {fs.Stats} [fileStats] File stat fallback if filename does not match
 * @returns {{ localDate: Date, title: string }} Parsed local Date and human-readable title
 */
export function parseTranscriptFilename(filename, fileStats = null) {
  const ext = path.extname(filename);
  const baseWithoutExt = path.basename(filename, ext);

  let year, month, day, hours = 12, minutes = 0, seconds = 0;
  let titlePart = '';
  let matched = false;

  // 1. Match YYYYMMDD-HHMM or YYYYMMDD-HHMMSS (or with underscores / dashes)
  // e.g., 20260831-1227-jessica-hubley or 20260831_122730_jessica_hubley
  const yyyymmddHhmmRegex = /^(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(?:(\d{2}))?[-_]?(.*)$/;
  const m1 = baseWithoutExt.match(yyyymmddHhmmRegex);

  if (m1) {
    year = parseInt(m1[1], 10);
    month = parseInt(m1[2], 10);
    day = parseInt(m1[3], 10);
    hours = parseInt(m1[4], 10);
    minutes = parseInt(m1[5], 10);
    if (m1[6]) seconds = parseInt(m1[6], 10);
    titlePart = m1[7] || '';
    matched = true;
  }

  // 2. Match YYYY-MM-DD-HH-MM or YYYY-MM-DD-HHMM or YYYY-MM-DD_HH-MM
  // e.g., 2026-08-31-12-27-jessica-hubley or 2026-08-31-1227-jessica-hubley
  if (!matched) {
    const ymdSeparatedRegex = /^(\d{4})[-_](\d{2})[-_](\d{2})[-_](\d{2})[-_]?(\d{2})(?:[-_]?(\d{2}))?[-_]?(.*)$/;
    const m2 = baseWithoutExt.match(ymdSeparatedRegex);
    if (m2) {
      year = parseInt(m2[1], 10);
      month = parseInt(m2[2], 10);
      day = parseInt(m2[3], 10);
      hours = parseInt(m2[4], 10);
      minutes = parseInt(m2[5], 10);
      if (m2[6]) seconds = parseInt(m2[6], 10);
      titlePart = m2[7] || '';
      matched = true;
    }
  }

  // 3. Match YYYYMMDD or YYYY-MM-DD date-only (defaults to 12:00 PM local time)
  // e.g., 20260831-jessica-hubley or 2026-08-31-jessica-hubley
  if (!matched) {
    const dateOnlyRegex = /^(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(.*)$/;
    const m3 = baseWithoutExt.match(dateOnlyRegex);
    if (m3) {
      year = parseInt(m3[1], 10);
      month = parseInt(m3[2], 10);
      day = parseInt(m3[3], 10);
      titlePart = m3[4] || '';
      matched = true;
    }
  }

  let localDate;
  if (matched) {
    // JavaScript `new Date(year, monthIndex, day, hours, minutes, seconds)` creates a Date in the local timezone
    localDate = new Date(year, month - 1, day, hours, minutes, seconds);
  } else if (fileStats) {
    localDate = new Date(fileStats.mtime || fileStats.birthtime);
    titlePart = baseWithoutExt;
  } else {
    localDate = new Date();
    titlePart = baseWithoutExt;
  }

  // Clean up title
  let cleanTitle = titlePart
    .replace(/^[-_\s]+|[-_\s]+$/g, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (cleanTitle) {
    // Capitalize words in title for better presentation
    cleanTitle = cleanTitle
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } else {
    cleanTitle = `Call Transcript (${localDate.toLocaleDateString('en-US')})`;
  }

  return { localDate, title: cleanTitle };
}

/**
 * Collector for arbitrary phone and meeting transcripts located in arbitrary-transcripts/
 */
export default {
  name: 'transcripts',
  displayName: 'Transcripts',
  enabled: true,
  async collect(sinceDate, nowDate, env) {
    const transcriptsDir = process.env.TRANSCRIPTS_DIR 
      ? path.resolve(process.env.TRANSCRIPTS_DIR) 
      : path.resolve('arbitrary-transcripts');

    if (!fs.existsSync(transcriptsDir)) {
      try {
        fs.mkdirSync(transcriptsDir, { recursive: true });
      } catch (err) {
        console.warn(`[!] Failed to create transcripts directory at ${transcriptsDir}:`, err.message);
        return [];
      }
      return [];
    }

    try {
      const files = fs.readdirSync(transcriptsDir);
      const supportedExts = new Set(['.txt', '.md', '.vtt', '.srt', '.json']);
      const validFiles = files.filter(f => !f.startsWith('.') && supportedExts.has(path.extname(f).toLowerCase()));

      const sinceTime = new Date(sinceDate).getTime();
      const untilTime = new Date(nowDate).getTime();

      const collectedTranscripts = [];

      for (const file of validFiles) {
        const filePath = path.join(transcriptsDir, file);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) continue;

        const { localDate, title } = parseTranscriptFilename(file, stats);
        const fileTime = localDate.getTime();

        // Check if the transcript time falls within the lookback query window
        if (fileTime >= sinceTime && fileTime <= untilTime) {
          const content = fs.readFileSync(filePath, 'utf-8').trim();
          if (!content) continue;

          collectedTranscripts.push({
            title,
            filename: file,
            filePath,
            startTime: localDate.toISOString(),
            localTimeString: localDate.toLocaleString(),
            content
          });
        }
      }

      // Sort chronologically by startTime
      collectedTranscripts.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      return collectedTranscripts;
    } catch (error) {
      console.error('[!] Error collecting arbitrary transcripts:', error.message);
      return { error: error.message };
    }
  }
};
