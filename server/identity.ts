import type { Express, Request, Response } from 'express';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sendMail, integrationStatus } from './integrations';

export const roles = [
  'super_admin',
  'website_editor',
  'website_reviewer',
  'partner_representative',
  'registrar',
  'dean',
  'lecturer',
  'student',
  'bursar',
  'admissions_officer',
  'alumni',
] as const;
export const digest = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
  return (
    expected.length === hash.length * 2 &&
    crypto.timingSafeEqual(hash, Buffer.from(expected, 'hex'))
  );
}
export type Actor = {
  id: string;
  email: string;
  name: string;
  role: string;
  title: string;
  department?: string;
};
export const actorOf = (res: Response): Actor | undefined => res.locals.actor;
const staff = ['super_admin', 'registrar', 'dean', 'lecturer'];
const administrators = ['super_admin', 'registrar'];
export function campusPermission(action: string, role: string) {
  const allowed: Record<string, readonly string[]> = {
    slot: staff,
    session: staff,
    gradeImport: staff,
    documents: staff,
    revert: staff,
    capture: staff,
    project: staff,
    grant: staff,
    ethics: staff,
    patent: staff,
    backup: administrators,
    restore: ['super_admin'],
    standards: administrators,
    job: administrators,
    grantExpense: staff,
    reviewTutor: staff,
    reviewTranscript: administrators,
    updateResearch: staff,
  };
  return !(action in allowed) || allowed[action].includes(role);
}

export function installIdentity(
  app: Express,
  options: {
    directory: string;
    users: () => any[];
    save: () => void;
    origin?: string;
    secure?: boolean;
    partnerInviteAllowed?: (email:string)=>boolean;
  },
) {
  fs.mkdirSync(options.directory, { recursive: true });
  const sql = new DatabaseSync(path.join(options.directory, 'identity.sqlite'));
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),csrf TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL);
  `);
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const cookieName = secure ? '__Host-gu_session' : 'gu_session';
  const origin =
    options.origin ||
    process.env.APP_URL ||
    'https://gwoahuniversity.totag.network';
  const log = (actor: string, action: string, details = '') => {
    const previous =
      (
        sql
          .prepare(
            'SELECT entry_hash FROM security_audit ORDER BY id DESC LIMIT 1',
          )
          .get() as any
      )?.entry_hash || 'genesis';
    const at = new Date().toISOString();
    const hash = digest(JSON.stringify([at, actor, action, details, previous]));
    sql
      .prepare(
        'INSERT INTO security_audit(at,actor,action,details,previous_hash,entry_hash) VALUES(?,?,?,?,?,?)',
      )
      .run(at, actor, action, details, previous, hash);
  };
  for (const user of options.users())
    sql
      .prepare('INSERT OR IGNORE INTO accounts(id,email,role) VALUES(?,?,?)')
      .run(user.id, user.email.toLowerCase(), user.role);
  const ownerEmail = process.env.INITIAL_ADMIN_EMAIL;
  const bootstrapHash = process.env.INITIAL_ADMIN_TOKEN_HASH;
  if (ownerEmail && /^[a-f0-9]{64}$/.test(bootstrapHash || '')) {
    let owner = options
      .users()
      .find((u) => u.email.toLowerCase() === ownerEmail.toLowerCase());
    if (!owner) {
      owner = {
        id: crypto.randomUUID(),
        email: ownerEmail.toLowerCase(),
        name: 'University Administrator',
        title: 'University Administrator',
        role: 'super_admin',
      };
      options.users().push(owner);
      options.save();
    }
    sql
      .prepare('INSERT OR IGNORE INTO accounts(id,email,role) VALUES(?,?,?)')
      .run(owner.id, owner.email, 'super_admin');
    const account = sql
      .prepare('SELECT password FROM accounts WHERE id=?')
      .get(owner.id) as any;
    if (!account.password)
      sql
        .prepare(
          'INSERT OR IGNORE INTO invites(hash,user_id,expires) VALUES(?,?,?)',
        )
        .run(bootstrapHash!, owner.id, Date.now() + 48 * 3600000);
  }
  const publicActor = (account: any): Actor | null => {
    const profile = options.users().find((u) => u.id === account?.id);
    return profile && account && !account.disabled
      ? { ...profile, role: account.role, email: account.email }
      : null;
  };
  const cookieValue = (req: Request) =>
    req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
  const sessionFor = (req: Request) => {
    const token = cookieValue(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = sql
      .prepare(
        'SELECT s.*,a.id,a.email,a.role,a.disabled FROM sessions s JOIN accounts a ON s.user_id=a.id WHERE s.hash=?',
      )
      .get(digest(token)) as any;
    if (
      !row ||
      row.disabled ||
      row.expires < Date.now() ||
      row.last_seen < Date.now() - 30 * 60000
    )
      return null;
    sql
      .prepare('UPDATE sessions SET last_seen=? WHERE hash=?')
      .run(Date.now(), row.hash);
    return row;
  };
  const setCookie = (res: Response, token: string, age: number) =>
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: age,
    });
  const failLimit = (key: string, max = 8) => {
    const row = sql
      .prepare('SELECT * FROM attempts WHERE key=?')
      .get(key) as any;
    return row?.until_time > Date.now() && row.count >= max;
  };
  const failed = (key: string) =>
    sql
      .prepare(
        'INSERT INTO attempts(key,count,until_time) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_time<? THEN 1 ELSE count+1 END,until_time=CASE WHEN until_time<? THEN excluded.until_time ELSE until_time END',
      )
      .run(key, Date.now() + 15 * 60000, Date.now(), Date.now());
  const sameOrigin = (req: Request) => {
    const rawOrigin = req.get('origin');
    if (!rawOrigin) return false;
    try {
      const candidate = new URL(rawOrigin);
      const configured = new URL(origin);
      if (candidate.origin === configured.origin) return true;

      // Coolify/reverse-proxy deployments can legitimately serve the same
      // application from a staging hostname that differs from APP_URL. Keep
      // the CSRF boundary strict by accepting only an Origin whose host
      // exactly matches the host receiving this request.
      const requestHost = req.get('host');
      if (!requestHost || candidate.host !== requestHost) return false;
      if (secure && candidate.protocol !== 'https:') return false;
      return candidate.protocol === 'https:' || candidate.protocol === 'http:';
    } catch {
      return false;
    }
  };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    });
    if (secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/auth/me', (req, res) => {
    const session = sessionFor(req);
    const actor = session ? publicActor(session) : null;
    return actor
      ? res.json({ user: actor, csrf: session.csrf })
      : res.status(401).json({ error: 'Sign in to continue.' });
  });
  app.post('/api/auth/login', async (req, res) => {
    if (!sameOrigin(req))
      return res.status(403).json({ error: 'Untrusted request origin.' });
    const email =
      typeof req.body.email === 'string'
        ? req.body.email.trim().toLowerCase().slice(0, 254)
        : '';
    const ipKey = 'ip:' + req.socket.remoteAddress;
    if (failLimit(email) || failLimit(ipKey, 100))
      return res
        .status(429)
        .json({ error: 'Too many attempts. Try again in 15 minutes.' });
    failed(email);
    failed(ipKey);
    const account = sql
      .prepare('SELECT * FROM accounts WHERE email=?')
      .get(email) as any;
    const password =
      typeof req.body.password === 'string' && req.body.password.length <= 128
        ? req.body.password
        : '';
    const fallback =
      'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await verifyPassword(password, account?.password || fallback);
    const actor = publicActor(account);
    if (!valid || !actor) {
      log('anonymous', 'LOGIN_FAILED');
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const old = cookieValue(req);
    if (old) sql.prepare('DELETE FROM sessions WHERE hash=?').run(digest(old));
    sql
      .prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)')
      .run(digest(token), actor.id, csrf, now, now, now + 8 * 3600000);
    sql.prepare('DELETE FROM attempts WHERE key=?').run(email);
    sql.prepare('UPDATE attempts SET count=MAX(0,count-1) WHERE key=?').run(ipKey);
    setCookie(res, token, 8 * 3600000);
    log(actor.id, 'LOGIN_SUCCESS');
    return res.json({ success: true, user: actor, csrf, token: '' });
  });
  app.post('/api/auth/activate', async (req, res) => {
    if (!sameOrigin(req))
      return res.status(403).json({ error: 'Untrusted request origin.' });
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password =
      typeof req.body.password === 'string' ? req.body.password : '';
    if (
      !/^[a-f0-9]{64}$/.test(token) ||
      password.length < 12 ||
      password.length > 128
    )
      return res
        .status(400)
        .json({
          error:
            'Use a valid activation link and a password of 12–128 characters.',
        });
    const key = 'activate:' + req.socket.remoteAddress;
    if (failLimit(key, 20))
      return res
        .status(429)
        .json({ error: 'Too many attempts. Try again later.' });
    const invite = sql
      .prepare('SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?')
      .get(digest(token), Date.now()) as any;
    if (!invite) {
      failed(key);
      return res
        .status(400)
        .json({ error: 'Activation link is invalid or expired.' });
    }
    const passwordHash = await hashPassword(password);
    sql.exec('BEGIN IMMEDIATE');
    try {
      const used = sql
        .prepare(
          'UPDATE invites SET used=1 WHERE hash=? AND used=0 AND expires>?',
        )
        .run(digest(token), Date.now());
      if (!used.changes) throw Error('Activation link already used.');
      sql
        .prepare('UPDATE accounts SET password=?,disabled=0 WHERE id=?')
        .run(passwordHash, invite.user_id);
      sql.prepare('DELETE FROM sessions WHERE user_id=?').run(invite.user_id);
      sql.exec('COMMIT');
    } catch {
      sql.exec('ROLLBACK');
      return res.status(409).json({ error: 'Activation link already used.' });
    }
    log(invite.user_id, 'PASSWORD_SET');
    return res.json({ success: true });
  });
  app.post('/api/auth/forgot-password', async (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403);
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 254);
    const key = 'recovery:' + req.socket.remoteAddress;
    if (failLimit(key, 5))
      return res
        .status(429)
        .json({ error: 'Too many recovery requests. Try again later.' });
    failed(key);
    const account = sql
      .prepare(
        'SELECT * FROM accounts WHERE email=? AND disabled=0 AND password IS NOT NULL',
      )
      .get(email) as any;
    if (account && integrationStatus().email.configured) {
      const token = crypto.randomBytes(32).toString('hex');
      sql.prepare('UPDATE invites SET used=1 WHERE user_id=?').run(account.id);
      sql
        .prepare('INSERT INTO invites VALUES(?,?,?,0)')
        .run(digest(token), account.id, Date.now() + 3600000);
      try {
        await sendMail(
          email,
          'University account password recovery',
          `Use this one-time link within one hour to choose a new password: ${origin}/?activate=1#${token}\nIf you did not request this, ignore this email.`,
        );
        log(account.id, 'RECOVERY_EMAIL_ACCEPTED');
      } catch {
        log(account.id, 'RECOVERY_EMAIL_FAILED');
      }
    }
    return res.json({
      success: true,
      message:
        'If this is an active account and email delivery is configured, a recovery link will be sent.',
    });
  });
  app.use('/api', (req, res, next) => {
    const endpoint = req.originalUrl.split('?')[0];
    if (
      endpoint === '/api/health' ||
      (req.method === 'GET' && endpoint === '/api/public/hero-videos') ||
      (req.method === 'GET' && /^\/api\/public\/video-status\/[a-z0-9_-]+$/.test(endpoint)) ||
      (req.method === 'GET' && endpoint === '/api/public/staff') ||
      (req.method === 'GET' && endpoint === '/api/public/campus-content') ||
      (req.method === 'GET' && endpoint === '/api/public/site-content') ||
      (req.method === 'GET' && endpoint === '/api/public/news-events') ||
      (req.method === 'GET' && /^\/api\/public\/news-events\/news-[a-f0-9-]{36}\/media\/media-[a-f0-9-]{36}$/.test(endpoint)) ||
      (req.method === 'GET' && /^\/api\/public\/campus-content\/campus-[a-f0-9-]{36}\/photo$/.test(endpoint)) ||
      (req.method === 'GET' && /^\/api\/public\/staff\/staff-[a-f0-9-]{36}\/photo$/.test(endpoint)) ||
      ((req.method === 'GET' || req.method === 'HEAD') && /^\/api\/public\/video\/[a-z0-9_-]+$/.test(endpoint)) ||
      (req.method === 'GET' && /^\/api\/public\/degree-curriculum\/[a-z0-9-]+$/.test(endpoint)) ||
      endpoint.startsWith('/api/campus/integrations/') ||
      (req.method === 'GET' && /^\/api\/localization\/published/.test(endpoint))
    )
      return next();
    if (endpoint === '/api/applications' && req.method === 'POST') {
      const key = 'admissions:' + req.socket.remoteAddress;
      if (!sameOrigin(req) || failLimit(key, 20))
        return res
          .status(429)
          .json({ error: 'Please try submitting your application later.' });
      failed(key);
      if (
        JSON.stringify(req.body).length > 20000 ||
        typeof req.body.applicantName !== 'string' ||
        typeof req.body.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)
      )
        return res
          .status(400)
          .json({ error: 'Provide a valid name and email address.' });
      return next();
    }
    const session = sessionFor(req);
    const actor = session ? publicActor(session) : null;
    if (!actor) return res.status(401).json({ error: 'Sign in to continue.' });
    // Website-only roles have a deny-by-default API boundary: no ERP, HR,
    // finance, admissions or administrative operations beyond scoped CMS routes.
    // Partner representatives may only use the dedicated collaboration API,
    // plus their own session/password operations. All ERP/finance/academic
    // record endpoints are forbidden even if a client bypasses navigation.
    if(actor.role==='partner_representative' &&
       !endpoint.startsWith('/api/partner-collaboration/') &&
       !['/api/auth/logout','/api/auth/change-password'].includes(endpoint))
      return res.status(403).json({error:'Partner accounts cannot access internal university ERP APIs.'});
    if (['website_editor','website_reviewer'].includes(actor.role) &&
        !/^\/api\/admin\/(?:site-content|news-events)(?:\/|$)/.test(endpoint) &&
        !['/api/auth/logout','/api/auth/change-password'].includes(endpoint))
      return res.status(403).json({error:'Website editorial accounts cannot access institutional ERP APIs.'});
    res.locals.actor = actor;
    res.locals.sessionHash = session.hash;
    (req as any).actor = actor;
    res.locals.checkSession = () => sessionFor(req);
    return express.json({ limit: '60mb' })(req, res, (parseError) => {
      if (parseError) return next(parseError);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (!sameOrigin(req) || req.get('x-csrf-token') !== session.csrf)
      )
        return res
          .status(403)
          .json({
            error: 'Request verification failed. Refresh and try again.',
          });
      if (req.method !== 'GET')
        req.body = {
          ...req.body,
          user: actor.id,
          userId: actor.id,
          senderId: actor.id,
          senderName: actor.name,
          senderRole: actor.role,
          facultyName: actor.name,
        };
      const deny = () =>
        res
          .status(403)
          .json({
            error: 'Your account does not have access to this operation.',
          });
      if (endpoint === '/api/reset-demo') return deny();
      if (
        /^\/api\/admin\//.test(endpoint) &&
        !/^\/api\/admin\/(?:site-content|news-events)(?:\/|$)/.test(endpoint) &&
        !administrators.includes(actor.role)
      )
        return deny();
      if (/^\/api\/admin\/users/.test(endpoint))
        return res
          .status(409)
          .json({ error: 'Manage accounts through Account & integrations.' });
      if (endpoint === '/api/auth/users' && !staff.includes(actor.role))
        return deny();
      if (
        /^\/api\/(audit|analytics)/.test(endpoint) &&
        !['super_admin', 'registrar', 'dean', 'bursar'].includes(actor.role)
      )
        return deny();
      if (
        /^\/api\/applications/.test(endpoint) &&
        !['super_admin', 'registrar', 'admissions_officer'].includes(actor.role)
      )
        return deny();
      if (/^\/api\/faculty\//.test(endpoint) && !staff.includes(actor.role))
        return deny();
      if (
        /^\/api\/students\//.test(endpoint) &&
        ![...staff, 'bursar', 'student'].includes(actor.role)
      )
        return deny();
      if (
        /^\/api\/registration/.test(endpoint) &&
        !['super_admin', 'registrar', 'student'].includes(actor.role)
      )
        return deny();
      if (
        req.method !== 'GET' &&
        /^\/api\/(materials|calendar\/events)/.test(endpoint) &&
        !staff.includes(actor.role)
      )
        return deny();
      if (/^\/api\/tasks/.test(endpoint) && actor.role === 'alumni')
        return deny();
      if (
        req.method !== 'GET' &&
        /^\/api\/tasks/.test(endpoint) &&
        ['student', 'alumni'].includes(actor.role)
      )
        return deny();
      if (
        /^\/api\/finance/.test(endpoint) &&
        !['super_admin', 'bursar', 'registrar', 'student'].includes(actor.role)
      )
        return deny();
      if (
        endpoint === '/api/finance/pay' &&
        !['super_admin', 'bursar'].includes(actor.role)
      )
        return deny();
      if (actor.role === 'student') {
        const id = endpoint.match(
          /^\/api\/(?:students|finance\/student)\/([^/]+)/,
        )?.[1];
        if (id && id !== actor.id) return deny();
        if (/^\/api\/registration/.test(endpoint))
          req.body.studentId = actor.id;
        if (
          req.method !== 'GET' &&
          /\/tasks|\/materials|\/calendar\/events/.test(endpoint)
        )
          return deny();
      }
      const themeUser = endpoint.match(/^\/api\/users\/([^/]+)\/theme$/)?.[1];
      if (themeUser && themeUser !== actor.id) return deny();
      if (
        endpoint === '/api/campus/action' &&
        !campusPermission(req.body.action, actor.role)
      )
        return deny();
      if (
        /^\/api\/campus\/backup\//.test(endpoint) &&
        !administrators.includes(actor.role)
      )
        return deny();
      if (
        endpoint === '/api/campus/billing' &&
        !['super_admin', 'bursar'].includes(actor.role)
      )
        return deny();
      if (endpoint === '/api/campus/tags' && !staff.includes(actor.role))
        return deny();
      if (
        endpoint === '/api/campus/proctor' &&
        (req.method === 'GET'
          ? !staff.includes(actor.role)
          : actor.role !== 'student')
      )
        return deny();
      if (endpoint === '/api/campus/proctor' && req.method === 'POST')
        req.body.user = actor.id;
      next();
    });
  });
  app.post('/api/auth/logout', (req, res) => {
    sql
      .prepare('DELETE FROM sessions WHERE hash=?')
      .run(res.locals.sessionHash);
    setCookie(res, '', 0);
    return res.json({ success: true });
  });
  app.post('/api/auth/change-password', async (req, res) => {
    const account = sql
      .prepare('SELECT * FROM accounts WHERE id=?')
      .get(res.locals.actor.id) as any;
    if (
      typeof req.body.password !== 'string' ||
      req.body.password.length < 12 ||
      req.body.password.length > 128 ||
      !(await verifyPassword(
        String(req.body.currentPassword || ''),
        account.password,
      ))
    )
      return res
        .status(400)
        .json({
          error:
            'Check your current password and use at least 12 characters for the new password.',
        });
    sql
      .prepare('UPDATE accounts SET password=? WHERE id=?')
      .run(await hashPassword(req.body.password), account.id);
    sql.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
    setCookie(res, '', 0);
    log(account.id, 'PASSWORD_CHANGED');
    return res.json({ success: true });
  });
  app.get('/api/identity/accounts', (_req, res) => {
    if (!administrators.includes(res.locals.actor.role))
      return res.sendStatus(403);
    return res.json(
      sql
        .prepare(
          'SELECT id,email,role,disabled,password IS NOT NULL AS activated FROM accounts ORDER BY email',
        )
        .all().filter((account:any)=>options.users().some(user=>user.id===account.id)),
    );
  });
  app.post('/api/identity/invite', (req, res) => {
    const actor = actorOf(res)!;
    if (actor.role !== 'super_admin') return res.sendStatus(403);
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const role = req.body.role;
    if(role==='partner_representative' && !options.partnerInviteAllowed?.(email))
      return res.status(403).json({error:'Approve an active institutional partner representative before inviting them.'});
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !roles.includes(role) ||
      !String(req.body.name || '').trim()
    )
      return res
        .status(400)
        .json({ error: 'Provide a name, valid email and supported role.' });
    let profile = options.users().find((u) => u.email.toLowerCase() === email);
    if (!profile) {
      profile = {
        id: (sql.prepare('SELECT id FROM accounts WHERE email=?').get(email) as any)?.id || crypto.randomUUID(),
        email,
        role,
        name: req.body.name.slice(0, 100),
        title: role.replaceAll('_', ' '),
      };
      options.users().push(profile);
      options.save();
    }
    const existing = sql
      .prepare('SELECT * FROM accounts WHERE email=?')
      .get(email) as any;
    if (existing?.password)
      return res
        .status(409)
        .json({
          error:
            'Account is already activated. Use account controls to change roles or disable access.',
        });
    sql
      .prepare('INSERT OR IGNORE INTO accounts(id,email,role) VALUES(?,?,?)')
      .run(profile.id, email, role);
    sql
      .prepare('UPDATE accounts SET role=? WHERE id=? AND password IS NULL')
      .run(role, profile.id);
    profile.role = role;
    options.save();
    const token = crypto.randomBytes(32).toString('hex');
    sql.prepare('UPDATE invites SET used=1 WHERE user_id=?').run(profile.id);
    sql
      .prepare('INSERT INTO invites VALUES(?,?,?,0)')
      .run(digest(token), profile.id, Date.now() + 48 * 3600000);
    log(actor.id, 'INVITATION_CREATED', profile.id);
    return res.json({
      activationUrl: `${origin}/?activate=1#${token}`,
      expiresHours: 48,
    });
  });
  app.patch('/api/identity/accounts/:id', (req, res) => {
    const actor = actorOf(res)!;
    if (actor.role !== 'super_admin' || actor.id === req.params.id)
      return res.sendStatus(403);
    const account = sql
      .prepare('SELECT * FROM accounts WHERE id=?')
      .get(req.params.id) as any;
    if (
      !account ||
      !roles.includes(req.body.role) ||
      typeof req.body.disabled !== 'boolean'
    )
      return res.status(400).json({ error: 'Invalid account update.' });
    if(req.body.role==='partner_representative' && !options.partnerInviteAllowed?.(account.email))
      return res.status(403).json({error:'A partner representative requires a verified institution assignment.'});
    sql
      .prepare('UPDATE accounts SET role=?,disabled=? WHERE id=?')
      .run(req.body.role, req.body.disabled ? 1 : 0, account.id);
    sql.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
    sql.prepare('UPDATE invites SET used=1 WHERE user_id=?').run(account.id);
    const profile = options.users().find((u) => u.id === account.id);
    if (profile) profile.role = req.body.role;
    options.save();
    log(
      actor.id,
      'ACCESS_CHANGED',
      JSON.stringify({
        id: account.id,
        before: { role: account.role, disabled: account.disabled },
        after: { role: req.body.role, disabled: req.body.disabled },
      }),
    );
    return res.json({ success: true });
  });
  app.get('/api/identity/audit', (_req, res) => {
    if (!administrators.includes(res.locals.actor.role))
      return res.sendStatus(403);
    const rows = sql
      .prepare('SELECT * FROM security_audit ORDER BY id')
      .all() as any[];
    let previous = 'genesis';
    let intact = true;
    for (const row of rows) {
      if (
        row.previous_hash !== previous ||
        row.entry_hash !==
          digest(
            JSON.stringify([
              row.at,
              row.actor,
              row.action,
              row.details,
              row.previous_hash,
            ]),
          )
      )
        intact = false;
      previous = row.entry_hash;
    }
    return res.json({ intact, entries: rows.slice(-200).reverse() });
  });
  const timer = setInterval(() => {
    sql
      .prepare('DELETE FROM sessions WHERE expires<? OR last_seen<?')
      .run(Date.now(), Date.now() - 30 * 60000);
    sql.prepare('DELETE FROM attempts WHERE until_time<?').run(Date.now());
  }, 60000);
  timer.unref();
  return {
    sql,
    log,
    close: () => {
      clearInterval(timer);
      sql.close();
    },
  };
}
