export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const { type } = req.query;

  const databases = {
    writings:  process.env.NOTION_DB_WRITINGS,
    movies:    process.env.NOTION_DB_MOVIES,
    music:     process.env.NOTION_DB_MUSIC,
    birthdays: process.env.NOTION_DB_BIRTHDAYS
  };

  const dbId = databases[type];
  if (!dbId) {
    return res.status(400).json({ error: 'Invalid type. Use: writings, movies, music, birthdays' });
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          property: 'Published',
          checkbox: { equals: true }
        },
        sorts: [
          { property: 'Order', direction: 'ascending' }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Notion API error:', data);
      return res.status(500).json({ error: 'Notion API error', details: data.message });
    }

    const items = data.results.map(page => {
      const p = page.properties;
      const get = (prop, fallback = '') => {
        const val = p[prop];
        if (!val) return fallback;
        if (val.type === 'title') return val.title?.[0]?.plain_text || fallback;
        if (val.type === 'rich_text') return val.rich_text?.[0]?.plain_text || fallback;
        if (val.type === 'number') return val.number || fallback;
        if (val.type === 'url') return val.url || fallback;
        if (val.type === 'checkbox') return val.checkbox;
        if (val.type === 'select') return val.select?.name || fallback;
        return fallback;
      };

      const item = { title: get('Title') };

      if (type === 'writings') {
        item.type = get('Type');
        item.body = get('Body');
        item.dateLabel = get('Date Label');
        item.imageUrl = get('Image URL');
      } else if (type === 'movies') {
        item.director = get('Director');
        item.year = get('Year');
        item.duration = get('Duration');
        item.stars = get('Stars');
        item.note = get('Note');
        item.posterUrl = get('Poster URL');
      } else if (type === 'music') {
        item.artist = get('Artist');
        item.note = get('Note');
        item.artUrl = get('Art URL');
      } else if (type === 'birthdays') {
        item.greeting = get('Greeting', 'Happy Birthday');
        item.dateLabel = get('Date Label');
        item.photoUrl = get('Photo URL');
      }

      return item;
    });

    return res.status(200).json(items);
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch from Notion' });
  }
}
