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

  if (!dbId) {
    return res.status(500).json({ error: 'subscriber database not configured' });
  }

  var notionHeaders = {
    'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    // 1. Check if already exists
    var searchRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: { property: 'Email', title: { equals: email } }
      })
    });
    var searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      var existing = searchData.results[0];
      var isActive = existing.properties.Active?.checkbox;
      if (isActive) {
        return res.status(200).json({ success: true, message: 'already subscribed' });
      }
      // Exists but not confirmed — resend confirmation
      await sendConfirmationEmail(email, resendKey);
      return res.status(200).json({ success: true, pending: true });
    }

    // 2. Generate a simple token
    var token = generateToken();

    // 3. Create subscriber with Active = false (unconfirmed) and store token
    var createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Email': { title: [{ text: { content: email } }] },
          'Subscribed At': { rich_text: [{ text: { content: new Date().toISOString().split('T')[0] } }] },
          'Token': { rich_text: [{ text: { content: token } }] },
          'Active': { checkbox: false }
        }
      })
    });
    var createData = await createRes.json();

    if (!createRes.ok) {
      console.error('Notion create error:', JSON.stringify(createData));
      return res.status(500).json({ error: 'failed to subscribe' });
    }

    // 4. Send confirmation email
    if (resendKey) {
      await sendConfirmationEmail(email, resendKey, token);
    }

    return res.status(200).json({ success: true, pending: true });
  } catch (err) {
    console.error('Subscribe error:', err.message || err);
    return res.status(500).json({ error: 'something went wrong' });
  }
}

function generateToken() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function sendConfirmationEmail(email, resendKey, token) {
  var siteUrl = 'https://itsvance.vercel.app';
  var confirmUrl = siteUrl + '/api/confirm?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token || '');
  var fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  var fromName = process.env.FROM_NAME || 'vance being vance';

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#1e1e1e;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;padding:48px 20px;">' +
    '<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">' +

    '<tr><td style="padding-bottom:28px;border-bottom:1px solid #333;">' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:12px;color:#7a7775;margin:0;text-align:center;letter-spacing:2px;">vance being vance</p>' +
    '</td></tr>' +

    '<tr><td style="padding:36px 0;text-align:center;">' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:14px;line-height:2.2;color:#e2ded6;margin:0 0 32px 0;">hey — just one quick step.<br>tap below to confirm your subscription.</p>' +
    '<a href="' + confirmUrl + '" style="display:inline-block;border:1px solid #d4c87a;color:#d4c87a;text-decoration:none;padding:12px 32px;font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;">confirm subscription</a>' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;color:#5a5755;margin-top:28px;line-height:2;">if you didn\'t sign up, just ignore this.</p>' +
    '</td></tr>' +

    '<tr><td style="padding-top:28px;border-top:1px solid #333;">' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:10px;color:#5a5755;margin:0;line-height:2;text-align:center;">vance being vance</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  try {
    var emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromName + ' <' + fromEmail + '>',
        to: [email],
        subject: 'confirm your subscription — vance being vance',
        html: html
      })
    });
    var emailData = await emailRes.json();
    if (!emailRes.ok) {
      console.error('Confirmation email error:', JSON.stringify(emailData));
    }
  } catch (err) {
    console.error('Confirmation email failed:', err.message || err);
  }
}
