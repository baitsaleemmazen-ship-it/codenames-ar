const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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
// ═══════════════════════════════════════════════
//  MAFIA GAME
// ═══════════════════════════════════════════════
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const mafiaRooms = {}; // code -> room

function genMafiaCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code=Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
  while(mafiaRooms[code]);
  return code;
}

function getRolesForCount(n){
  if(n<=4)  return ['mafia','detective','citizen','citizen'].slice(0,n);
  if(n===5) return ['mafia','mafia','detective','citizen','citizen'];
  if(n===6) return ['mafia','mafia','detective','doctor','citizen','citizen'];
  if(n===7) return ['mafia','mafia','detective','doctor','citizen','citizen','citizen'];
  if(n===8) return ['mafia','mafia','mafia','detective','doctor','guard','citizen','citizen'];
  if(n===9) return ['mafia','mafia','mafia','detective','doctor','guard','citizen','citizen','citizen'];
  return ['mafia','mafia','mafia','detective','doctor','guard','citizen','citizen','citizen','citizen'];
}

function shuffle(a){return [...a].sort(()=>Math.random()-.5)}

function broadcastMafia(code){
  const room=mafiaRooms[code];
  if(!room)return;
  wss.clients.forEach(ws=>{
    if(!ws._mafia||ws._mafia.code!==code||ws.readyState!==1)return;
    const pid=ws._mafia.playerId;
    const me=room.players.find(p=>p.id===pid);
    if(!me)return;

    // Build state filtered for this player
    const state={
      phase:room.phase,
      round:room.round,
      messages:room.messages,
      hostId:room.hostId,
      myName:me.name,
      guardUsed:room.guardUsed,
      myVote:room.votes&&room.votes[pid]?true:false,
      votes:room.voteCount||{},
      players:room.players.map(p=>({
        id:p.id,
        name:p.name,
        alive:p.alive,
        // Only show role if it's the player themselves OR they are mafia and target is also mafia
        role:(p.id===pid||(me.role==='mafia'&&p.role==='mafia'))?p.role:'unknown',
      })),
    };
    ws.send(JSON.stringify({type:'mafia_state',state}));
  });
}

async function aiMessage(room, prompt){
  try {
    const resp=await anthropic.messages.create({
      model:'claude-sonnet-4-6',
      max_tokens:400,
      messages:[{role:'user',content:prompt}],
    });
    const text=resp.content[0].text;
    room.messages.push({type:'ai',text});
    broadcastMafia(room.code);
    return text;
  } catch(e){
    const text='[الهوست صامت للحظة...]';
    room.messages.push({type:'ai',text});
    broadcastMafia(room.code);
    return text;
  }
}

async function startNight(room){
  room.phase='night';
  room.nightActions={};
  room.messages.push({type:'sys',text:'━━━ 🌙 الليل ━━━'});
  broadcastMafia(room.code);

  const alive=room.players.filter(p=>p.alive).map(p=>p.name).join('، ');
  await aiMessage(room,
    `أنت هوست لعبة مافيا بالعربي. الليلة ${room.round}. الأحياء: ${alive}.
    اكتب رسالة قصيرة وغامضة تعلن بداية الليل (٢-٣ جمل فقط، بأسلوب درامي).`
  );
}

async function processNightEnd(room){
  const alive=room.players.filter(p=>p.alive);
  const mafia=alive.filter(p=>p.role==='mafia');
  const mafiaAction=room.nightActions.mafia;
  const doctorAction=room.nightActions.doctor;
  const detectiveAction=room.nightActions.detective;
  const guardAction=room.nightActions.guard;

  let killed=null, saved=false, detectiveResult=null;

  // Mafia kill
  if(mafiaAction){
    const target=room.players.find(p=>p.id===mafiaAction);
    if(target&&target.alive){
      // Check doctor/guard save
      if(doctorAction===mafiaAction||guardAction===mafiaAction){
        saved=true;
        if(guardAction===mafiaAction) room.guardUsed=true;
      } else {
        target.alive=false;
        killed=target;
        // Broadcast dead file to that player
        wss.clients.forEach(ws=>{
          if(ws._mafia?.code===room.code&&ws._mafia?.playerId===target.id&&ws.readyState===1){
            const killer=mafia[0]?.name||'المافيا';
            ws.send(JSON.stringify({type:'mafia_dead',name:target.name,role:target.role,killer}));
          }
        });
      }
    }
  }

  // Detective result
  if(detectiveAction){
    const target=room.players.find(p=>p.id===detectiveAction);
    if(target){
      detectiveResult={name:target.name,isMafia:target.role==='mafia'};
      wss.clients.forEach(ws=>{
        if(ws._mafia?.code===room.code&&ws._mafia?.playerId===detectiveAction&&ws.readyState!==1)return;
        // send to detective
        const det=room.players.find(p=>p.id===ws._mafia?.playerId&&p.role==='detective');
        if(det&&ws._mafia?.code===room.code&&ws.readyState===1){
          ws.send(JSON.stringify({type:'mafia_detective',
            text:`🔍 ${target.name} هو ${target.role==='mafia'?'مافيا 🔴!':'بريء ✅'}`}));
        }
      });
    }
  }

  // Build AI morning message
  let summary='';
  if(killed) summary=`تم قتل ${killed.name}.`;
  else if(saved) summary=`حاولت المافيا القتل لكن أحد أنقذ الضحية.`;
  else summary=`مرت الليلة بهدوء.`;

  room.phase='day';
  room.round++;
  room.messages.push({type:'sys',text:'━━━ ☀️ الصباح ━━━'});

  await aiMessage(room,
    `أنت هوست لعبة مافيا بالعربي. الصباح جاء. ${summary}
    اكتب إعلان الصباح بأسلوب درامي (٢-٣ جمل). ${killed?`اذكر أن ${killed.name} وُجد ميتاً.`:'قل أن الجميع استيقظ بأمان.'}`
  );

  // Check win
  const aliveAfter=room.players.filter(p=>p.alive);
  const mafiaAlive=aliveAfter.filter(p=>p.role==='mafia').length;
  const civAlive=aliveAfter.filter(p=>p.role!=='mafia').length;

  if(mafiaAlive===0) return endGame(room,'village');
  if(mafiaAlive>=civAlive) return endGame(room,'mafia');

  broadcastMafia(room.code);
}

async function processVoteEnd(room){
  // Count votes
  const voteCounts={};
  room.players.filter(p=>p.alive).forEach(p=>voteCounts[p.id]=0);
  Object.values(room.votes).forEach(targetId=>{
    if(voteCounts[targetId]!==undefined) voteCounts[targetId]++;
  });

  // Find max
  let maxVotes=0,executed=null;
  Object.entries(voteCounts).forEach(([id,v])=>{
    if(v>maxVotes){maxVotes=v;executed=id;}
  });

  if(executed){
    const target=room.players.find(p=>p.id===executed);
    if(target){
      target.alive=false;
      wss.clients.forEach(ws=>{
        if(ws._mafia?.code===room.code&&ws._mafia?.playerId===target.id&&ws.readyState===1){
          ws.send(JSON.stringify({type:'mafia_dead',name:target.name,role:target.role,killer:'التصويت'}));
        }
      });
      await aiMessage(room,
        `أنت هوست لعبة مافيا بالعربي. القرية صوتت وأعدمت ${target.name} الذي كان ${target.role==='mafia'?'مافيا 🔴':'بريئاً 😱'}.
        اكتب رد فعل درامي (٢-٣ جمل).`
      );
    }
  }

  // Check win
  const aliveAfter=room.players.filter(p=>p.alive);
  const mafiaAlive=aliveAfter.filter(p=>p.role==='mafia').length;
  const civAlive=aliveAfter.filter(p=>p.role!=='mafia').length;

  if(mafiaAlive===0) return endGame(room,'village');
  if(mafiaAlive>=civAlive) return endGame(room,'mafia');

  // Continue to night
  room.votes={};room.voteCount={};
  await startNight(room);
}

async function endGame(room,winner){
  room.phase='end';
  await aiMessage(room,
    `أنت هوست لعبة مافيا بالعربي. انتهت اللعبة. ${winner==='mafia'?'المافيا فازت!':'القرية فازت!'}.
    اكتب خطاب نهاية درامي (٢-٣ جمل).`
  );
  wss.clients.forEach(ws=>{
    if(ws._mafia?.code!==room.code||ws.readyState!==1)return;
    ws.send(JSON.stringify({
      type:'mafia_end',
      winner,
      players:room.players.map(p=>({name:p.name,role:p.role,alive:p.alive})),
    }));
  });
}


// ── SINGLE UNIFIED WS HANDLER ──
wss.on('connection', ws => {
  const playerId = uuid();
  ws._meta = { playerId, roomCode: null };
  ws._mafia = { playerId, code: null };

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── MAFIA MESSAGES ──
    if (msg.type?.startsWith('mafia_')) {
      const pid = ws._mafia.playerId;

      if (msg.type === 'mafia_create') {
        const names = msg.names || [];
        if (names.length < 3) return ws.send(JSON.stringify({ type: 'error', msg: 'أقل عدد ٣ لاعبين' }));
        const code = genMafiaCode();
        const shuffledNames = msg.random ? shuffle(names) : names;
        const roles = shuffle(getRolesForCount(shuffledNames.length));
        const players = shuffledNames.map((name, i) => ({ id: uuid(), name, role: roles[i], alive: true, ready: false }));
        players[0].id = pid;
        mafiaRooms[code] = { code, players, phase: 'waiting', round: 1, messages: [], votes: {}, voteCount: {}, guardUsed: false, hostId: pid, nightActions: {} };
        ws._mafia.code = code;
        ws.send(JSON.stringify({ type: 'mafia_created', code, playerId: pid }));
        ws.send(JSON.stringify({ type: 'mafia_waiting', players: players.map(p => ({ id: p.id, name: p.name })) }));
      }

      else if (msg.type === 'mafia_join') {
        const code = msg.code?.toUpperCase();
        if (!mafiaRooms[code]) return ws.send(JSON.stringify({ type: 'error', msg: 'الغرفة مو موجودة' }));
        const room = mafiaRooms[code];
        // find unassigned player slot by name match
        let player = room.players.find(p => p.name === msg.name && !p.connected);
        if (!player) player = room.players.find(p => !p.connected);
        if (player) {
          player.id = pid;
          player.connected = true;
        }
        ws._mafia.code = code;
        ws.send(JSON.stringify({ type: 'mafia_joined', code, playerId: pid }));
        ws.send(JSON.stringify({ type: 'mafia_waiting', players: room.players.map(p => ({ id: p.id, name: p.name })) }));
      }

      else if (msg.type === 'mafia_start') {
        const room = mafiaRooms[ws._mafia.code];
        if (!room || room.hostId !== pid) return;
        room.phase = 'roles';
        room.players.forEach(p => {
          const mafiaTeam = p.role === 'mafia' ? room.players.filter(x => x.role === 'mafia').map(x => x.name) : [];
          wss.clients.forEach(client => {
            if (client._mafia?.playerId === p.id && client.readyState === 1) {
              client.send(JSON.stringify({ type: 'mafia_role', role: p.role, mafiaTeam }));
            }
          });
        });
        const me = room.players.find(p => p.id === pid);
        if (me) {
          const mafiaTeam = me.role === 'mafia' ? room.players.filter(x => x.role === 'mafia').map(x => x.name) : [];
          ws.send(JSON.stringify({ type: 'mafia_role', role: me.role, mafiaTeam }));
        }
      }

      else if (msg.type === 'mafia_ready') {
        const room = mafiaRooms[ws._mafia.code];
        if (!room) return;
        const p = room.players.find(x => x.id === pid);
        if (p) p.ready = true;
        if (room.players.every(x => x.ready) && room.phase === 'roles') await startNight(room);
      }

      else if (msg.type === 'mafia_night_action') {
        const room = mafiaRooms[ws._mafia.code];
        if (!room || room.phase !== 'night') return;
        const me = room.players.find(p => p.id === pid);
        if (!me || !me.alive) return;
        if (me.role === 'mafia') room.nightActions.mafia = msg.targetId;
        else if (me.role === 'detective') room.nightActions.detective = msg.targetId;
        else if (me.role === 'doctor') room.nightActions.doctor = msg.targetId;
        else if (me.role === 'guard' && !room.guardUsed) room.nightActions.guard = msg.targetId;
        const alive = room.players.filter(p => p.alive);
        const hasDetective = alive.some(p => p.role === 'detective');
        const hasDoctor = alive.some(p => p.role === 'doctor');
        const hasGuard = alive.some(p => p.role === 'guard') && !room.guardUsed;
        if (room.nightActions.mafia && (!hasDetective || room.nightActions.detective) && (!hasDoctor || room.nightActions.doctor) && (!hasGuard || room.nightActions.guard)) {
          await processNightEnd(room);
        }
      }

      else if (msg.type === 'mafia_start_vote') {
        const room = mafiaRooms[ws._mafia.code];
        if (!room || room.hostId !== pid) return;
        room.phase = 'vote'; room.votes = {}; room.voteCount = {};
        room.messages.push({ type: 'sys', text: '━━━ 🗳️ التصويت ━━━' });
        await aiMessage(room, 'أنت هوست لعبة مافيا بالعربي. حان وقت التصويت. اكتب دعوة التصويت (جملة واحدة درامية).');
      }

      else if (msg.type === 'mafia_vote') {
        const room = mafiaRooms[ws._mafia.code];
        if (!room || room.phase !== 'vote') return;
        const me = room.players.find(p => p.id === pid);
        if (!me || !me.alive || room.votes[pid]) return;
        room.votes[pid] = msg.targetId;
        room.voteCount = {};
        Object.values(room.votes).forEach(tid => { room.voteCount[tid] = (room.voteCount[tid] || 0) + 1; });
        broadcastMafia(room.code);
        if (Object.keys(room.votes).length >= room.players.filter(p => p.alive).length) await processVoteEnd(room);
      }

      return;
    }

    // ── CODENAMES MESSAGES ──
    const meta = ws._meta;

    if (msg.type === 'create') {
      let code;
      do { code = genCode(); } while (rooms[code]);
      rooms[code] = createGame();
      rooms[code].phase = 'waiting';
      let role = msg.role || 'red-cap';
      if (role === 'random') role = ['red-cap', 'red', 'blue-cap', 'blue'][Math.floor(Math.random() * 4)];
      rooms[code].players[playerId] = { name: msg.name || 'لاعب', role };
      meta.roomCode = code;
      ws.send(JSON.stringify({ type: 'created', code, playerId }));
      broadcast(code);
    }

    else if (msg.type === 'join') {
      const code = msg.code?.toUpperCase();
      if (!rooms[code]) { ws.send(JSON.stringify({ type: 'error', msg: 'الغرفة مو موجودة' })); return; }
      let role = msg.role || 'red';
      if (role === 'random') {
        const players = Object.values(rooms[code].players);
        const roles = ['red-cap', 'red', 'blue-cap', 'blue'];
        const used = players.map(p => p.role);
        const missing = roles.filter(r => !used.includes(r));
        role = missing.length ? missing[Math.floor(Math.random() * missing.length)] : roles[Math.floor(Math.random() * roles.length)];
      }
      rooms[code].players[playerId] = { name: msg.name || 'لاعب', role };
      meta.roomCode = code;
      ws.send(JSON.stringify({ type: 'joined', code, playerId }));
      broadcast(code);
    }

    else if (msg.type === 'hint') {
      const g = rooms[meta.roomCode];
      if (!g || g.phase !== 'hint') return;
      if (g.players[playerId]?.role !== g.team + '-cap') return;
      g.hint = msg.word; g.hintN = msg.n;
      g.guessLeft = msg.n === 0 ? 999 : msg.n + 1;
      g.phase = 'guess';
      broadcast(meta.roomCode);
    }

    else if (msg.type === 'guess') {
      const g = rooms[meta.roomCode];
      if (!g || g.phase !== 'guess') return;
      if (g.players[playerId]?.role !== g.team) return;
      const i = msg.index;
      if (g.revealed[i]) return;
      g.revealed[i] = true;
      const t = g.types[i];
      if (t === 'red') g.redLeft--;
      if (t === 'blue') g.blueLeft--;
      if (t === 'assassin') { g.winner = g.team === 'red' ? 'blue' : 'red'; g.phase = 'end'; }
      else if (g.redLeft === 0) { g.winner = 'red'; g.phase = 'end'; }
      else if (g.blueLeft === 0) { g.winner = 'blue'; g.phase = 'end'; }
      else if (t !== g.team) { g.team = g.team === 'red' ? 'blue' : 'red'; g.phase = 'hint'; g.hint = ''; g.guessLeft = 0; }
      else if (g.guessLeft !== 999) { g.guessLeft--; if (g.guessLeft <= 0) { g.team = g.team === 'red' ? 'blue' : 'red'; g.phase = 'hint'; g.hint = ''; g.guessLeft = 0; } }
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
      rooms[code].phase = 'hint';
      broadcast(code);
    }
  });

  ws.on('close', () => {
    const { roomCode, playerId } = ws._meta;
    if (roomCode && rooms[roomCode]) {
      delete rooms[roomCode].players[playerId];
      if (Object.keys(rooms[roomCode].players).length === 0) delete rooms[roomCode];
      else broadcast(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ games server on :${PORT}`));
