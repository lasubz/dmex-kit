export default async function handler(req, res) {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    return res.status(500).json({ error: 'Jira credentials not configured' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  try {
    // Check auth by getting current user
    const meResponse = await fetch('https://useradgents.atlassian.net/rest/api/3/myself', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });
    const meStatus = meResponse.status;
    let me = null;
    if (meResponse.ok) {
      const meData = await meResponse.json();
      me = { displayName: meData.displayName, email: meData.emailAddress, active: meData.active };
    } else {
      me = { error: await meResponse.text() };
    }

    // List projects
    const response = await fetch('https://useradgents.atlassian.net/rest/api/3/project/search', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    let projects = [];
    if (response.ok) {
      const data = await response.json();
      projects = (data.values || []).map(p => ({ key: p.key, name: p.name, id: p.id }));
    }

    return res.status(200).json({
      emailUsed: JIRA_EMAIL,
      tokenPrefix: JIRA_API_TOKEN.substring(0, 10) + '...',
      tokenLength: JIRA_API_TOKEN.length,
      authStatus: meStatus,
      user: me,
      totalProjects: projects.length,
      projects
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
