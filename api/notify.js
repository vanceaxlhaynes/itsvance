export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};

  // Password check
  if (body.password !== process.env.UPLOAD_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Auth check only
  if (body.action === 'auth') {
    return res.status(200).json({ ok: true });
  }

  // Send notification
  if (body.action === 'send') {
    var dbId = process.env.NOTION_DB_SUBSCRIBERS;
    var resendKey = process.env.RESEND_API_KEY;
    var fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
    var fromName = process.env.FROM_NAME || 'vance being vance';

    if (!dbId || !resendKey) {
      return res.status(500).json({ error: 'missing configuration' });
    }

    try {
      // Fetch all active subscribers (paginate if needed)
      var allSubscribers = [];
      var hasMore = true;
      var startCursor = undefined;

      while (hasMore) {
        var queryBody = {
          filter: {
            property: 'Active',
            checkbox: { equals: true }
          },
          page_size: 100
        };
        if (startCursor) queryBody.start_cursor = startCursor;

        var subRes = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.NOTION_API_KEY,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(queryBody)
        });

        var subData = await subRes.json();
        if (!subRes.ok) {
          console.error('Notion error:', subData);
          return res.status(500).json({ error: 'failed to fetch subscribers' });
        }

        subData.results.forEach(function(page) {
          var email = page.properties.Email?.title?.[0]?.plain_text;
          if (email) allSubscribers.push(email);
        });

        hasMore = subData.has_more;
        startCursor = subData.next_cursor;
      }

      if (allSubscribers.length === 0) {
        return res.status(200).json({ success: true, sent: 0, message: 'no active subscribers' });
      }

      // Build email HTML
      var subject = body.subject || 'something new on vance being vance';
      var message = body.message || '';
      var category = body.category || '';
      var siteUrl = 'https://itsvance.vercel.app';

      var emailHtml = buildEmailHtml(subject, message, category, siteUrl);

      // Send emails via Resend (batch — up to 100 per call)
      var sent = 0;
      var failed = 0;
      var batchSize = 50;

      for (var i = 0; i < allSubscribers.length; i += batchSize) {
        var batch = allSubscribers.slice(i, i + batchSize);

        // Send individually to protect privacy (no BCC exposure)
        for (var j = 0; j < batch.length; j++) {
          try {
            var emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + resendKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: fromName + ' <' + fromEmail + '>',
                to: [batch[j]],
                subject: subject,
                html: emailHtml
              })
            });

            var emailData = await emailRes.json();
            if (emailRes.ok) {
              sent++;
            } else {
              console.error('Resend error for ' + batch[j] + ':', emailData);
              failed++;
            }
          } catch (emailErr) {
            console.error('Send error:', emailErr);
            failed++;
          }
        }
      }

      return res.status(200).json({
        success: true,
        sent: sent,
        failed: failed,
        total: allSubscribers.length
      });

    } catch (err) {
      console.error('Notify error:', err);
      return res.status(500).json({ error: 'something went wrong' });
    }
  }

  return res.status(400).json({ error: 'invalid action' });
}

function buildEmailHtml(subject, message, category, siteUrl) {
  var categoryLine = '';
  if (category) {
    categoryLine = '<p style="font-size:11px;text-transform:uppercase;letter-spacing:3px;color:#9a958e;margin-bottom:24px;">' + escHtml(category) + '</p>';
  }

  var messageLine = '';
  if (message) {
    messageLine = '<p style="font-size:14px;line-height:2;color:#e2ded6;margin-bottom:32px;white-space:pre-line;">' + escHtml(message) + '</p>';
  }

  return '<!DOCTYPE html>' +
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
    categoryLine +
    '<h1 style="font-size:18px;font-weight:normal;color:#e2ded6;margin:0 0 24px 0;line-height:1.6;">' + escHtml(subject) + '</h1>' +
    messageLine +
    '<a href="' + siteUrl + '" style="display:inline-block;border:1px solid #d4c87a;color:#d4c87a;text-decoration:none;padding:10px 28px;font-size:12px;font-family:Consolas,\'Courier New\',Courier,monospace;letter-spacing:1px;">visit the site</a>' +
    '</td></tr>' +

    // Footer
    '<tr><td style="padding-top:32px;border-top:1px solid #333;">' +
    '<p style="font-size:11px;color:#5a5755;margin:0;line-height:1.8;text-align:center;">' +
    'you received this because you subscribed at vance being vance.<br>' +
    'reply to this email if you\'d like to unsubscribe.' +
    '</p>' +
    '</td></tr>' +

    '</table>' +
    '</td></tr></table>' +
    '</body></html>';
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
