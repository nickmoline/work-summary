/**
 * Collector for Fathom.video meeting summaries
 */
export default {
  name: 'fathom',
  displayName: 'Fathom.video',
  enabled: true,
  async collect(sinceDate, nowDate, env) {
    const token = env.fathomToken;
    if (!token) {
      console.log('[-] Fathom.video is not configured (missing FATHOM_TOKEN). Skipping...');
      return null;
    }

    try {
      // Build request to list meetings with summaries included
      const url = new URL('https://api.fathom.ai/external/v1/meetings');
      url.searchParams.append('from', sinceDate);
      url.searchParams.append('to', nowDate);
      url.searchParams.append('include_summary', 'true');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Api-Key': token, // Support both common API auth headers for Fathom
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned HTTP status ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const meetings = data.items || [];

      const sinceTime = new Date(sinceDate).getTime();
      const untilTime = new Date(nowDate).getTime();

      const filtered = meetings.filter(meeting => {
        const timeStr = meeting.scheduled_start_time || meeting.recording_start_time || meeting.created_at;
        if (!timeStr) return true;
        const t = new Date(timeStr).getTime();
        return t >= sinceTime && t <= untilTime;
      });

      return filtered.map(meeting => ({
        title: meeting.meeting_title || meeting.title || '(No Title)',
        startTime: meeting.scheduled_start_time || meeting.recording_start_time,
        summary: meeting.default_summary?.markdown_formatted || '',
        url: meeting.share_url || meeting.url || ''
      }));
    } catch (error) {
      console.error('[!] Error collecting from Fathom.video:', error.message);
      return { error: error.message };
    }
  }
};
