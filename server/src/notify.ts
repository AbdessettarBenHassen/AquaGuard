// Outbound notifications. Both are best-effort and never block an API call.
//  - Push: Expo push service, to every phone of the home (needs the installed APK).
//  - SMS: Twilio, only if TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM are configured.

export async function sendPush(tokens: string[], title: string, body: string, urgent: boolean) {
  if (tokens.length === 0) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title,
          body,
          sound: 'default',
          priority: urgent ? 'high' : 'default',
          channelId: 'aquaguard-alerts',
          interruptionLevel: urgent ? 'time-sensitive' : 'active',
        })),
      ),
    });
  } catch (e) {
    console.error('push failed', e);
  }
}

export async function sendSms(to: string, body: string) {
  const { TWILIO_SID: sid, TWILIO_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!sid || !token || !from || !to) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to.replace(/[^\d+]/g, ''), From: from, Body: body }).toString(),
    });
    return res.ok;
  } catch (e) {
    console.error('sms failed', e);
    return false;
  }
}
