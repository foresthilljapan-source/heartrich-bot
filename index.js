const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const client = new line.Client(lineConfig);

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.json({ status: 'ok' });
  const events = req.body.events;
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('handleEvent error:', err);
    }
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' && event.type !== 'postback' && event.type !== 'follow') return;

  const userId = event.source.userId;

  if (event.type === 'follow') {
    await client.replyMessage(event.replyToken, buildMainMenu());
    return;
  }

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

    if (text === '支援記録') {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '支援記録機能は準備中です。'
      });
      return;
    }

    if (text === 'ヒヤリハット') {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ヒヤリハット機能は準備中です。'
      });
      return;
    }

    await client.replyMessage(event.replyToken, buildMainMenu());
    return;
  }

  if (event.type === 'postback') {
    const data = event.postback.data;

    if (data.startsWith('direction_')) {
      const direction = data.replace('direction_', '');

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('office_id', staff.office_id)
        .eq('is_active', true);

      if (!vehicles || vehicles.length === 0) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '車両が登録されていません。管理者にお問い合わせください。'
        });
        return;
      }

      const actions = vehicles.slice(0, 4).map(v => ({
        type: 'postback',
        label: v.name,
        data: `vehicle_${direction}_${v.id}_${v.last_meter}_${v.name}`
      }));

      await client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '車両を選択してください',
        template: {
          type: 'buttons',
          text: `【${direction}】\n車両を選択してください`,
          actions
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

app.get('/', (req, res) => {
  res.json({ status: 'ハートリッチ現場管理ボット稼働中' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
