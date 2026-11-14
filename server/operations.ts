import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Actor } from './identity';

export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value: unknown, name: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new WorkflowError(`${name} is required (maximum ${max} characters).`);
  return value.trim();
};
const integer = (value: unknown, name: string, min = 0, max = 100000) => {
  const n = Number(value);
  if (
    value == null ||
    value === '' ||
    !Number.isInteger(n) ||
    n < min ||
    n > max
  )
    throw new WorkflowError(
      `${name} must be a whole number from ${min} to ${max}.`,
    );
  return n;
};
export function money(value: unknown) {
  const v = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw new WorkflowError(
      'Enter a non-negative amount with at most two decimal places.',
    );
  const [whole, fraction = ''] = v.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100000000000)
    throw new WorkflowError('Amount exceeds the supported limit.');
  return cents;
}
const email = (value: unknown) => {
  const v = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    throw new WorkflowError('Enter a valid email address.');
  return v;
};
const day = (value: unknown, name: string) => {
  const v = text(value, name, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + 'T00:00:00Z')) ||
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v
  )
    throw new WorkflowError(`${name} must be a valid date.`);
  return v;
};
const operationalTables = [
  'programs',
  'terms',
  'courses',
  'course_prerequisites',
  'program_requirements',
  'sections',
  'applications',
  'students',
  'registrations',
  'student_course_plans',
  'student_course_plan_commits',
  'student_assistance_requests',
  'grade_schemes',
  'grades',
  'invoices',
  'invoice_lines',
  'student_assistance_awards',
  'credit_notes',
  'payments',
  'graduation_reviews',
  'alumni_profiles',
  'transcript_requests',
  'tasks',
  'curriculum_programs',
  'curriculum_courses',
  'curriculum_publications',
  // Partner collaboration backup order follows foreign-key dependencies.
  'institutional_partners',
  'institutional_partner_agreements',
  'institutional_partner_members',
  'institutional_partner_resources',
  'institutional_partner_distributions',
  'institutional_partner_distribution_grants',
  'institutional_partner_events',
  'institutional_partner_event_registrations',
] as const;

export class Operations {
  sql: DatabaseSync;
  constructor(public directory: string) {
    fs.mkdirSync(directory, { recursive: true });
    this.sql = new DatabaseSync(path.join(directory, 'operations.sqlite'));
    this.sql
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL COLLATE NOCASE,name TEXT NOT NULL,role TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS programs(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,required_credits INTEGER NOT NULL CHECK(required_credits>0),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terms(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','open','closed')),max_credits INTEGER NOT NULL CHECK(max_credits>0),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,credits INTEGER NOT NULL CHECK(credits>0),fee_cents INTEGER NOT NULL CHECK(fee_cents>=0),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS course_prerequisites(course_id TEXT NOT NULL REFERENCES courses(id),requires_id TEXT NOT NULL REFERENCES courses(id),PRIMARY KEY(course_id,requires_id),CHECK(course_id<>requires_id));
      CREATE TABLE IF NOT EXISTS program_requirements(program_id TEXT NOT NULL REFERENCES programs(id),course_id TEXT NOT NULL REFERENCES courses(id),PRIMARY KEY(program_id,course_id));
      CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),term_id TEXT NOT NULL REFERENCES terms(id),lecturer_id TEXT NOT NULL REFERENCES users(id),code TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>0),location TEXT NOT NULL,schedule TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(course_id,term_id,code));
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,full_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',program_id TEXT NOT NULL REFERENCES programs(id),status TEXT NOT NULL CHECK(status IN('submitted','under_review','approved','rejected','admitted')),decision_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,user_id TEXT UNIQUE REFERENCES users(id),application_id TEXT UNIQUE NOT NULL REFERENCES applications(id),student_number TEXT UNIQUE NOT NULL,full_name TEXT NOT NULL,email TEXT UNIQUE NOT NULL COLLATE NOCASE,program_id TEXT NOT NULL REFERENCES programs(id),admitted_term_id TEXT NOT NULL REFERENCES terms(id),status TEXT NOT NULL CHECK(status IN('active','on_leave','graduated')),financial_hold INTEGER NOT NULL DEFAULT 0 CHECK(financial_hold IN(0,1)),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),section_id TEXT NOT NULL REFERENCES sections(id),status TEXT NOT NULL CHECK(status IN('enrolled','dropped')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_registration ON registrations(student_id,section_id) WHERE status='enrolled';
      CREATE TABLE IF NOT EXISTS student_course_plans(
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id),
        term_id TEXT NOT NULL REFERENCES terms(id),
        section_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN('draft','submitted','returned','approved','rejected')),
        student_note TEXT NOT NULL DEFAULT '',
        reviewer_note TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT REFERENCES users(id),
        submitted_at TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(student_id,term_id)
      );
      CREATE INDEX IF NOT EXISTS student_plan_review_queue
        ON student_course_plans(status,submitted_at);
      CREATE TABLE IF NOT EXISTS student_course_plan_commits(
        id TEXT PRIMARY KEY,
        plan_id TEXT UNIQUE NOT NULL REFERENCES student_course_plans(id),
        student_id TEXT NOT NULL REFERENCES students(id),
        term_id TEXT NOT NULL REFERENCES terms(id),
        registered_by TEXT NOT NULL REFERENCES users(id),
        section_count INTEGER NOT NULL CHECK(section_count>0),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS student_plan_commits_term
        ON student_course_plan_commits(term_id,created_at);

      CREATE TABLE IF NOT EXISTS grade_schemes(id TEXT PRIMARY KEY,title TEXT NOT NULL,definition TEXT NOT NULL,approved_by TEXT NOT NULL REFERENCES users(id),approved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grades(id TEXT PRIMARY KEY,registration_id TEXT UNIQUE NOT NULL REFERENCES registrations(id),score REAL NOT NULL CHECK(score>=0 AND score<=100),status TEXT NOT NULL CHECK(status IN('draft','submitted','published')),letter TEXT,points REAL,passed INTEGER CHECK(passed IN(0,1)),scheme_id TEXT REFERENCES grade_schemes(id),entered_by TEXT NOT NULL REFERENCES users(id),published_by TEXT REFERENCES users(id),updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS student_assistance_requests(
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id),
        term_id TEXT NOT NULL REFERENCES terms(id),
        kind TEXT NOT NULL CHECK(kind IN('scholarship','financial_aid','tuition_waiver')),
        requested_cents INTEGER NOT NULL CHECK(requested_cents>=0),
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('submitted','recommended','returned','rejected','finance_reviewed')),
        registrar_note TEXT NOT NULL DEFAULT '',
        finance_note TEXT NOT NULL DEFAULT '',
        registrar_id TEXT REFERENCES users(id),
        finance_id TEXT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS student_assistance_lookup
        ON student_assistance_requests(student_id,created_at);
      CREATE INDEX IF NOT EXISTS student_assistance_review
        ON student_assistance_requests(status,created_at);
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),term_id TEXT NOT NULL REFERENCES terms(id),number TEXT UNIQUE NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),due_date TEXT NOT NULL,posted_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoice_lines(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),registration_id TEXT UNIQUE NOT NULL REFERENCES registrations(id),description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0));
      CREATE TABLE IF NOT EXISTS student_assistance_awards(
        id TEXT PRIMARY KEY,
        request_id TEXT UNIQUE NOT NULL REFERENCES student_assistance_requests(id),
        student_id TEXT NOT NULL REFERENCES students(id),
        term_id TEXT NOT NULL REFERENCES terms(id),
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        kind TEXT NOT NULL CHECK(kind IN('scholarship','financial_aid','tuition_waiver')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        posted_by TEXT NOT NULL REFERENCES users(id),
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS student_assistance_awards_invoice ON student_assistance_awards(invoice_id,created_at);
      CREATE TABLE IF NOT EXISTS credit_notes(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),registration_id TEXT UNIQUE NOT NULL REFERENCES registrations(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),reason TEXT NOT NULL,posted_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),reference TEXT UNIQUE NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL CHECK(method IN('bank','mobile_money','cash')),received_date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('recorded','reconciled','cancelled')),recorded_by TEXT NOT NULL REFERENCES users(id),reviewed_by TEXT REFERENCES users(id),review_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT);
      CREATE TABLE IF NOT EXISTS graduation_reviews(id TEXT PRIMARY KEY,student_id TEXT UNIQUE NOT NULL REFERENCES students(id),status TEXT NOT NULL CHECK(status IN('requested','approved','rejected')),note TEXT NOT NULL DEFAULT '',reviewed_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,reviewed_at TEXT);
      CREATE TABLE IF NOT EXISTS alumni_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),profession TEXT NOT NULL,employer TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_requests(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),purpose TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('requested','under_review','issued','declined')),reviewed_by TEXT REFERENCES users(id),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN('todo','in_progress','completed')),due_date TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS curriculum_programs(
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, college TEXT NOT NULL,
        credential TEXT NOT NULL, general_half INTEGER NOT NULL DEFAULT 0 CHECK(general_half>=0),
        college_half INTEGER NOT NULL DEFAULT 0 CHECK(college_half>=0),
        major_half INTEGER NOT NULL DEFAULT 0 CHECK(major_half>=0),
        minor_half INTEGER NOT NULL DEFAULT 0 CHECK(minor_half>=0),
        elective_half INTEGER NOT NULL DEFAULT 0 CHECK(elective_half>=0),
        required_half INTEGER NOT NULL DEFAULT 0 CHECK(required_half>=0),
        status TEXT NOT NULL CHECK(status IN('draft','in_review','approved')),
        source_title TEXT NOT NULL, source_page TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, updated_at TEXT NOT NULL,
        approved_by TEXT, approved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS curriculum_courses(
        id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES curriculum_programs(id),
        code TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL
          CHECK(category IN('general','college','major','minor','elective')),
        credits_half INTEGER NOT NULL CHECK(credits_half>0 AND credits_half<=60),
        year INTEGER NOT NULL CHECK(year>=1 AND year<=6),
        semester INTEGER NOT NULL CHECK(semester>=1 AND semester<=3),
        prerequisite_codes TEXT NOT NULL DEFAULT '',
        source_page TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(program_id,year,semester,code)
      );
      CREATE INDEX IF NOT EXISTS curriculum_course_program ON curriculum_courses(program_id,year,semester);
      CREATE TABLE IF NOT EXISTS curriculum_publications(
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL REFERENCES curriculum_programs(id),
        degree_route TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0),
        effective_year TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        released_by TEXT NOT NULL,
        released_at TEXT NOT NULL,
        withdrawn_by TEXT,
        withdrawn_at TEXT,
        UNIQUE(degree_route,version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS curriculum_one_live_publication
        ON curriculum_publications(degree_route) WHERE withdrawn_at IS NULL;
      CREATE INDEX IF NOT EXISTS curriculum_publication_program
        ON curriculum_publications(program_id);
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);
      CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit entries cannot be modified'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit entries cannot be removed'); END;
      -- Partner tables are initialized with the primary operations database,
      -- not only when HTTP modules mount: backups and standalone ERP operations
      -- must work before or without installing the collaboration endpoints.
      CREATE TABLE IF NOT EXISTS institutional_partners(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        institution_type TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('draft','verified','active','suspended')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        verified_by TEXT,
        verified_at TEXT,
        activated_by TEXT,
        activated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS institutional_partner_agreements(
        id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL REFERENCES institutional_partners(id),
        signed_reference TEXT NOT NULL,
        activities_json TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        expires_on TEXT NOT NULL,
        accepted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS partner_agreements_current
        ON institutional_partner_agreements(partner_id,expires_on);
      CREATE TABLE IF NOT EXISTS institutional_partner_members(
        id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL REFERENCES institutional_partners(id),
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS partner_member_institution
        ON institutional_partner_members(partner_id);
      CREATE TABLE IF NOT EXISTS institutional_partner_resources(
        id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL REFERENCES institutional_partners(id),
        member_email TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('lesson','lecture','symposium','research','library')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        license_statement TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('submitted','approved','rejected','withdrawn')),
        submitted_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        reviewer_note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS partner_resources_queue
        ON institutional_partner_resources(status,submitted_at);
      CREATE INDEX IF NOT EXISTS partner_resources_tenant
        ON institutional_partner_resources(partner_id,status);
      CREATE TABLE IF NOT EXISTS institutional_partner_distributions(
        resource_id TEXT PRIMARY KEY REFERENCES institutional_partner_resources(id),
        rights_evidence TEXT NOT NULL,
        rights_expires_on TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        withdrawn_at TEXT
      );
      CREATE TABLE IF NOT EXISTS institutional_partner_distribution_grants(
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES institutional_partner_resources(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        granted_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(resource_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS partner_distribution_grants_user
        ON institutional_partner_distribution_grants(user_id,revoked_at);
      CREATE TABLE IF NOT EXISTS institutional_partner_events(
        id TEXT PRIMARY KEY,
        partner_id TEXT REFERENCES institutional_partners(id),
        proposed_by_email TEXT NOT NULL,
        title TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('guest_lecture','seminar','symposium','conference','workshop','professional_development')),
        summary TEXT NOT NULL,
        delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('online','hybrid','in_person')),
        venue TEXT NOT NULL DEFAULT '',
        meeting_url TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','cancelled','completed')),
        registration_open INTEGER NOT NULL DEFAULT 0,
        max_participants INTEGER NOT NULL DEFAULT 0,
        certificate_eligible INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT,
        reviewed_at TEXT,
        review_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS partner_events_status_time
        ON institutional_partner_events(status,starts_at);
      CREATE INDEX IF NOT EXISTS partner_events_partner
        ON institutional_partner_events(partner_id,status);
      CREATE TABLE IF NOT EXISTS institutional_partner_event_registrations(
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES institutional_partner_events(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        registered_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('registered','cancelled','attended')),
        attended_at TEXT,
        attendance_verified_by TEXT,
        certificate_code TEXT,
        certificate_issued_at TEXT,
        UNIQUE(event_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS partner_event_regs_user
        ON institutional_partner_event_registrations(user_id,status);
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));`);
  }
  all(query: string, ...parameters: any[]): any[] {
    return this.sql.prepare(query).all(...parameters) as any[];
  }
  one(query: string, ...parameters: any[]): any {
    return this.sql.prepare(query).get(...parameters);
  }
  run(query: string, ...parameters: any[]) {
    return this.sql.prepare(query).run(...parameters);
  }
  transaction<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.sql.exec('COMMIT');
      return result;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }
  audit(
    actor: Actor | string,
    action: string,
    entity: string,
    before: any,
    after: any,
  ) {
    this.run(
      'INSERT INTO audit VALUES(?,?,?,?,?,?,?)',
      id(),
      typeof actor === 'string' ? actor : actor.id,
      action,
      entity,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      now(),
    );
  }
  users() {
    return this.all('SELECT * FROM users ORDER BY name');
  }
  saveUsers(users: any[]) {
    this.transaction(() => {
      for (const u of users) {
        this.run(
          'INSERT INTO users(id,email,name,role,title,department) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,title=excluded.title,department=excluded.department',
          u.id,
          email(u.email),
          u.name,
          u.role,
          u.title || '',
          u.department || '',
        );
        if (u.role === 'student' || u.role === 'alumni')
          this.run(
            'UPDATE students SET user_id=? WHERE email=? COLLATE NOCASE AND (user_id IS NULL OR user_id=?)',
            u.id,
            u.email,
            u.id,
          );
      }
    });
  }
  migrateLegacy() {
    if (this.one("SELECT key FROM settings WHERE key='clean_start_v1'")) return;
    const legacyFile = path.join(this.directory, 'university-db.json');
    let legacy: any = { users: [] };
    if (fs.existsSync(legacyFile))
      legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    const preserved: any[] = [];
    const identityPath = path.join(this.directory, 'identity.sqlite');
    if (fs.existsSync(identityPath)) {
      const auth = new DatabaseSync(identityPath);
      try {
        const accounts = auth
          .prepare(
            'SELECT id,email,role FROM accounts WHERE password IS NOT NULL OR id IN(SELECT user_id FROM invites WHERE used=0 AND expires>?) OR lower(email)=lower(?)',
          )
          .all(Date.now(), process.env.INITIAL_ADMIN_EMAIL || '') as any[];
        for (const account of accounts) {
          const profile = legacy.users?.find((u: any) => u.id === account.id);
          preserved.push({
            ...profile,
            ...account,
            name: profile?.name || 'University account',
            title: profile?.title || account.role.replaceAll('_', ' '),
          });
        }
      } finally {
        auth.close();
      }
    }
    const sources = ['university-db.json', 'campus.json'].filter((name) =>
      fs.existsSync(path.join(this.directory, name)),
    );
    const archive = path.join(
      this.directory,
      'migration-archive',
      'clean-start-' + id(),
    );
    if (sources.length) {
      fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
      const manifest = [];
      for (const name of sources) {
        const bytes = fs.readFileSync(path.join(this.directory, name));
        fs.writeFileSync(path.join(archive, name), bytes, {
          mode: 0o600,
          flag: 'wx',
        });
        manifest.push({
          file: name,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
      }
      fs.writeFileSync(
        path.join(archive, 'manifest.json'),
        JSON.stringify(
          {
            createdAt: now(),
            files: manifest,
            preservedAccounts: preserved.length,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    this.saveUsers(preserved);
    this.transaction(() => {
      this.run(
        'INSERT INTO settings VALUES(?,?)',
        'clean_start_v1',
        JSON.stringify({ at: now(), archive: sources.length ? archive : null }),
      );
      this.audit('system', 'CLEAN_START_MIGRATION', 'operations', null, {
        archivedFiles: sources,
        preservedAccounts: preserved.length,
        operationalRecordsImported: 0,
      });
    });
  }
  studentFor(actor: Actor, studentId?: string) {
    const s = studentId
      ? this.one('SELECT * FROM students WHERE id=?', studentId)
      : this.one('SELECT * FROM students WHERE user_id=?', actor.id);
    if (!s)
      throw new WorkflowError(
        'No student record is linked to this account.',
        404,
      );
    if (['student', 'alumni'].includes(actor.role) && s.user_id !== actor.id)
      throw new WorkflowError(
        'This student record is not accessible to your account.',
        403,
      );
    return s;
  }
  balance(studentId: string) {
    return this.one(
      `SELECT COALESCE((SELECT SUM(amount_cents) FROM invoices WHERE student_id=?),0)
        -COALESCE((SELECT SUM(c.amount_cents) FROM credit_notes c JOIN invoices i ON c.invoice_id=i.id WHERE i.student_id=?),0)
        -COALESCE((SELECT SUM(a.amount_cents) FROM student_assistance_awards a WHERE a.student_id=?),0)
        -COALESCE((SELECT SUM(p.amount_cents) FROM payments p JOIN invoices i ON p.invoice_id=i.id WHERE i.student_id=? AND p.status='reconciled'),0) AS cents`,
      studentId,
      studentId,
      studentId,
      studentId,
    ).cents as number;
  }
  invoiceBalance(invoiceId: string) {
    return this.one(
      `SELECT i.amount_cents
        -COALESCE((SELECT SUM(amount_cents) FROM credit_notes WHERE invoice_id=i.id),0)
        -COALESCE((SELECT SUM(amount_cents) FROM student_assistance_awards WHERE invoice_id=i.id),0)
        -COALESCE((SELECT SUM(amount_cents) FROM payments WHERE invoice_id=i.id AND status='reconciled'),0) AS cents
        FROM invoices i WHERE i.id=?`,
      invoiceId,
    )?.cents;
  }
  eligibility(studentId: string) {
    const student = this.one('SELECT * FROM students WHERE id=?', studentId);
    if (!student) throw new WorkflowError('Student not found.', 404);
    const program = this.one(
      'SELECT * FROM programs WHERE id=?',
      student.program_id,
    );
    const passed = this.all(
      `SELECT c.id,c.credits,MAX(g.points) AS points FROM registrations r JOIN sections s ON r.section_id=s.id JOIN courses c ON s.course_id=c.id JOIN grades g ON g.registration_id=r.id WHERE r.student_id=? AND r.status='enrolled' AND g.status='published' AND g.passed=1 GROUP BY c.id,c.credits`,
      studentId,
    );
    const earned = passed.reduce((sum, r) => sum + r.credits, 0);
    const missing = this.all(
      'SELECT c.code FROM program_requirements p JOIN courses c ON p.course_id=c.id WHERE p.program_id=?',
      student.program_id,
    ).filter(
      (c) =>
        !passed.some(
          (p) =>
            p.id === this.one('SELECT id FROM courses WHERE code=?', c.code).id,
        ),
    );
    const outstanding = this.balance(studentId);
    return {
      earnedCredits: earned,
      requiredCredits: program.required_credits,
      missingCourses: missing.map((c) => c.code),
      balanceCents: outstanding,
      eligible:
        earned >= program.required_credits &&
        missing.length === 0 &&
        outstanding <= 0,
    };
  }
  permitted(actor: Actor, allowed: string[]) {
    if (actor.role !== 'super_admin' && !allowed.includes(actor.role))
      throw new WorkflowError('Your role cannot perform this operation.', 403);
  }
  execute(actor: Actor, action: string, data: any) {
    return this.transaction(() => {
      let result: any;
      let before: any = null;
      if (action === 'program') {
        this.permitted(actor, ['registrar']);
        const row = {
          id: id(),
          code: text(data.code, 'Program code', 30).toUpperCase(),
          title: text(data.title, 'Program title'),
          required_credits: integer(
            data.requiredCredits,
            'Required credits',
            1,
            500,
          ),
          created_at: now(),
        };
        this.run(
          'INSERT INTO programs VALUES(?,?,?,?,?)',
          ...Object.values(row),
        );
        result = row;
      } else if (action === 'term') {
        this.permitted(actor, ['registrar']);
        const start = day(data.startDate, 'Start date'),
          end = day(data.endDate, 'End date');
        if (end < start)
          throw new WorkflowError('Term end must follow its start.');
        const status = ['draft', 'open', 'closed'].includes(data.status)
          ? data.status
          : 'draft';
        result = {
          id: id(),
          code: text(data.code, 'Term code', 30).toUpperCase(),
          title: text(data.title, 'Term title'),
          start_date: start,
          end_date: end,
          status,
          max_credits: integer(data.maxCredits, 'Credit limit', 1, 60),
          created_at: now(),
        };
        this.run(
          'INSERT INTO terms VALUES(?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'termStatus') {
        this.permitted(actor, ['registrar']);
        before = this.one('SELECT * FROM terms WHERE id=?', data.id);
        if (!before || !['draft', 'open', 'closed'].includes(data.status))
          throw new WorkflowError('Invalid term status.');
        this.run('UPDATE terms SET status=? WHERE id=?', data.status, data.id);
        result = { ...before, status: data.status };
      } else if (action === 'course') {
        this.permitted(actor, ['registrar']);
        const row = {
          id: id(),
          code: text(data.code, 'Course code', 30).toUpperCase(),
          title: text(data.title, 'Course title'),
          credits: integer(data.credits, 'Credits', 1, 30),
          fee_cents: money(data.feePerCredit),
          created_at: now(),
        };
        this.run(
          'INSERT INTO courses VALUES(?,?,?,?,?,?)',
          ...Object.values(row),
        );
        if (data.programId)
          this.run(
            'INSERT INTO program_requirements VALUES(?,?)',
            data.programId,
            row.id,
          );
        for (const required of Array.isArray(data.prerequisites)
          ? data.prerequisites
          : [])
          this.run(
            'INSERT INTO course_prerequisites VALUES(?,?)',
            row.id,
            required,
          );
        result = row;
      } else if (action === 'section') {
        this.permitted(actor, ['registrar']);
        const lecturer = this.one(
          'SELECT * FROM users WHERE id=?',
          data.lecturerId,
        );
        if (
          !lecturer ||
          !['lecturer', 'dean', 'super_admin'].includes(lecturer.role)
        )
          throw new WorkflowError('Choose a faculty account.');
        result = {
          id: id(),
          course_id: data.courseId,
          term_id: data.termId,
          lecturer_id: data.lecturerId,
          code: text(data.code, 'Section code', 30),
          capacity: integer(data.capacity, 'Capacity', 1, 10000),
          location: text(data.location, 'Location'),
          schedule: text(data.schedule, 'Schedule'),
          created_at: now(),
        };
        this.run(
          'INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'application') {
        this.permitted(actor, ['admissions_officer', 'registrar']);
        const identifier = id();
        result = {
          id: identifier,
          number: 'APP-' + identifier.slice(0, 8).toUpperCase(),
          full_name: text(data.fullName, 'Applicant name'),
          email: email(data.email),
          phone: String(data.phone || '').slice(0, 50),
          program_id: data.programId,
          status: 'submitted',
          decision_note: '',
          created_at: now(),
          updated_at: now(),
        };
        this.run(
          'INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'reviewApplication') {
        this.permitted(actor, ['admissions_officer', 'registrar']);
        before = this.one('SELECT * FROM applications WHERE id=?', data.id);
        if (
          !before ||
          before.status === 'admitted' ||
          !['under_review', 'approved', 'rejected'].includes(data.status)
        )
          throw new WorkflowError(
            'This application cannot move to that state.',
          );
        if (before.status === 'rejected' && data.status !== 'under_review')
          throw new WorkflowError(
            'Reopen a rejected application for review before approving it.',
          );
        const note = text(data.note, 'Review note', 2000);
        this.run(
          'UPDATE applications SET status=?,decision_note=?,updated_at=? WHERE id=?',
          data.status,
          note,
          now(),
          data.id,
        );
        result = { ...before, status: data.status, decision_note: note };
      } else if (action === 'admit') {
        this.permitted(actor, ['registrar']);
        before = this.one(
          'SELECT * FROM applications WHERE id=?',
          data.applicationId,
        );
        if (!before || before.status !== 'approved')
          throw new WorkflowError(
            'Only an approved application can be admitted.',
          );
        const user = this.one(
          "SELECT id FROM users WHERE email=? COLLATE NOCASE AND role IN('student','alumni')",
          before.email,
        );
        result = {
          id: id(),
          user_id: user?.id || null,
          application_id: before.id,
          student_number: text(data.studentNumber, 'Student number', 50),
          full_name: before.full_name,
          email: before.email,
          program_id: before.program_id,
          admitted_term_id: data.termId,
          status: 'active',
          financial_hold: 0,
          created_at: now(),
        };
        this.run(
          'INSERT INTO students VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
        this.run(
          "UPDATE applications SET status='admitted',updated_at=? WHERE id=?",
          now(),
          before.id,
        );
      } else if (action === 'register') {
        // Student selections must pass the separate approved-plan Registrar
        // workflow. Keep authorized Registrar manual registration for
        // institutional exceptions; the audit log records the actor.
        this.permitted(actor, ['registrar']);
        const student = this.studentFor(actor, data.studentId);
        const section = this.one(
          'SELECT s.*,t.status AS term_status,t.max_credits,c.credits,c.code AS course_code FROM sections s JOIN terms t ON s.term_id=t.id JOIN courses c ON s.course_id=c.id WHERE s.id=?',
          data.sectionId,
        );
        if (!section || section.term_status !== 'open')
          throw new WorkflowError('Registration is not open for that section.');
        if (student.status !== 'active' || student.financial_hold)
          throw new WorkflowError(
            'This student is inactive or has a financial hold.',
          );
        if (
          this.one(
            "SELECT COUNT(*) AS n FROM registrations WHERE section_id=? AND status='enrolled'",
            section.id,
          ).n >= section.capacity
        )
          throw new WorkflowError('This section has reached capacity.', 409);
        const current = this.all(
          "SELECT c.id,c.credits FROM registrations r JOIN sections s ON r.section_id=s.id JOIN courses c ON s.course_id=c.id WHERE r.student_id=? AND s.term_id=? AND r.status='enrolled'",
          student.id,
          section.term_id,
        );
        if (current.some((c) => c.id === section.course_id))
          throw new WorkflowError(
            'This course is already registered in the selected term.',
            409,
          );
        if (
          current.reduce((n, c) => n + c.credits, 0) + section.credits >
          section.max_credits
        )
          throw new WorkflowError(
            'This registration exceeds the term credit limit.',
          );
        const missing = this.all(
          'SELECT requires_id FROM course_prerequisites WHERE course_id=?',
          section.course_id,
        ).filter(
          (p) =>
            !this.one(
              "SELECT g.id FROM grades g JOIN registrations r ON g.registration_id=r.id JOIN sections s ON r.section_id=s.id WHERE r.student_id=? AND s.course_id=? AND r.status='enrolled' AND g.status='published' AND g.passed=1",
              student.id,
              p.requires_id,
            ),
        );
        if (missing.length)
          throw new WorkflowError(
            'Published passing grades are required for all prerequisites.',
          );
        result = {
          id: id(),
          student_id: student.id,
          section_id: section.id,
          status: 'enrolled',
          created_at: now(),
          updated_at: now(),
        };
        this.run(
          'INSERT INTO registrations VALUES(?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'drop') {
        this.permitted(actor, ['student', 'registrar']);
        before = this.one('SELECT * FROM registrations WHERE id=?', data.id);
        if (!before || before.status !== 'enrolled')
          throw new WorkflowError('Active registration not found.');
        this.studentFor(actor, before.student_id);
        if (
          this.one(
            "SELECT id FROM grades WHERE registration_id=? AND status='published'",
            before.id,
          )
        )
          throw new WorkflowError(
            'A registration with published grades requires registrar review and cannot be dropped.',
          );
        const section = this.one(
          'SELECT t.status FROM sections s JOIN terms t ON s.term_id=t.id WHERE s.id=?',
          before.section_id,
        );
        if (actor.role === 'student' && section.status !== 'open')
          throw new WorkflowError('Student add/drop is closed for this term.');
        this.run(
          "UPDATE registrations SET status='dropped',updated_at=? WHERE id=?",
          now(),
          before.id,
        );
        const line = this.one(
          'SELECT * FROM invoice_lines WHERE registration_id=?',
          before.id,
        );
        if (line)
          this.run(
            'INSERT INTO credit_notes VALUES(?,?,?,?,?,?,?)',
            id(),
            line.invoice_id,
            before.id,
            line.amount_cents,
            text(data.reason, 'Drop reason', 1000),
            actor.id,
            now(),
          );
        result = {
          ...before,
          status: 'dropped',
          creditCents: line?.amount_cents || 0,
        };
      } else if (action === 'invoice') {
        this.permitted(actor, ['bursar']);
        const student = this.studentFor(actor, data.studentId);
        const due = day(data.dueDate, 'Due date');
        const lines = this.all(
          "SELECT r.id,c.code,c.title,c.credits*c.fee_cents AS amount FROM registrations r JOIN sections s ON r.section_id=s.id JOIN courses c ON s.course_id=c.id LEFT JOIN invoice_lines l ON l.registration_id=r.id WHERE r.student_id=? AND s.term_id=? AND r.status='enrolled' AND l.id IS NULL",
          student.id,
          data.termId,
        );
        if (!lines.length)
          throw new WorkflowError(
            'There are no unbilled registrations for this student and term.',
            409,
          );
        const identifier = id(),
          amount = lines.reduce((n, l) => n + l.amount, 0);
        result = {
          id: identifier,
          student_id: student.id,
          term_id: data.termId,
          number: 'INV-' + identifier.slice(0, 8).toUpperCase(),
          amount_cents: amount,
          due_date: due,
          posted_by: actor.id,
          created_at: now(),
        };
        this.run(
          'INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
        for (const line of lines)
          this.run(
            'INSERT INTO invoice_lines VALUES(?,?,?,?,?)',
            id(),
            identifier,
            line.id,
            line.code + ' · ' + line.title,
            line.amount,
          );
      } else if (action === 'payment') {
        this.permitted(actor, ['bursar']);
        const invoice = this.one(
          'SELECT * FROM invoices WHERE id=?',
          data.invoiceId,
        );
        if (!invoice) throw new WorkflowError('Invoice not found.');
        const amount = money(data.amount);
        if (amount <= 0 || amount > this.invoiceBalance(invoice.id))
          throw new WorkflowError(
            'Payment must be positive and no greater than the invoice balance.',
          );
        if (!['bank', 'mobile_money', 'cash'].includes(data.method))
          throw new WorkflowError('Choose a supported receipt method.');
        result = {
          id: id(),
          invoice_id: invoice.id,
          reference: text(data.reference, 'Bank or receipt reference', 120),
          amount_cents: amount,
          method: data.method,
          received_date: day(data.receivedDate, 'Receipt date'),
          status: 'recorded',
          recorded_by: actor.id,
          reviewed_by: null,
          review_note: '',
          created_at: now(),
          reviewed_at: null,
        };
        this.run(
          'INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'reconcilePayment') {
        this.permitted(actor, ['bursar']);
        before = this.one('SELECT * FROM payments WHERE id=?', data.id);
        if (!before || before.status !== 'recorded')
          throw new WorkflowError(
            'Only a recorded payment can be reviewed.',
            409,
          );
        if (actor.role === 'bursar' && before.recorded_by === actor.id)
          throw new WorkflowError(
            'A second bursar or administrator must reconcile this receipt.',
            403,
          );
        if (!['reconciled', 'cancelled'].includes(data.status))
          throw new WorkflowError('Choose reconcile or cancel.');
        if (
          data.status === 'reconciled' &&
          before.amount_cents > this.invoiceBalance(before.invoice_id)
        )
          throw new WorkflowError(
            'Reconciliation would overpay this invoice.',
            409,
          );
        const note = text(data.note, 'Reconciliation note', 1000);
        this.run(
          'UPDATE payments SET status=?,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=?',
          data.status,
          actor.id,
          note,
          now(),
          before.id,
        );
        result = { ...before, status: data.status };
      } else if (action === 'hold') {
        this.permitted(actor, ['bursar']);
        before = this.studentFor(actor, data.studentId);
        const hold = data.hold === true || data.hold === 'true';
        text(data.reason, 'Hold reason', 1000);
        this.run(
          'UPDATE students SET financial_hold=? WHERE id=?',
          hold ? 1 : 0,
          before.id,
        );
        result = {
          ...before,
          financial_hold: hold ? 1 : 0,
          reason: data.reason,
        };
      } else if (action === 'gradeScheme') {
        this.permitted(actor, ['registrar']);
        const definition = data.definition;
        if (
          !Array.isArray(definition) ||
          definition.length < 2 ||
          definition.length > 15
        )
          throw new WorkflowError('Provide a grading scale.');
        let previous = 101;
        const clean = definition.map((r: any) => {
          const min = integer(r.min, 'Score boundary', 0, 100);
          const points = Number(r.points);
          if (
            min >= previous ||
            !Number.isFinite(points) ||
            points < 0 ||
            points > 4 ||
            typeof r.passed !== 'boolean'
          )
            throw new WorkflowError(
              'Use descending unique score boundaries, points from 0 to 4, and passing flags.',
            );
          previous = min;
          return {
            min,
            letter: text(r.letter, 'Grade label', 5),
            points,
            passed: r.passed,
          };
        });
        if (clean.at(-1)?.min !== 0)
          throw new WorkflowError(
            'The scale must include a zero-score boundary.',
          );
        result = {
          id: id(),
          title: text(data.title, 'Scale title'),
          definition: JSON.stringify(clean),
          approved_by: actor.id,
          approved_at: now(),
        };
        this.run(
          'INSERT INTO grade_schemes VALUES(?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'grade') {
        this.permitted(actor, ['lecturer', 'dean']);
        const registration = this.one(
          "SELECT r.*,s.lecturer_id FROM registrations r JOIN sections s ON r.section_id=s.id WHERE r.id=? AND r.status='enrolled'",
          data.registrationId,
        );
        if (!registration)
          throw new WorkflowError('Active registration not found.');
        if (
          actor.role !== 'super_admin' &&
          registration.lecturer_id !== actor.id
        )
          throw new WorkflowError(
            'This section is not assigned to your account.',
            403,
          );
        const score = Number(data.score);
        if (
          data.score == null ||
          data.score === '' ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > 100
        )
          throw new WorkflowError('Score must be between 0 and 100.');
        before = this.one(
          'SELECT * FROM grades WHERE registration_id=?',
          registration.id,
        );
        if (before?.status === 'published')
          throw new WorkflowError(
            'Published grades are locked. Ask the registrar to review an amendment.',
          );
        const status = data.submit ? 'submitted' : 'draft';
        this.run(
          'INSERT INTO grades(id,registration_id,score,status,entered_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(registration_id) DO UPDATE SET score=excluded.score,status=excluded.status,entered_by=excluded.entered_by,updated_at=excluded.updated_at',
          before?.id || id(),
          registration.id,
          score,
          status,
          actor.id,
          now(),
        );
        result = this.one(
          'SELECT * FROM grades WHERE registration_id=?',
          registration.id,
        );
      } else if (action === 'publishGrade') {
        this.permitted(actor, ['registrar']);
        before = this.one('SELECT * FROM grades WHERE id=?', data.id);
        if (!before || before.status !== 'submitted')
          throw new WorkflowError('Only a submitted grade can be published.');
        const scheme = this.one(
          'SELECT * FROM grade_schemes ORDER BY approved_at DESC,id DESC LIMIT 1',
        );
        if (!scheme)
          throw new WorkflowError(
            'The registrar must approve a grading scale before publishing.',
          );
        const band = JSON.parse(scheme.definition).find(
          (r: any) => before.score >= r.min,
        );
        this.run(
          "UPDATE grades SET status='published',letter=?,points=?,passed=?,scheme_id=?,published_by=?,updated_at=? WHERE id=?",
          band.letter,
          band.points,
          band.passed ? 1 : 0,
          scheme.id,
          actor.id,
          now(),
          before.id,
        );
        result = this.one('SELECT * FROM grades WHERE id=?', before.id);
      } else if (action === 'graduationRequest') {
        this.permitted(actor, ['student', 'registrar']);
        const student = this.studentFor(actor, data.studentId);
        if (student.status !== 'active')
          throw new WorkflowError('An active student record is required.');
        result = {
          id: id(),
          student_id: student.id,
          status: 'requested',
          note: '',
          reviewed_by: null,
          created_at: now(),
          reviewed_at: null,
        };
        this.run(
          'INSERT INTO graduation_reviews VALUES(?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'graduationReview') {
        this.permitted(actor, ['registrar']);
        before = this.one(
          'SELECT * FROM graduation_reviews WHERE id=?',
          data.id,
        );
        if (
          !before ||
          before.status !== 'requested' ||
          !['approved', 'rejected'].includes(data.status)
        )
          throw new WorkflowError('Invalid graduation review.');
        const eligibility = this.eligibility(before.student_id);
        if (data.status === 'approved' && !eligibility.eligible)
          throw new WorkflowError(
            'Required credits, required courses, and financial clearance must be satisfied before approval.',
          );
        const note = text(data.note, 'Registrar review note', 2000);
        this.run(
          'UPDATE graduation_reviews SET status=?,note=?,reviewed_by=?,reviewed_at=? WHERE id=?',
          data.status,
          note,
          actor.id,
          now(),
          before.id,
        );
        if (data.status === 'approved')
          this.run(
            "UPDATE students SET status='graduated' WHERE id=?",
            before.student_id,
          );
        result = { ...before, status: data.status, eligibility };
      } else if (action === 'alumniProfile') {
        this.permitted(actor, ['alumni']);
        const student = this.studentFor(actor);
        if (student.status !== 'graduated')
          throw new WorkflowError(
            'A graduated student record must be linked to this account.',
          );
        this.run(
          'INSERT INTO alumni_profiles VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profession=excluded.profession,employer=excluded.employer,updated_at=excluded.updated_at',
          actor.id,
          text(data.profession, 'Profession'),
          text(data.employer, 'Employer'),
          now(),
        );
        result = this.one(
          'SELECT * FROM alumni_profiles WHERE user_id=?',
          actor.id,
        );
      } else if (action === 'transcriptRequest') {
        this.permitted(actor, ['student', 'alumni']);
        const student = this.studentFor(actor);
        result = {
          id: id(),
          student_id: student.id,
          purpose: text(data.purpose, 'Purpose', 1000),
          status: 'requested',
          reviewed_by: null,
          note: '',
          created_at: now(),
        };
        this.run(
          'INSERT INTO transcript_requests VALUES(?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'transcriptReview') {
        this.permitted(actor, ['registrar']);
        before = this.one(
          'SELECT * FROM transcript_requests WHERE id=?',
          data.id,
        );
        if (
          !before ||
          !['under_review', 'issued', 'declined'].includes(data.status)
        )
          throw new WorkflowError('Invalid transcript review.');
        this.run(
          'UPDATE transcript_requests SET status=?,note=?,reviewed_by=? WHERE id=?',
          data.status,
          text(data.note, 'Review note', 1000),
          actor.id,
          before.id,
        );
        result = { ...before, status: data.status };
      } else if (action === 'task') {
        this.permitted(actor, [
          'registrar',
          'dean',
          'lecturer',
          'bursar',
          'admissions_officer',
        ]);
        result = {
          id: id(),
          title: text(data.title, 'Task title'),
          description: text(data.description, 'Task description', 2000),
          assignee_id: data.assigneeId,
          status: 'todo',
          due_date: day(data.dueDate, 'Due date'),
          created_by: actor.id,
          created_at: now(),
        };
        this.run(
          'INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?)',
          ...Object.values(result),
        );
      } else if (action === 'taskStatus') {
        before = this.one('SELECT * FROM tasks WHERE id=?', data.id);
        if (
          !before ||
          (!['super_admin', 'registrar'].includes(actor.role) &&
            before.assignee_id !== actor.id) ||
          !['todo', 'in_progress', 'completed'].includes(data.status)
        )
          throw new WorkflowError(
            'This task cannot be updated by your account.',
            403,
          );
        this.run(
          'UPDATE tasks SET status=? WHERE id=?',
          data.status,
          before.id,
        );
        result = { ...before, status: data.status };
      } else throw new WorkflowError('Unknown workflow action.');
      this.audit(actor, action, result.id || action, before, result);
      // Explicit workflow notifications only: no sample, global, or inferred events.
      if (action === 'task' && result.assignee_id !== actor.id) {
        this.notify(result.assignee_id, 'task', 'New task assigned', 'A university task has been assigned to your account.');
      } else if (action === 'taskStatus' && result.created_by !== actor.id) {
        this.notify(result.created_by, 'task', 'Task status changed', 'A university task you created has changed status.');
      } else if (action === 'publishGrade') {
        const row = this.one(
          'SELECT u.id AS recipient_id FROM grades g JOIN registrations r ON r.id=g.registration_id JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id WHERE g.id=? AND g.status=?',
          result.id, 'published',
        );
        if (row?.recipient_id)
          this.notify(row.recipient_id, 'academic', 'A course result was published', 'A new result is available in your academic record.');
      } else if (action === 'transcriptReview') {
        const row = this.one('SELECT s.user_id AS recipient_id FROM transcript_requests t JOIN students s ON s.id=t.student_id WHERE t.id=?',result.id);
        if (row?.recipient_id)
          this.notify(row.recipient_id, 'records', 'Transcript request updated', 'The status of your transcript request has changed.');
      }
      return result;
    });
  }
  notify(recipientId: string, kind: string, title: string, body: string) {
    // Stored in the same SQLite transaction as the triggering workflow.
    this.run(
      'INSERT INTO notifications(id,recipient_id,kind,title,body,created_at,read_at) VALUES(?,?,?,?,?,?,NULL)',
      id(), recipientId, kind, title, body, now(),
    );
  }
  notificationsFor(actor: Actor) {
    return this.all(
      'SELECT id,kind,title,body,created_at,read_at FROM notifications WHERE recipient_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',
      actor.id,
    );
  }
  readNotification(actor: Actor, notificationId: string) {
    if (typeof notificationId !== 'string' || !/^[a-f0-9-]{36}$/.test(notificationId))
      throw new WorkflowError('Invalid notification identifier.', 400);
    const result = this.run(
      "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?",
      now(), notificationId, actor.id,
    );
    if (!result.changes) throw new WorkflowError('Notification not found.', 404);
    return { success: true };
  }
  readAllNotifications(actor: Actor) {
    this.run('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL',now(),actor.id);
    return { success: true };
  }
  exportSnapshot() {
    const tables: Record<string, any[]> = {};
    for (const name of operationalTables)
      tables[name] = this.all(`SELECT * FROM ${name}`);
    return {
      schemaVersion: 1,
      users: this.users(),
      courses: tables.courses,
      registrations: tables.registrations,
      notifications: this.all('SELECT * FROM notifications ORDER BY created_at,id'),
      tables,
    };
  }
  importSnapshot(data: any) {
    if (
      data?.schemaVersion !== 1 ||
      !data.tables ||
      !operationalTables.filter(name => !['curriculum_programs','curriculum_courses','curriculum_publications','student_assistance_requests','student_course_plans','student_course_plan_commits',
        'institutional_partners','institutional_partner_agreements','institutional_partner_members',
        'institutional_partner_resources','institutional_partner_distributions',
        'institutional_partner_distribution_grants','institutional_partner_events',
        'institutional_partner_event_registrations'].includes(name)).every((name) => Array.isArray(data.tables[name]))
    )
      throw new WorkflowError(
        'Snapshot is not a relational operations snapshot.',
      );
    this.transaction(() => {
      // Restore recipient inboxes only when present in newer snapshots.
      // Older schemaVersion=1 backups remain valid and restore to an empty inbox.
      this.run('DELETE FROM notifications');
      for (const name of [...operationalTables].reverse())
        this.run(`DELETE FROM ${name}`);
      for (const name of operationalTables) {
        const columns = this.all(`PRAGMA table_info(${name})`).map(
          (c) => c.name,
        );
        for (const row of data.tables[name] ?? []) {
          if (!Object.keys(row).every((key) => columns.includes(key)))
            throw new WorkflowError('Unexpected snapshot columns.');
          this.run(
            `INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            ...columns.map((key) => row[key] ?? null),
          );
        }
      }
      if (Array.isArray(data.notifications)) {
        for (const row of data.notifications) {
          if (!row || typeof row !== 'object' || !['id','recipient_id','kind','title','body','created_at','read_at'].every(key => Object.prototype.hasOwnProperty.call(row,key)))
            throw new WorkflowError('Invalid notification backup record.');
          this.run('INSERT INTO notifications(id,recipient_id,kind,title,body,created_at,read_at) VALUES(?,?,?,?,?,?,?)',
            row.id,row.recipient_id,row.kind,row.title,row.body,row.created_at,row.read_at);
        }
      }
      this.audit('system', 'SNAPSHOT_RESTORE', 'operations', null, {
        restoredAt: now(),
      });
    });
  }
  close() {
    this.sql.close();
  }
}
