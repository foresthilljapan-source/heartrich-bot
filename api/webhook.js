const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const client = new line.Client(lineConfig);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  const signature = req.headers['x-line-signature'];
  if (!line.validateSignature(JSON.stringify(req.body), lineConfig.channelSecret, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({ status: 'ok' });

  const events = req.body.events || [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('Error:', err);
    }
  }
}

async function handleEvent(event) {
  const userId = event.source.userId;

  if (event.type === 'follow') {
    await client.replyMessage(event.replyToken, buildMainMenu());
    return;
  }

  if (event.type !== 'message' && event.type !== 'postback') return;

  const staff = await getStaff(userId);
  if (!staff) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '登録されていません。管理者にお問い合わせください。'
    });
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text;

    if (text === '送迎記録') {
      await client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '送迎区分を選択してください',
        template: {
          type: 'buttons',
          text: '送迎区分を選択してください',
          actions: [
            { type: 'postback', label: '行き', data: 'direction_行き' },
            { type: 'postback', label: '帰り', data: 'direction_帰り' }
          ]
        }
      });
      return;
    }

    await client.replyMessage(event.replyToken, buildMainMenu());
  }
}

function buildMainMenu() {
  return {
    type: 'template',
    altText: 'メインメニュー',
    template: {
      type: 'buttons',
      text: 'ハートリッチ現場管理ボット\n何を記録しますか？',
      actions: [
        { type: 'message', label: '送迎記録', text: '送迎記録' },
        { type: 'message', label: '支援記録', text: '支援記録' },
        { type: 'message', label: 'ヒヤリハット', text: 'ヒヤリハット' },
        { type: 'message', label: 'その他', text: 'その他' }
      ]
    }
  };
}

async function getStaff(lineUserId) {
  const { data } = await supabase
    .from('staffs')
    .select('*')
    .eq('line_user_id', lineUserId)
    .eq('is_active', true)
    .single();
  return data;
}
