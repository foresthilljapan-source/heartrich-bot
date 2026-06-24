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

// ユーザーの状態管理
const userStates = {};

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.json({ status: 'ok' });
  const events = req.body.events;
  for (const event of events) {
    await handleEvent(event);
  }
});

async function handleEvent(event) {
  if (event.type === 'follow') {
    await sendMainMenu(event.replyToken, event.source.userId);
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const userId = event.source.userId;
    const text = event.message.text;

    // 職員認証
    const staff = await getStaff(userId);
    if (!staff) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '登録されていません。管理者にお問い合わせください。'
      });
      return;
    }

    // メニュー選択
    if (text === '送迎記録') {
      userStates[userId] = { flow: 'transfer', step: 1, data: { staffId: staff.id, officeId: staff.office_id } };
      await client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '送迎区分を選択してください',
        template: {
          type: 'buttons',
          text: '送迎区分を選択してください',
          actions: [
            { type: 'message', label: '行き', text: '行き' },
            { type: 'message', label: '帰り', text: '帰り' }
          ]
        }
      });
      return;
    }

    if (text === 'メインメニュー') {
      userStates[userId] = {};
      await sendMainMenu(event.replyToken, userId);
      return;
    }

    // フロー処理
    const state = userStates[userId];
    if (state && state.flow === 'transfer') {
      await handleTransferFlow(event, staff, state);
    } else {
      await sendMainMenu(event.replyToken, userId);
    }
  }

  if (event.type === 'postback') {
    const userId = event.source.userId;
    const staff = await getStaff(userId);
    if (!staff) return;
    const state = userStates[userId];
    if (state && state.flow === 'transfer') {
      await handleTransferPostback(event, staff, state);
    }
  }
}

async function handleTransferFlow(event, staff, state) {
  const userId = event.source.userId;
  const text = event.message.text;

  // Step1: 送迎区分
  if (state.step === 1) {
    if (text === '行き' || text === '帰り') {
      state.data.direction = text;
      state.step = 2;

      // 車両一覧を取得
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('office_id', staff.office_id)
        .eq('is_active', true);

      const actions = vehicles.map(v => ({
        type: 'postback',
        label: v.name,
        data: `vehicle_${v.id}_${v.last_meter}_${v.name}`
      }));

      await client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '車両を選択してください',
        template: {
          type: 'buttons',
          text: '車両を選択してください',
          actions: actions.slice(0, 4)
        }
      });
    }
    return;
  }

  // Step3: 終了メーター入力
  if (state.step === 3) {
    const endMeter = parseFloat(text);
    if (isNaN(endMeter)) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '数字で入力してください。\n例：123456'
      });
      return;
    }
    if (endMeter < state.data.startMeter) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `終了メーターは開始メーター(${state.data.startMeter})より大きい数字を入力してください。`
      });
      return;
    }
    state.data.endMeter = endMeter;
    state.data.distance = endMeter - state.data.startMeter;
    state.step = 4;

    // 確認画面
    const userNames = state.data.selectedUserNames.join('・');
    await client.replyMessage(event.replyToken, {
      type: 'template',
      altText: '内容を確認してください',
      template: {
        type: 'confirm',
        text: `【送迎記録確認】\n区分：${state.data.direction}\n車両：${state.data.vehicleName}\n乗車：${userNames}\n開始：${state.data.startMeter}km\n終了：${state.data.endMeter}km\n走行：${state.data.distance}km\n\n送信しますか？`,
        actions: [
          { type: 'postback', label: '送信する', data: 'transfer_confirm' },
          { type: 'postback', label: '修正する', data: 'transfer_cancel' }
        ]
      }
    });
    return;
  }
}

async function handleTransferPostback(event, staff, state) {
  const userId = event.source.userId;
  const data = event.postback.data;

  // 車両選択
  if (data.startsWith('vehicle_')) {
    const parts = data.split('_');
    state.data.vehicleId = parts[1];
    state.data.startMeter = parseFloat(parts[2]);
    state.data.vehicleName = parts[3];
    state.step = 2.5;

    // 利用者一覧を取得
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('office_id', staff.office_id)
      .eq('is_active', true)
      .eq('is_suspended', false);

    state.data.users = users;
    state.data.selectedUserIds = [];
    state.data.selectedUserNames = [];
    state.step = 2.5;

    await sendUserSelection(event.replyToken, users, []);
    return;
  }

  // 利用者選択
  if (data.startsWith('user_')) {
    const userId2 = data.replace('user_', '');
    const user = state.data.users.find(u => u.id === userId2);
    if (user) {
      if (state.data.selectedUserIds.includes(userId2)) {
        state.data.selectedUserIds = state.data.selectedUserIds.filter(id => id !== userId2);
        state.data.selectedUserNames = state.data.selectedUserNames.filter(n => n !== user.name);
      } else {
        state.data.selectedUserIds.push(userId2);
        state.data.selectedUserNames.push(user.name);
      }
    }
    await sendUserSelection(event.replyToken, state.data.users, state.data.selectedUserIds);
    return;
  }

  // 利用者選択完了
  if (data === 'users_done') {
    if (state.data.selectedUserIds.length === 0) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '利用者を1名以上選択してください。'
      });
      return;
    }
    state.step = 3;
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: `開始メーター：${state.data.startMeter}km\n\n終了メーターを入力してください。\n例：123456`
    });
    return;
  }

  // 送信確認
  if (data === 'transfer_confirm') {
    const { error } = await supabase.from('transfer_records').insert({
      office_id: staff.office_id,
      staff_id: staff.id,
      vehicle_id: state.data.vehicleId,
      direction: state.data.direction,
      user_ids: state.data.selectedUserIds,
      start_meter: state.data.startMeter,
      end_meter: state.data.endMeter,
      record_date: new Date().toISOString().split('T')[0]
    });

    if (!error) {
      // 車両のlast_meterを更新
      await supabase.from('vehicles')
        .update({ last_meter: state.data.endMeter })
        .eq('id', state.data.vehicleId);

      userStates[userId] = {};
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '送迎記録を保存しました✅\n\nお疲れ様でした。'
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'エラーが発生しました。もう一度お試しください。'
      });
    }
    return;
  }

  // キャンセル
  if (data === 'transfer_cancel') {
    userStates[userId] = {};
    await sendMainMenu(event.replyToken, userId);
    return;
  }
}

async function sendUserSelection(replyToken, users, selectedIds) {
  const columns = [];
  let actions = users.map(u => ({
    type: 'postback',
    label: (selectedIds.includes(u.id) ? '✅ ' : '') + u.name,
    data: `user_${u.id}`
  }));

  actions.push({ type: 'postback', label: '選択完了', data: 'users_done' });

  // 4つずつに分割して表示
  await client.replyMessage(replyToken, {
    type: 'template',
    altText: '乗車した利用者を選択してください',
    template: {
      type: 'buttons',
      text: `乗車した利用者を選択してください\n選択済み：${selectedIds.length}名`,
      actions: actions.slice(0, 4)
    }
  });
}

async function sendMainMenu(replyToken, lineUserId) {
  await client.replyMessage(replyToken, {
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
  });
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
