export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  var dbId = process.env.NOTION_DB_SUBSCRIBERS;
  if (!dbId) {
    return res.status(200).json({ count: 0 });
  }

  try {
    var total = 0;
    var hasMore = true;
    var startCursor = undefined;

    while (hasMore) {
      var queryBody = {
        filter: { property: 'Active', checkbox: { equals: true } },
        page_size: 100
      };
      if (startCursor) queryBody.start_cursor = startCursor;

      var response = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(queryBody)
      });

      var data = await response.json();
      if (!response.ok) break;

      total += data.results.length;
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    return res.status(200).json({ count: total });
  } catch (err) {
    return res.status(200).json({ count: 0 });
  }
}
