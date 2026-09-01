/**
 * Collector for Linear issue updates and comments
 */
export default {
  name: 'linear',
  displayName: 'Linear',
  enabled: true,
  async collect(sinceDate, nowDate, env) {
    const token = env.linearToken;
    if (!token) {
      console.log('[-] Linear is not configured (missing LINEAR_TOKEN). Skipping...');
      return null;
    }

    try {
      // 1. Get the authenticated user details (Viewer)
      const viewerData = await this.queryLinear(
        `query {
          viewer {
            id
            name
            email
          }
        }`,
        {},
        token
      );

      const viewerId = viewerData?.viewer?.id;
      if (!viewerId) {
        throw new Error('Could not retrieve viewer details from Linear API.');
      }

      // 2. Fetch assigned issues updated between since and until
      const assignedData = await this.queryLinear(
        `query GetAssigned($since: DateTimeOrDuration!, $until: DateTimeOrDuration!) {
          viewer {
            assignedIssues(filter: { updatedAt: { gte: $since, lte: $until } }) {
              nodes {
                id
                identifier
                title
                url
                priority
                priorityLabel
                createdAt
                updatedAt
                state { name }
                creator { id name email }
              }
            }
          }
        }`,
        { since: sinceDate, until: nowDate },
        token
      );

      // 3. Fetch created issues updated between since and until
      const createdData = await this.queryLinear(
        `query GetCreated($since: DateTimeOrDuration!, $until: DateTimeOrDuration!) {
          viewer {
            createdIssues(filter: { updatedAt: { gte: $since, lte: $until } }) {
              nodes {
                id
                identifier
                title
                url
                priority
                priorityLabel
                createdAt
                updatedAt
                state { name }
                creator { id name email }
              }
            }
          }
        }`,
        { since: sinceDate, until: nowDate },
        token
      );

      // 4. Fetch comments written by user between since and until
      const commentsData = await this.queryLinear(
        `query GetComments($userId: ID!, $since: DateTimeOrDuration!, $until: DateTimeOrDuration!) {
          comments(
            filter: {
              user: { id: { eq: $userId } }
              createdAt: { gte: $since, lte: $until }
            }
          ) {
            nodes {
              id
              body
              createdAt
              issue {
                id
                identifier
                title
                url
                priority
                priorityLabel
                createdAt
                updatedAt
                state { name }
                creator { id name email }
              }
            }
          }
        }`,
        { userId: viewerId, since: sinceDate, until: nowDate },
        token
      );

      // Merge issues to build a unified list of active issues
      const issuesMap = new Map();
      const sinceTime = new Date(sinceDate).getTime();
      const untilTime = new Date(nowDate).getTime();

      const inRange = (isoStr) => {
        if (!isoStr) return false;
        const t = new Date(isoStr).getTime();
        return t >= sinceTime && t <= untilTime;
      };

      const addIssue = (issue, source) => {
        if (!issue) return;
        if (!issuesMap.has(issue.id)) {
          const isCreatedByUser = issue.creator ? issue.creator.id === viewerId : false;
          const isCreatedInTimeframe = inRange(issue.createdAt) && isCreatedByUser;

          issuesMap.set(issue.id, {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            url: issue.url,
            priority: issue.priority,
            priorityLabel: issue.priorityLabel || 'No priority',
            state: issue.state?.name || 'Unknown',
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            creatorName: issue.creator?.name || 'Unknown',
            creatorEmail: issue.creator?.email || '',
            isCreatedByUser,
            isCreatedInTimeframe,
            activities: [],
            comments: []
          });
        }
        const record = issuesMap.get(issue.id);
        if (source && !record.activities.includes(source)) {
          record.activities.push(source);
        }
      };

      const assignedIssues = (assignedData?.viewer?.assignedIssues?.nodes || []).filter(i => inRange(i.updatedAt));
      assignedIssues.forEach(issue => addIssue(issue, 'Assigned to you (updated in this timeframe)'));

      const createdIssues = (createdData?.viewer?.createdIssues?.nodes || []).filter(i => inRange(i.updatedAt));
      createdIssues.forEach(issue => {
        const isNewlyCreated = inRange(issue.createdAt);
        const sourceLabel = isNewlyCreated
          ? 'Created by you in this timeframe'
          : 'Created by you previously (updated in this timeframe)';
        addIssue(issue, sourceLabel);
      });

      const comments = (commentsData?.comments?.nodes || []).filter(c => inRange(c.createdAt));
      comments.forEach(comment => {
        if (comment.issue) {
          addIssue(comment.issue, 'Commented on by you in this timeframe');
          const record = issuesMap.get(comment.issue.id);
          record.comments.push({
            body: comment.body,
            createdAt: comment.createdAt
          });
        }
      });

      return Array.from(issuesMap.values());
    } catch (error) {
      console.error('[!] Error collecting from Linear:', error.message);
      return { error: error.message };
    }
  },

  /**
   * Helper function to execute GraphQL queries against the Linear API
   */
  async queryLinear(query, variables, token) {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`Linear API returned status ${response.status}: ${await response.text()}`);
    }

    const resJson = await response.json();
    if (resJson.errors) {
      throw new Error(`GraphQL Errors: ${resJson.errors.map(e => e.message).join(', ')}`);
    }

    return resJson.data;
  }
};
