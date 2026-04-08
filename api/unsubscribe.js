export default async function handler(req, res) {
  var email = req.query.email;
  if (!email) {
    return res.status(400).send(buildPage('missing email', 'no email address was provided.', false));
  }

  email = email.toLowerCase().trim();
  var dbId = process.env.NOTION_DB_SUBSCRIBERS;

  if (!dbId) {
    return res.status(500).send(buildPage('error', 'subscriber system not configured.', false));
  }

  try {
    // Find subscriber
    var searchRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: { property: 'Email', title: { equals: email } }
      })
    });
    var searchData = await searchRes.json();

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(200).send(buildPage('not found', 'this email is not in our subscriber list.', false));
    }

    // Set Active to false
    var pageId = searchData.results[0].id;
    var updateRes = await fetch('https://api.notion.com/v1/pages/' + pageId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          'Active': { checkbox: false }
        }
      })
    });

    if (updateRes.ok) {
      return res.status(200).send(buildPage('unsubscribed', 'you\'ve been removed from the mailing list. you won\'t receive any more emails.', true));
    } else {
      var errData = await updateRes.json();
      console.error('Unsubscribe update error:', JSON.stringify(errData));
      return res.status(500).send(buildPage('error', 'something went wrong. please try again.', false));
    }
  } catch (err) {
    console.error('Unsubscribe error:', err.message || err);
    return res.status(500).send(buildPage('error', 'something went wrong. please try again.', false));
  }
}

function buildPage(title, message, success) {
  var accent = success ? '#d4c87a' : '#9a958e';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>' + title + ' — vance being vance</title></head>' +
    '<body style="margin:0;padding:0;background:#1e1e1e;font-family:Consolas,\'Courier New\',Courier,monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;">' +
    '<div style="max-width:400px;padding:2rem;text-align:center;">' +
    '<p style="font-size:12px;color:#7a7775;letter-spacing:2px;margin-bottom:2rem;">vance being vance</p>' +
    '<h1 style="font-size:16px;font-weight:normal;color:' + accent + ';margin-bottom:1.5rem;">' + title + '</h1>' +
    '<p style="font-size:13px;color:#e2ded6;line-height:2;">' + message + '</p>' +
    '<br><br><a href="https://itsvance.vercel.app" style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;color:#7a7775;text-decoration:none;border:1px solid #444;padding:8px 20px;letter-spacing:1px;">← back to site</a>' +
    '</div></body></html>';
}
