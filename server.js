/**
 * myjd4u 웹메일 백엔드
 * - Zoho IMAP(받기) + SMTP(보내기)에 연결
 * - 로그인 시 입력한 Zoho 이메일 + 앱 전용 비밀번호를 세션(서버 메모리)에 보관
 * - 정적 프런트엔드(public/webmail.html)도 같이 서빙
 *
 * 필요 조건: Zoho Mail Lite 이상(IMAP/SMTP 사용 가능) + 앱 전용 비밀번호
 */
const path = require('path');
const express = require('express');
const session = require('express-session');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Zoho 미국 데이터센터(.zoho.com) 기준 호스트
const IMAP_HOST = 'imap.zoho.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'smtp.zoho.com';
const SMTP_PORT = 465;

app.set('trust proxy', 1); // Render 등 프록시 뒤에서 secure 쿠키 동작
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'please-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // 8시간
  }
}));

function newImap(creds) {
  return new ImapFlow({
    host: IMAP_HOST, port: IMAP_PORT, secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.creds) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

// ---- 로그인: IMAP 접속이 되면 인증 성공으로 처리 ----
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 앱 전용 비밀번호를 입력하세요.' });
  }
  const client = newImap({ email, password });
  try {
    await client.connect();
    await client.logout();
    req.session.creds = { email, password };
    res.json({ ok: true, email });
  } catch (e) {
    res.status(401).json({ error: '로그인 실패. 앱 전용 비밀번호가 맞는지, 플랜이 Mail Lite 이상(IMAP 사용)인지 확인하세요.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.creds) return res.json({ email: req.session.creds.email });
  res.status(401).json({ error: 'no session' });
});

// ---- 받은편지함 목록(최근 25통) ----
app.get('/api/inbox', requireAuth, async (req, res) => {
  const client = newImap(req.session.creds);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists || 0;
      const out = [];
      if (total > 0) {
        const start = Math.max(1, total - 24);
        for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true, flags: true })) {
          const f = msg.envelope.from && msg.envelope.from[0];
          out.push({
            uid: msg.uid,
            fromName: f ? (f.name || f.address) : '',
            fromAddr: f ? f.address : '',
            subject: msg.envelope.subject || '(제목 없음)',
            date: msg.envelope.date,
            seen: msg.flags ? msg.flags.has('\\Seen') : false
          });
        }
      }
      out.reverse(); // 최신순
      res.json({ total, messages: out });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    res.status(500).json({ error: '받은편지함을 불러오지 못했습니다: ' + e.message });
  }
});

// ---- 메일 한 통 읽기 ----
app.get('/api/message/:uid', requireAuth, async (req, res) => {
  const client = newImap(req.session.creds);
  const uid = req.params.uid;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const msg = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
      if (!msg) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' });
      const parsed = await simpleParser(msg.source);
      try { await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); } catch (_) {}
      res.json({
        uid,
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '(제목 없음)',
        date: parsed.date,
        html: parsed.html || null,
        text: parsed.text || ''
      });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    res.status(500).json({ error: '메일을 불러오지 못했습니다: ' + e.message });
  }
});

// ---- 메일 보내기 ----
app.post('/api/send', requireAuth, async (req, res) => {
  const { to, subject, text } = req.body || {};
  if (!to) return res.status(400).json({ error: '받는 사람을 입력하세요.' });
  const creds = req.session.creds;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: true,
      auth: { user: creds.email, pass: creds.password }
    });
    await transporter.sendMail({
      from: creds.email,
      to,
      subject: subject || '',
      text: text || ''
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '전송 실패: ' + e.message });
  }
});

// ---- 정적 프런트엔드 ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'webmail.html')));

app.listen(PORT, () => console.log('webmail running on :' + PORT));
