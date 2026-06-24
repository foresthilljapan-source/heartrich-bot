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

  // フォロー時
  if (event.type === 'follow') {
    await client.replyMessage(event.replyToken, buildMainMenu());
    return;
  }

  // 職員認証
  const staff = await getStaff(userId);
  if (!staff) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '登録されていません。管理者にお問い合わせください。'
    });
    return;
  }

  // テキストメッセージ
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

    // デフォルト
    await client.replyMessage(event.replyToken, buildMainMenu());
    return;
  }

  // ポストバック
  if (event.type === 'postback') {
    const data = event.postback.data;

    // 送迎区分選択
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

    // 車両選択
    if (data.startsWith('vehicle_')) {
      const parts = data.split('_');
      const direction = parts[1];
      const vehicleId = parts[2];
      const lastMeter = parts[3];
      const vehicleName = parts[4];

      const { data: users } = await supabase
        .from('users')
        .select('*')
        .eq('office_id', staff.office_id)
        .eq('is_active', true)
        .eq('is_suspended', false);

      if (!users || users.length === 0) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '利用者が登録されていません。管理者にお問い合わせください。'
        });
        return;
      }

      const actions = users.slice(0, 3).map(u => ({
        type: 'postback',
        label: u.name,
        data: `selectuser_${direction}_${vehicleId}_${lastMeter}_${vehicleName}_${u.id}_${u.name}`
      }));

      actions.push({
        type: 'postback',
        label: '選択完了→メーター入力',
        data: `meterinput_${direction}_${vehicleId}_${lastMeter}_${vehicleName}_none_なし`
      });

      await client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '乗車した利用者を選択してください',
        template: {
          type: 'buttons',
          text: `【${direction}】【${vehicleName}】\n乗車した利用者を選択してください`,
          actions
        }
      });
      return;
    }

    // メーター入力案内
    if (data.startsWith('meterinput_')) {
      const parts = data.split('_');
      const direction = parts[1];
      const vehicleId = parts[2];
      const lastMeter = parts[3];
      const vehicleName = parts[4];

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `【送迎記録入力】\n区分：${direction}\n車両：${vehicleName}\n\n終了メーターを数字で入力してください。\n前回終了：${lastMeter}km\n\n例：123456\n\n※入力後に確認画面が表示されます\n※データ：${direction},${vehicleId},${lastMeter},${vehicleName}`
      });
      return;
    }

    // メインメニューに戻る
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

module.exports = app;
