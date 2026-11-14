import type { Express } from 'express';
import { actorOf } from './identity';
import type { Operations } from './operations';

/** Aggregate only persisted university records. Never generate demonstration metrics. */
export function installLiveAnalytics(app: Express, store: Operations) {
  app.get('/api/analytics/overview', (_req, res) => {
    const actor = actorOf(res);
    if (!actor) return res.status(401).json({ error: 'Sign in required.' });
    if (!['super_admin', 'registrar', 'dean', 'bursar'].includes(actor.role)) {
      return res.status(403).json({ error: 'Analytics access is restricted.' });
    }
    try {
      const number = (sql: string) => Number(store.one(sql)?.n ?? 0);
      const tasks = {
        total: number('SELECT COUNT(*) AS n FROM tasks'),
        completed: number("SELECT COUNT(*) AS n FROM tasks WHERE status='completed'"),
        inProgress: number("SELECT COUNT(*) AS n FROM tasks WHERE status='in_progress'"),
      };
      const applications = {
        total: number('SELECT COUNT(*) AS n FROM applications'),
        admitted: number("SELECT COUNT(*) AS n FROM applications WHERE status='admitted'"),
        underReview: number("SELECT COUNT(*) AS n FROM applications WHERE status='under_review'"),
      };
      const academics = {
        activeStudents: number("SELECT COUNT(*) AS n FROM students WHERE status='active'"),
        activeSections: number("SELECT COUNT(*) AS n FROM sections s JOIN terms t ON t.id=s.term_id WHERE t.status='open'"),
        enrolledSeats: number("SELECT COUNT(*) AS n FROM registrations WHERE status='enrolled'"),
      };
      const finance = {
        billedCents: number('SELECT COALESCE(SUM(amount_cents),0) AS n FROM invoices'),
        creditsCents: number(`SELECT
          COALESCE((SELECT SUM(amount_cents) FROM credit_notes),0)+
          COALESCE((SELECT SUM(amount_cents) FROM student_assistance_awards),0) AS n`),
        reconciledCents: number("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payments WHERE status='reconciled'"),
      };
      const auditCount = number('SELECT COUNT(*) AS n FROM audit');
      const enrollmentByProgram = store.all(
        "SELECT p.title AS program, COUNT(s.id) AS enrolled FROM programs p LEFT JOIN students s ON s.program_id=p.id AND s.status='active' GROUP BY p.id,p.title ORDER BY p.title"
      ).map(row => ({ program: String(row.program), enrolled: Number(row.enrolled) }));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        source: 'persisted-records',
        asOf: new Date().toISOString(),
        tasks, applications, academics, finance, auditCount, enrollmentByProgram,
        unavailable: ['Accreditation compliance score', 'Attendance rate', 'Average CGPA', 'SLA compliance'],
      });
    } catch {
      return res.status(500).json({ error: 'University analytics could not be calculated.' });
    }
  });
}
