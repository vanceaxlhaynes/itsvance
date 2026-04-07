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

  var notionHeaders = {
    'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    // Check if email already exists
    var searchRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: 'Email', title: { equals: email.toLowerCase() } }
      })
    });

    var searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      return res.status(200).json({ success: true, message: 'already subscribed' });
    }

    // Add new subscriber
    var createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Email': { title: [{ text: { content: email.toLowerCase() } }] },
          'Subscribed At': { rich_text: [{ text: { content: new Date().toISOString().split('T')[0] } }] },
          'Active': { checkbox: true }
        }
      })
    });

    var createData = await createRes.json();

    if (!createRes.ok) {
      console.error('Notion create error:', createData);
      return res.status(500).json({ error: 'failed to subscribe' });
    }

    // Send welcome email (don't block subscription if this fails)
    sendWelcomeEmail(email.toLowerCase(), notionHeaders).catch(function(err) {
      console.error('Welcome email error:', err);
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: 'something went wrong' });
  }
}

async function sendWelcomeEmail(toEmail, notionHeaders) {
  var welcomeDbId = process.env.NOTION_DB_WELCOME;
  var resendKey = process.env.RESEND_API_KEY;
  var fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  var fromName = process.env.FROM_NAME || 'vance being vance';

  if (!welcomeDbId || !resendKey) return;

  // Fetch welcome email content from Notion
  var welRes = await fetch('https://api.notion.com/v1/databases/' + welcomeDbId + '/query', {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify({
      filter: { property: 'Published', checkbox: { equals: true } },
      sorts: [{ property: 'Order', direction: 'ascending' }],
      page_size: 1
    })
  });

  var welData = await welRes.json();
  if (!welRes.ok || !welData.results || !welData.results.length) return;

  var page = welData.results[0];
  var p = page.properties;

  var subject = p.Subject?.rich_text?.[0]?.plain_text || p.Title?.title?.[0]?.plain_text || 'welcome to vance being vance';
  var body = p.Body?.rich_text?.[0]?.plain_text || '';

  if (!body) return;

  var siteUrl = 'https://itsvance.vercel.app';

  // Build email — convert newlines to <br> for HTML
  var bodyHtml = escHtml(body).replace(/\n/g, '<br>');

  var html = '<!DOCTYPE html>' +
    '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#1e1e1e;font-family:Consolas,\'Courier New\',Courier,monospace;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;padding:40px 20px;">' +
    '<tr><td align="center">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">' +

    // Header
    '<tr><td style="padding-bottom:32px;border-bottom:1px solid #333;">' +
    '<p style="font-size:13px;color:#7a7775;margin:0;text-align:center;">vance being vance</p>' +
    '</td></tr>' +

    // Body
    '<tr><td style="padding:40px 0;">' +
    '<p style="font-size:14px;line-height:2.2;color:#e2ded6;margin:0;white-space:pre-line;">' + bodyHtml + '</p>' +
    '<br><br>' +
    '<a href="' + siteUrl + '" style="display:inline-block;border:1px solid #d4c87a;color:#d4c87a;text-decoration:none;padding:10px 28px;font-size:12px;font-family:Consolas,\'Courier New\',Courier,monospace;letter-spacing:1px;">visit the site</a>' +
    '</td></tr>' +

    // Footer
    '<tr><td style="padding-top:32px;border-top:1px solid #333;">' +
    '<p style="font-size:11px;color:#5a5755;margin:0;line-height:1.8;text-align:center;">' +
    'you received this because you subscribed at vance being vance.<br>' +
    'reply to this email if you\'d like to unsubscribe.' +
    '</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  // Send via Resend
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + resendKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromName + ' <' + fromEmail + '>',
      to: [toEmail],
      subject: subject,
      html: html
    })
  });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
