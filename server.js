const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

// ── WORDS ──
const WORDS = [
  'مجلس','قهوة','نخلة','رمل','بحر','سوق','خيمة','ناقة','عطر','هلال',
  'نجمة','قمر','شمس','موج','ريح','ذهب','لؤلؤة','زعفران','هيل','ورد',
  'ياسمين','عود','صقر','حصان','غزال','أسد','نمر','برج','قلعة','ميناء',
  'جسر','جبل','بستان','مطبخ','مسجد','سيف','طبل','كتاب','مفتاح','باب',
  'شاي','عسل','زيت','ملح','رمان','سفينة','فنار','صحراء','لبان','خنجر',
  'دله','تمر','قرفة','كمون','فنجان','مشب','ربع','غيم','مطر','برق',
  'فضة','مرجان','عنبر','رباب','دف','قوس','سهم','درع','رمح','طاووس',
  'أرنب','ذئب','ثعلب','طريق','نفق','واد','حديقة','ملعب','متحف','فندق',
  'مطار','ميدان','قلم','ورقة','نافذة','سقف','أرض','جدار','سلم','حليب',
  'فلفل','بصل','ثوم','ليمون','زنجبيل','كركم','سمسم','زبيب','تين','توت',
  'مشمش','برتقال','جوز','فستق','بندق','لوز','كاجو','حبهان','قرنفل','بخور',
  'دخن','مدفع','طائر','نحل','فراشة','دولفين','حوت','نسر','باز','حمام',
  'بلبل','قبة','مئذنة','بوابة','صرح','نافورة','بئر','خزان','قناة','حقل',
  'مزرعة','تل','هضبة','كهف','غابة','شلال','بركة','خليج','جزيرة','مضيق',
  'شعاب','قاع','شراع','صياد','مرسى','نسيم','سحاب','ضباب','صخرة','لجة',
];

// ── ROOMS ──
const rooms = {}; // roomCode -> gameState
const clients = {}; // ws -> { roomCode, playerId, role }

function shuffle(arr) { return [...arr].sort(() => Math.random() - .5); }

function createGame() {
  const words = shuffle(WORDS).slice(0, 25);
  const redFirst = Math.random() < .5;
  const rc = redFirst ? 9 : 8, bc = redFirst ? 8 : 9;
  const types = [
    ...Array(rc).fill('red'),
    ...Array(bc).fill('blue'),
    ...Array(7).fill('neutral'),
    'assassin'
  ];
  shuffle(types);
  // re-shuffle in place
  for(let i=types.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [types[i],types[j]]=[types[j],types[i]];
  }

  return {
    words,
    types,
    revealed: new Array(25).fill(false),
    team: redFirst ? 'red' : 'blue',
    redLeft: rc,
    blueLeft: bc,
    phase: 'hint', // hint | guess
    hint: '',
    hintN: 0,
    guessLeft: 0,
    winner: null,
    players: {}, // playerId -> { name, role: 'red-cap'|'red'|'blue-cap'|'blue' }
  };
}

function roomState(room, playerId) {
  const g = rooms[room];
  if (!g) return null;
  const role = g.players[playerId]?.role || 'red';
  const isCap = role === 'red-cap' || role === 'blue-cap';

  return {
    words: g.words,
    types: isCap ? g.types : null, // only captains see types
    revealed: g.revealed,
    team: g.team,
    redLeft: g.redLeft,
    blueLeft: g.blueLeft,
    phase: g.phase,
    hint: g.hint,
    hintN: g.hintN,
    guessLeft: g.guessLeft,
    winner: g.winner,
    players: g.players,
    myRole: role,
    myId: playerId,
  };
}

function broadcast(roomCode, excludeId = null) {
  const room = rooms[roomCode];
  if (!room) return;
  for (const [ws, meta] of Object.entries(clients)) {
    // clients is keyed by a symbol, iterate wss.clients
  }
  wss.clients.forEach(ws => {
    if (ws.readyState !== 1) return;
    const meta = ws._meta;
    if (!meta || meta.roomCode !== roomCode) return;
    const state = roomState(roomCode, meta.playerId);
    ws.send(JSON.stringify({ type: 'state', state }));
  });
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

// ── WS ──
wss.on('connection', ws => {
  const playerId = uuid();
  ws._meta = { playerId, roomCode: null };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = ws._meta;

    if (msg.type === 'create') {
      let code;
      do { code = genCode(); } while (rooms[code]);
      rooms[code] = createGame();
      const role = msg.role || 'red-cap';
      rooms[code].players[playerId] = { name: msg.name || 'لاعب', role };
      meta.roomCode = code;
      ws.send(JSON.stringify({ type: 'created', code, playerId }));
      broadcast(code);
    }

    else if (msg.type === 'join') {
      const code = msg.code?.toUpperCase();
      if (!rooms[code]) {
        ws.send(JSON.stringify({ type: 'error', msg: 'الغرفة مو موجودة' }));
        return;
      }
      const role = msg.role || 'red';
      rooms[code].players[playerId] = { name: msg.name || 'لاعب', role };
      meta.roomCode = code;
      ws.send(JSON.stringify({ type: 'joined', code, playerId }));
      broadcast(code);
    }

    else if (msg.type === 'hint') {
      const g = rooms[meta.roomCode];
      if (!g || g.phase !== 'hint') return;
      const myRole = g.players[playerId]?.role;
      if (myRole !== g.team + '-cap') return;
      g.hint = msg.word;
      g.hintN = msg.n;
      g.guessLeft = msg.n === 0 ? 999 : msg.n + 1;
      g.phase = 'guess';
      broadcast(meta.roomCode);
    }

    else if (msg.type === 'guess') {
      const g = rooms[meta.roomCode];
      if (!g || g.phase !== 'guess') return;
      const myRole = g.players[playerId]?.role;
      // only current team non-cap can guess
      if (myRole !== g.team) return;
      const i = msg.index;
      if (g.revealed[i]) return;
      g.revealed[i] = true;
      const t = g.types[i];
      if (t === 'red') g.redLeft--;
      if (t === 'blue') g.blueLeft--;

      if (t === 'assassin') {
        g.winner = g.team === 'red' ? 'blue' : 'red';
        g.phase = 'end';
      } else if (g.redLeft === 0) {
        g.winner = 'red'; g.phase = 'end';
      } else if (g.blueLeft === 0) {
        g.winner = 'blue'; g.phase = 'end';
      } else if (t !== g.team) {
        // wrong — switch
        g.team = g.team === 'red' ? 'blue' : 'red';
        g.phase = 'hint'; g.hint = ''; g.guessLeft = 0;
      } else {
        if (g.guessLeft !== 999) {
          g.guessLeft--;
          if (g.guessLeft <= 0) {
            g.team = g.team === 'red' ? 'blue' : 'red';
            g.phase = 'hint'; g.hint = ''; g.guessLeft = 0;
          }
        }
      }
      broadcast(meta.roomCode);
    }

    else if (msg.type === 'pass') {
      const g = rooms[meta.roomCode];
      if (!g || g.phase !== 'guess') return;
      g.team = g.team === 'red' ? 'blue' : 'red';
      g.phase = 'hint'; g.hint = ''; g.guessLeft = 0;
      broadcast(meta.roomCode);
    }

    else if (msg.type === 'restart') {
      const code = meta.roomCode;
      if (!rooms[code]) return;
      const players = rooms[code].players;
      rooms[code] = createGame();
      rooms[code].players = players;
      broadcast(code);
    }
  });

  ws.on('close', () => {
    const { roomCode, playerId } = ws._meta;
    if (roomCode && rooms[roomCode]) {
      delete rooms[roomCode].players[playerId];
      if (Object.keys(rooms[roomCode].players).length === 0) {
        delete rooms[roomCode];
      } else {
        broadcast(roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ codenames-ar on :${PORT}`));
