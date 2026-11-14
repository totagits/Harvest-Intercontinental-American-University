import type { UserRole } from '../types';

/**
 * HIAU application migration: canonical list of actually rendered portal modules.
 * Navigation is presentation only. Server RBAC remains the authorization boundary.
 * Do not add a module until its corresponding App renderer and server API exist.
 */
export const PORTAL_MODULES = [
  { id: 'tasks', label: 'Operations', group: 'primary' },
  { id: 'analytics', label: 'Analytics', group: 'primary' },
  { id: 'faculty_admin', label: 'Faculty & Staff', group: 'primary' },
  { id: 'academics', label: 'Academic Planning', group: 'primary' },
  { id: 'curriculum', label: 'Curriculum Studio', group: 'secondary' },
  { id: 'collaboration_hub', label: 'Global Collaboration Hub', group: 'secondary' },
  { id: 'collaboration_events', label: 'Joint Lectures & Symposiums', group: 'secondary' },
  { id: 'partners', label: 'Institutional Partnerships', group: 'secondary' },
  { id: 'partner_resources', label: 'Academic Resource Exchange', group: 'secondary' },
  { id: 'partner_distribution', label: 'Partner Distribution', group: 'secondary' },
  { id: 'partner_library', label: 'Partner Academic Library', group: 'secondary' },
  { id: 'website_media', label: 'Website Video Library', group: 'secondary' },
  { id: 'website_staff', label: 'Public Staff Profiles', group: 'secondary' },
  { id: 'campus_content', label: 'Campus Content Manager', group: 'secondary' },
  { id: 'website_cms', label: 'Website Content CMS', group: 'secondary' },
  { id: 'website_news', label: 'Website News & Events', group: 'secondary' },
  { id: 'admissions', label: 'Admissions', group: 'primary' },
  { id: 'finance', label: 'Finance', group: 'primary' },
  { id: 'compliance', label: 'Compliance & Audit', group: 'primary' },
  { id: 'accounts', label: 'Account & Integrations', group: 'primary' },
  { id: 'student_portal', label: 'Student Workspace', group: 'secondary' },
  { id: 'classroom', label: 'Online & Hybrid Classroom', group: 'secondary' },
] as const;

export type PortalModuleId = (typeof PORTAL_MODULES)[number]['id'];
export const PORTAL_MODULE_IDS: ReadonlySet<string> = new Set(PORTAL_MODULES.map(m => m.id));

const visibleByRole: Record<UserRole, readonly PortalModuleId[]> = {
  super_admin: PORTAL_MODULES.filter(m => m.id !== 'student_portal').map(m => m.id),
  website_editor: ['website_cms','website_news'],
  website_reviewer: ['website_cms','website_news'],
  registrar: ['tasks', 'academics', 'admissions', 'curriculum'],
  dean: ['tasks', 'analytics', 'faculty_admin', 'academics', 'compliance', 'collaboration_hub', 'collaboration_events', 'classroom','partner_library'],
  lecturer: ['tasks', 'faculty_admin', 'collaboration_hub', 'collaboration_events', 'classroom', 'partner_library'],
  bursar: ['tasks', 'finance'],
  admissions_officer: ['tasks', 'admissions'],
  student: ['student_portal', 'collaboration_hub', 'collaboration_events', 'academics', 'classroom', 'partner_library'],
  partner_representative: ['collaboration_hub', 'collaboration_events', 'partner_resources'],
  alumni: [],
};

export const portalModulesForRole = (role: UserRole) =>
  PORTAL_MODULES.filter(module => visibleByRole[role]?.includes(module.id));

export const isPortalModuleAvailable = (role: UserRole, id: string) =>
  PORTAL_MODULE_IDS.has(id) && !!visibleByRole[role]?.includes(id as PortalModuleId);

export const defaultPortalModule = (role: UserRole): PortalModuleId | null =>
  visibleByRole[role]?.[0] ?? null;
