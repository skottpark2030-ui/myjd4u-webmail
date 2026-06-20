/**
 * myjd4u 웹메일 백엔드
 * - Zoho IMAP(받기) + SMTP(보내기)
 * - 받은편지함 / 보낸편지함, 메일 읽기, 첨부 다운로드, 첨부 보내기
 * 필요: Zoho Mail Lite 이상(IMAP/SMTP) + 앱 전용 비밀번호
 */
const path = require('path');
const express = require('express');
const session = require('express-session');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const IMAP_HOST = 'imap.zoho.com', IMAP_PORT = 993;
const SMTP_HOST = 'smtp.zoho.com', SMTP_PORT = 465;

app.set('trust proxy', 1);
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'please-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*8 }
}));

function newImap(creds) {
  return new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true,
    auth: { user: creds.email, pass: creds.password }, logger: false });
}
function requireAuth(req, res, next) {
  if (req.session && req.session.creds) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}
// 보낸편지함 경로 찾기 (special-use \Sent 우선)
async function resolveBox(client, which) {
  if (which === 'SENT') {
    try {
      const list = await client.list();
      const s = list.find(m => m.specialUse === '\\Sent') || list.find(m => /^sent/i.test(m.path));
      return s ? s.path : 'Sent';
    } catch (_) { return 'Sent'; }
  }
  return 'INBOX';
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '이메일과 앱 전용 비밀번호를 입력하세요.' });
  const client = newImap({ email, password });
  try {
    await client.connect(); await client.logout();
    req.session.creds = { email, password };
    res.json({ ok: true, email });
  } catch (e) {
    res.status(401).json({ error: '로그인 실패. 앱 전용 비밀번호/IMAP 설정/플랜(Mail Lite 이상)을 확인하세요.' });
  }
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => {
  if (req.session && req.session.creds) return res.json({ email: req.session.creds.email });
  res.status(401).json({ error: 'no session' });
});

// 목록 (받은/보낸)
app.get('/api/messages', requireAuth, async (req, res) => {
  const which = (req.query.box || 'INBOX').toUpperCase();
  const client = newImap(req.session.creds);
  try {
    await client.connect();
    const box = await resolveBox(client, which);
    const lock = await client.getMailboxLock(box);
    try {
      const total = client.mailbox.exists || 0;
      const out = [];
      if (total > 0) {
        const start = Math.max(1, total - 24);
        for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true, flags: true })) {
          const from = msg.envelope.from && msg.envelope.from[0];
          const to = msg.envelope.to && msg.envelope.to[0];
          out.push({
            uid: msg.uid,
            fromName: from ? (from.name || from.address) : '',
            toName: to ? (to.name || to.address) : '',
            subject: msg.envelope.subject || '(제목 없음)',
            date: msg.envelope.date,
            seen: msg.flags ? msg.flags.has('\\Seen') : true
          });
        }
      }
      out.reverse();
      res.json({ box: which, total, messages: out });
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { res.status(500).json({ error: '목록을 불러오지 못했습니다: ' + e.message }); }
});

// 메일 읽기
app.get('/api/message/:uid', requireAuth, async (req, res) => {
  const which = (req.query.box || 'INBOX').toUpperCase();
  const client = newImap(req.session.creds);
  try {
    await client.connect();
    const box = await resolveBox(client, which);
    const lock = await client.getMailboxLock(box);
    try {
      const msg = await client.fetchOne(req.params.uid, { source: true, uid: true }, { uid: true });
      if (!msg) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' });
      const parsed = await simpleParser(msg.source);
      if (which === 'INBOX') { try { await client.messageFlagsAdd(req.params.uid, ['\\Seen'], { uid: true }); } catch (_) {} }
      const atts = (parsed.attachments || [])
        .filter(a => !a.related)
        .map((a, i) => ({ idx: i, filename: a.filename || ('attachment-' + i), type: a.contentType, size: a.size }));
      res.json({
        uid: req.params.uid,
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '(제목 없음)',
        date: parsed.date,
        html: parsed.html || null,
        text: parsed.text || '',
        attachments: atts
      });
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { res.status(500).json({ error: '메일을 불러오지 못했습니다: ' + e.message }); }
});

// 첨부 다운로드
app.get('/api/attachment/:uid', requireAuth, async (req, res) => {
  const which = (req.query.box || 'INBOX').toUpperCase();
  const idx = parseInt(req.query.idx, 10) || 0;
  const client = newImap(req.session.creds);
  try {
    await client.connect();
    const box = await resolveBox(client, which);
    const lock = await client.getMailboxLock(box);
    try {
      const msg = await client.fetchOne(req.params.uid, { source: true, uid: true }, { uid: true });
      if (!msg) return res.status(404).end();
      const parsed = await simpleParser(msg.source);
      const list = (parsed.attachments || []).filter(a => !a.related);
      const att = list[idx];
      if (!att) return res.status(404).end();
      res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(att.filename || 'file')}`);
      res.send(att.content);
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 보내기 (첨부 포함)
app.post('/api/send', requireAuth, async (req, res) => {
  const { to, subject, text, attachments } = req.body || {};
  if (!to) return res.status(400).json({ error: '받는 사람을 입력하세요.' });
  const creds = req.session.creds;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: true,
      auth: { user: creds.email, pass: creds.password }
    });
    const mailAtt = (attachments || []).map(a => ({
      filename: a.filename,
      content: Buffer.from(a.dataBase64 || '', 'base64'),
      contentType: a.contentType || undefined
    }));
    await transporter.sendMail({ from: creds.email, to, subject: subject || '', text: text || '', attachments: mailAtt });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: '전송 실패: ' + e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'webmail.html')));
app.listen(PORT, () => console.log('webmail running on :' + PORT));
