export default async function handler(req, res) {
  var email = (req.query.email || '').toLowerCase().trim();
  var token = req.query.token || '';

  if (!email || !token) {
    return res.status(400).send(buildPage('invalid link', 'this confirmation link is missing information. try subscribing again.', false));
  }

  var dbId = process.env.NOTION_DB_SUBSCRIBERS;
  var notionHeaders = {
    'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    // 1. Find subscriber by email
    var searchRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: 'Email', title: { equals: email } }
      })
    });
    var searchData = await searchRes.json();

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(404).send(buildPage('not found', 'this email isn\'t in our system. try subscribing again.', false));
    }

    var page = searchData.results[0];
    var storedToken = page.properties.Token?.rich_text?.[0]?.plain_text || '';
    var isActive = page.properties.Active?.checkbox;

    // Already confirmed
    if (isActive) {
      return res.status(200).send(buildPage('already confirmed', 'you\'re already subscribed. nothing else needed.', true));
    }

    // Verify token
    if (storedToken !== token) {
      return res.status(403).send(buildPage('invalid link', 'this confirmation link is invalid or expired. try subscribing again.', false));
    }

    // 2. Activate subscriber
    var updateRes = await fetch('https://api.notion.com/v1/pages/' + page.id, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        properties: {
          'Active': { checkbox: true }
        }
      })
    });

    if (!updateRes.ok) {
      var errData = await updateRes.json();
      console.error('Confirm update error:', JSON.stringify(errData));
      return res.status(500).send(buildPage('error', 'something went wrong. please try again.', false));
    }

    // 3. Send welcome email
    await sendWelcomeEmail(email, notionHeaders);

    return res.status(200).send(buildPage('you\'re in', 'subscription confirmed. welcome to vance being vance.', true));

  } catch (err) {
    console.error('Confirm error:', err.message || err);
    return res.status(500).send(buildPage('error', 'something went wrong. please try again.', false));
  }
}

async function sendWelcomeEmail(toEmail, notionHeaders) {
  var welcomeDbId = process.env.NOTION_DB_WELCOME;
  var resendKey = process.env.RESEND_API_KEY;
  var fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  var fromName = process.env.FROM_NAME || 'vance being vance';

  if (!welcomeDbId || !resendKey) return;

  try {
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

    if (!welRes.ok || !welData.results || !welData.results.length) {
      console.error('Welcome DB empty or error:', JSON.stringify(welData));
      return;
    }

    var props = welData.results[0].properties;
    var subject = (props.Subject && props.Subject.rich_text && props.Subject.rich_text[0] && props.Subject.rich_text[0].plain_text) || 'welcome to vance being vance';
    var body = (props.Body && props.Body.rich_text && props.Body.rich_text[0] && props.Body.rich_text[0].plain_text) || '';

    if (!body) return;

    var siteUrl = 'https://itsvance.vercel.app';
    var unsubUrl = siteUrl + '/api/unsubscribe?email=' + encodeURIComponent(toEmail);

    var bodyEsc = escHtml(body).split('\n').join('<br>');

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
      '<body style="margin:0;padding:0;background:#1e1e1e;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;padding:48px 20px;">' +
      '<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">' +

      '<tr><td style="padding-bottom:28px;border-bottom:1px solid #333;">' +
      '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:12px;color:#7a7775;margin:0;text-align:center;letter-spacing:2px;">vance being vance</p>' +
      '</td></tr>' +

      '<tr><td style="padding:36px 0;">' +
      '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:14px;line-height:2.2;color:#e2ded6;margin:0;">' + bodyEsc + '</p>' +
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
        to: [toEmail],
        subject: subject,
        html: html
      })
    });
    var emailData = await emailRes.json();
    if (!emailRes.ok) {
      console.error('Welcome email Resend error:', JSON.stringify(emailData));
    }
  } catch (err) {
    console.error('Welcome email failed:', err.message || err);
  }
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
