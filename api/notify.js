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

      // Build per-subscriber emails with unique unsubscribe links

      // Send emails via Resend (batch — up to 100 per call)
      var sent = 0;
      var failed = 0;
      var batchSize = 50;

      for (var i = 0; i < allSubscribers.length; i += batchSize) {
        var batch = allSubscribers.slice(i, i + batchSize);

        // Send individually to protect privacy (no BCC exposure)
        for (var j = 0; j < batch.length; j++) {
          try {
            var personalHtml = buildEmailHtml(subject, message, category, siteUrl, batch[j]);
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
                html: personalHtml
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

function buildEmailHtml(subject, message, category, siteUrl, subscriberEmail) {
  var unsubUrl = siteUrl + '/api/unsubscribe?email=' + encodeURIComponent(subscriberEmail || '');
  var categoryLine = '';
  if (category) {
    categoryLine = '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;text-transform:uppercase;letter-spacing:3px;color:#9a958e;margin-bottom:24px;">' + escHtml(category) + '</p>';
  }

  var messageLine = '';
  if (message) {
    var msgEsc = escHtml(message).split('\n').join('<br>');
    messageLine = '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:14px;line-height:2.2;color:#e2ded6;margin-bottom:32px;">' + msgEsc + '</p>';
  }

  return '<!DOCTYPE html>' +
    '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#1e1e1e;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;padding:48px 20px;">' +
    '<tr><td align="center">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">' +

    '<tr><td style="padding-bottom:28px;border-bottom:1px solid #333;">' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:12px;color:#7a7775;margin:0;text-align:center;letter-spacing:2px;">vance being vance</p>' +
    '</td></tr>' +

    '<tr><td style="padding:36px 0;">' +
    categoryLine +
    '<h1 style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:16px;font-weight:normal;color:#e2ded6;margin:0 0 24px 0;line-height:1.8;">' + escHtml(subject) + '</h1>' +
    messageLine +
    '<a href="' + siteUrl + '" style="display:inline-block;border:1px solid #d4c87a;color:#d4c87a;text-decoration:none;padding:10px 28px;font-family:Consolas,\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;">visit the site</a>' +
    '</td></tr>' +

    '<tr><td style="padding-top:28px;border-top:1px solid #333;">' +
    '<p style="font-family:Consolas,\'Courier New\',Courier,monospace;font-size:10px;color:#5a5755;margin:0;line-height:2;text-align:center;">' +
    'you received this because you subscribed at vance being vance.<br>' +
    '<a href="' + unsubUrl + '" style="color:#7a7775;text-decoration:underline;">unsubscribe</a>' +
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
