export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var password = body.password || '';

  // Check password
  if (password !== process.env.UPLOAD_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // Auth check only
  if (body.action === 'auth') {
    return res.status(200).json({ ok: true });
  }

  // Create Notion entry
  if (body.action === 'create') {
    var dbId = process.env.NOTION_DB_LENSES;
    if (!dbId) {
      return res.status(500).json({ success: false, error: 'lenses database not configured' });
    }

    try {
      // Get current count for auto-ordering
      var countRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 1 })
      });
      var countData = await countRes.json();
      var nextOrder = (countData.results?.length || 0) + 1;

      // Create the page
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
            'Title': {
              title: [{ text: { content: body.title || 'untitled' } }]
            },
            'Photo URL': {
              url: body.photoUrl
            },
            'Caption': {
              rich_text: [{ text: { content: body.caption || '' } }]
            },
            'Published': {
              checkbox: true
            },
            'Order': {
              number: nextOrder
            }
          }
        })
      });

      var createData = await createRes.json();

      if (!createRes.ok) {
        console.error('Notion create error:', createData);
        return res.status(500).json({ success: false, error: 'failed to create entry' });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ success: false, error: 'something went wrong' });
    }
  }

  return res.status(400).json({ error: 'invalid action' });
}
