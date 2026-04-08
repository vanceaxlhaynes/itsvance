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
  email = email.toLowerCase().trim();

  var dbId = process.env.NOTION_DB_SUBSCRIBERS;
  var resendKey = process.env.RESEND_API_KEY;
  var welcomeDbId = process.env.NOTION_DB_WELCOME;

  if (!dbId) {
    return res.status(500).json({ error: 'subscriber database not configured' });
  }

  try {
    // 1. Check if email already exists
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

    if (searchData.results && searchData.results.length > 0) {
      return res.status(200).json({ success: true, message: 'already subscribed' });
    }

    // 2. Add subscriber to Notion
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
          'Email': { title: [{ text: { content: email } }] },
          'Subscribed At': { rich_text: [{ text: { content: new Date().toISOString().split('T')[0] } }] },
          'Active': { checkbox: true }
        }
      })
    });
    var createData = await createRes.json();

    if (!createRes.ok) {
      console.error('Notion create error:', JSON.stringify(createData));
      return res.status(500).json({ error: 'failed to subscribe' });
    }

    // 3. Send welcome email immediately
    if (resendKey && welcomeDbId) {
      try {
        // Fetch welcome content from Notion
        var welRes = await fetch('https://api.notion.com/v1/databases/' + welcomeDbId + '/query', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filter: { property: 'Published', checkbox: { equals: true } },
            sorts: [{ property: 'Order', direction: 'ascending' }],
            page_size: 1
          })
        });
        var welData = await welRes.json();

        if (welRes.ok && welData.results && welData.results.length > 0) {
          var props = welData.results[0].properties;
          var subject = (props.Subject && props.Subject.rich_text && props.Subject.rich_text[0] && props.Subject.rich_text[0].plain_text) || 'welcome to vance being vance';
          var body = (props.Body && props.Body.rich_text && props.Body.rich_text[0] && props.Body.rich_text[0].plain_text) || '';

          if (body) {
            var siteUrl = 'https://itsvance.vercel.app';
            var unsubUrl = siteUrl + '/api/unsubscribe?email=' + encodeURIComponent(email);
            var fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
            var fromName = process.env.FROM_NAME || 'vance being vance';

            var bodyEsc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var bodyLines = bodyEsc.split('\n').join('<br>');

            var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
              '<body style="margin:0;padding:0;background:#1e1e1e;">' +
              '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;padding:48px 20px;">' +
              '<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">' +

              '<tr><td style="padding-bottom:28px;border-bottom:1px solid #333;">' +
              '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:12px;color:#7a7775;margin:0;text-align:center;letter-spacing:2px;">vance being vance</p>' +
              '</td></tr>' +

              '<tr><td style="padding:36px 0;">' +
              '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:14px;line-height:2.2;color:#e2ded6;margin:0;">' + bodyLines + '</p>' +
              '<br><br>' +
              '<a href="' + siteUrl + '" style="display:inline-block;border:1px solid #d4c87a;color:#d4c87a;text-decoration:none;padding:10px 28px;font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;">visit the site</a>' +
              '</td></tr>' +

              '<tr><td style="padding-top:28px;border-top:1px solid #333;">' +
              '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:10px;color:#5a5755;margin:0;line-height:2;text-align:center;">' +
              'you received this because you subscribed at vance being vance.<br>' +
              '<a href="' + unsubUrl + '" style="color:#7a7775;text-decoration:underline;">unsubscribe</a>' +
              '</p>' +
              '</td></tr>' +

              '</table></td></tr></table></body></html>';

            var emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + resendKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: fromName + ' <' + fromEmail + '>',
                to: [email],
                subject: subject,
                html: html
              })
            });
            var emailData = await emailRes.json();
            if (!emailRes.ok) {
              console.error('Resend error:', JSON.stringify(emailData));
            }
          }
        } else {
          console.error('Welcome DB query failed or empty:', JSON.stringify(welData));
        }
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message || emailErr);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err.message || err);
    return res.status(500).json({ error: 'something went wrong' });
  }
}
