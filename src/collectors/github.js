/**
 * Collector for GitHub Pull Request activity
 */
export default {
  name: 'github',
  displayName: 'GitHub',
  enabled: true,
  async collect(sinceDate, nowDate, env) {
    const token = env.githubToken;
    const username = env.githubUsername;

    if (!token || !username) {
      console.log('[-] GitHub is not configured (missing GITHUB_TOKEN or GITHUB_USERNAME). Skipping...');
      return null;
    }

    try {
      // Use the Search Issues and PRs API
      // Query searches for PRs involving the user updated between sinceDate and nowDate
      const query = `is:pr involves:${username} updated:${sinceDate}..${nowDate}`;
      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.append('q', query);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'work-summary-app', // User-Agent is required by GitHub
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned status ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const items = data.items || [];
      const sinceTime = new Date(sinceDate).getTime();
      const untilTime = new Date(nowDate).getTime();

      const filteredItems = items.filter(item => {
        const itemTime = new Date(item.updated_at).getTime();
        return itemTime >= sinceTime && itemTime <= untilTime;
      });

      return filteredItems.map(item => {
        // Extract repo name (e.g., owner/repo) from repository_url
        // e.g. "https://api.github.com/repos/octocat/Hello-World" -> "octocat/Hello-World"
        const fullRepo = item.repository_url 
          ? item.repository_url.split('/repos/')[1] 
          : 'Unknown Repository';
        const repoShortName = fullRepo.includes('/') ? fullRepo.split('/')[1] : fullRepo;

        return {
          title: item.title || '(No Title)',
          url: item.html_url || '',
          number: item.number,
          state: item.state || 'unknown',
          repository: fullRepo,
          repoShortName: repoShortName,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          author: item.user?.login || 'unknown',
          isAuthor: item.user?.login === username,
        };
      });
    } catch (error) {
      console.error('[!] Error collecting from GitHub:', error.message);
      return { error: error.message };
    }
  }
};
