export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var email = req.body && req.body.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }

  var dbId = process.env.NOTION_DB_SUBSCRIBERS;
  if (!dbId) {
    return res.status(500).json({ error: 'subscriber database not configured' });
  }

  try {
    // Check if email already exists
    var searchRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          property: 'Email',
          title: { equals: email.toLowerCase() }
        }
      })
    });

    var searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      return res.status(200).json({ success: true, message: 'already subscribed' });
    }

    // Add new subscriber
    var createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Email': {
            title: [{ text: { content: email.toLowerCase() } }]
          },
          'Subscribed At': {
            rich_text: [{ text: { content: new Date().toISOString().split('T')[0] } }]
          },
          'Active': {
            checkbox: true
          }
        }
      })
    });

    var createData = await createRes.json();

    if (!createRes.ok) {
      console.error('Notion create error:', createData);
      return res.status(500).json({ error: 'failed to subscribe' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: 'something went wrong' });
  }
}
