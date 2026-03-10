export default async function handler(req, res) {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    return res.status(500).json({ error: 'Jira credentials not configured' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  try {
    // List projects accessible to this token
    const response = await fetch('https://useradgents.atlassian.net/rest/api/3/project/search', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    const projects = (data.values || []).map(p => ({ key: p.key, name: p.name, id: p.id }));
    return res.status(200).json({ totalProjects: projects.length, projects });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
