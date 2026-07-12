const net = require('net');
const tls = require('tls');

function b64(value) {
  return Buffer.from(value).toString('base64');
}

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onErr);
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n');
      if (!buf.endsWith('\r\n')) {
        buf = lines.pop();
      } else {
        buf = '';
      }

      if (lines.length === 0) return;

      const last = lines[lines.length - 1];
      if (last.length >= 4 && last[3] !== ' ') return;

      cleanup();
      const code = parseInt(last, 10);
      if (code >= 400) reject(new Error(last));
      else resolve(lines.join('\n'));
    };
    const onErr = (err) => {
      cleanup();
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function cmd(socket, line) {
  if (line) socket.write(`${line}\r\n`);
  return readReply(socket);
}

function connect(host, port) {
  if (port === 465) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host }, () => resolve(socket));
      socket.once('error', reject);
    });
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => resolve(socket));
    socket.once('error', reject);
  });
}

async function startTls(socket, host) {
  await cmd(socket, 'STARTTLS');
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, host, servername: host }, () => resolve(secure));
    secure.once('error', reject);
  });
}

function buildMessage({ from, to, subject, text, html, inReplyTo }) {
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);

  if (html) {
    const boundary = 'mc-digest';
    headers.push(`Content-Type: multipart/alternative; boundary=${boundary}`);
    return [
      ...headers,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      `--${boundary}--`,
    ].join('\r\n');
  }

  headers.push('Content-Type: text/plain; charset=utf-8');
  return [...headers, '', text].join('\r\n');
}

async function sendMail({ subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || 'mission-control@localhost';
  const to = (process.env.EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!host || to.length === 0) return false;

  let socket = await connect(host, port);
  await readReply(socket);
  await cmd(socket, 'EHLO localhost');

  if (port === 587) {
    socket = await startTls(socket, host);
    await cmd(socket, 'EHLO localhost');
  }

  if (user && pass) {
    await cmd(socket, 'AUTH LOGIN');
    await cmd(socket, b64(user));
    await cmd(socket, b64(pass));
  }

  await cmd(socket, `MAIL FROM:<${from}>`);
  for (const addr of to) {
    await cmd(socket, `RCPT TO:<${addr}>`);
  }

  await cmd(socket, 'DATA');
  socket.write(`${buildMessage({ from, to, subject, text, html })}\r\n.\r\n`);
  await readReply(socket);
  await cmd(socket, 'QUIT');
  socket.end();
  return true;
}

module.exports = { sendMail, buildMessage };
