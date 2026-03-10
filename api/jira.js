export default async function handler(req, res) {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    return res.status(500).json({ error: 'Jira credentials not configured' });
  }

  const nextPageToken = req.query.nextPageToken || undefined;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const body = {
    jql: 'project = EDF',
    maxResults: 100,
    fields: [
      'summary', 'status', 'assignee', 'issuetype', 'labels',
      'priority', 'duedate', 'timeoriginalestimate', 'timetracking',
      'created', 'parent', 'subtasks'
    ]
  };

  if (nextPageToken) {
    body.nextPageToken = nextPageToken;
  }

  try {
    const response = await fetch('https://useradgents.atlassian.net/rest/api/3/search/jql', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
