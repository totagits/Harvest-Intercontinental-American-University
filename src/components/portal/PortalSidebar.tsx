import React, { useEffect, useState } from 'react';
import {
  BarChart3, BookOpen, Building2, CalendarDays, ChevronLeft, ChevronRight, CreditCard, Globe2, GraduationCap,
  Inbox, ListTodo, Menu, Settings, ShieldCheck, User, Users, X,
} from 'lucide-react';
import type { UserProfile } from '../../types';
import {
  portalModulesForRole, type PortalModuleId,
} from '../../portal/moduleRegistry';

interface PortalSidebarProps {
  currentUser: UserProfile;
  activeTab: string;
  onSelectTab: (tabId: string) => void;
}

const moduleIcons: Record<PortalModuleId, React.ElementType> = {
  tasks: ListTodo,
  analytics: BarChart3,
  faculty_admin: Users,
  academics: BookOpen,
  curriculum: BookOpen,
  collaboration_hub: Globe2,
  collaboration_events: CalendarDays,
  partners: Building2,
  partner_resources: BookOpen,
  partner_distribution: ShieldCheck,
  partner_library: BookOpen,
  admissions: Inbox,
  finance: CreditCard,
  compliance: ShieldCheck,
  student_portal: User,
  classroom: GraduationCap,
  website_media: Settings,
  website_staff: Users,
  campus_content: Settings,
  website_cms: Settings,
  website_news: Settings,
  accounts: Settings,
};

export const PortalSidebar: React.FC<PortalSidebarProps> = ({
  currentUser, activeTab, onSelectTab,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<'primary' | 'secondary', boolean>>({primary:true,secondary:true});
  const modules = portalModulesForRole(currentUser.role);
  const primary = modules.filter(module => module.group === 'primary');
  const secondary = modules.filter(module => module.group === 'secondary');

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown',handleKey);
    return () => window.removeEventListener('keydown',handleKey);
  }, [drawerOpen]);

  // The mobile drawer never remains over a different authenticated workspace.
  useEffect(() => { setDrawerOpen(false); }, [activeTab, currentUser.role]);

  const goTo = (id: string) => {
    onSelectTab(id);
    setDrawerOpen(false);
  };

  const group = (label: string, key: 'primary' | 'secondary',
    entries: typeof modules) => entries.length > 0 && (
    <section aria-label={label} className="mb-4 min-w-0">
      <button type="button"
        className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs font-bold uppercase tracking-[0.12em] text-[#7D6581] hover:bg-[#F5EEF6] ${collapsed ? 'lg:justify-center' : ''}`}
        aria-expanded={expanded[key]} onClick={() => setExpanded(open => ({...open,[key]:!open[key]}))}>
        <span className={collapsed ? 'lg:sr-only' : ''}>{label}</span>
        <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded[key] ? 'rotate-90' : ''}`} />
      </button>
      {expanded[key] && (
        <div className="mt-1 space-y-1">
          {entries.map(module => {
            const Icon = moduleIcons[module.id];
            const selected = activeTab === module.id;
            return (
              <button type="button" key={module.id}
                title={collapsed ? module.label : undefined}
                onClick={() => goTo(module.id)}
                aria-current={selected ? 'page' : undefined}
                className={`hiau-sidebar-item flex min-w-0 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4A1249] ${selected
                  ? 'hiau-dashboard-selected bg-[#4A1249] text-white'
                  : 'text-[#4A1249] hover:bg-[#F4EDF4]'} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}>
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className={`min-w-0 ${collapsed ? 'lg:sr-only' : ''} `}>{module.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  const contents = (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#EEE8F0] px-4 py-4">
        <div className={collapsed ? 'lg:sr-only' : ''}>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#98723A]">HIAU Workspace</p>
          <p className="mt-1 text-xs capitalize text-slate-600">{currentUser.role.replaceAll('_',' ')}</p>
        </div>
        <button type="button" aria-label="Collapse or expand sidebar"
          aria-expanded={!collapsed}
          className="hidden rounded-md p-2 text-[#4A1249] hover:bg-[#F4EDF4] lg:inline-flex"
          onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
        <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}
          className="rounded-md p-2 text-[#4A1249] hover:bg-[#F4EDF4] lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav aria-label="ERP workspace navigation" className="min-w-0 flex-1 overflow-y-auto px-3 py-5">
        {group('University operations','primary',primary)}
        {group('Specialized workspaces','secondary',secondary)}
        {modules.length === 0 && (
          <p className="px-2 text-sm leading-6 text-slate-600">
            No ERP modules are assigned to this role. Contact your university administrator.
          </p>
        )}
      </nav>
      <p className={`border-t border-[#EEE8F0] px-4 py-3 text-xs text-slate-500 ${collapsed ? 'lg:sr-only' : ''}`}>
        Modules shown according to your assigned role. Server permissions control access to records and actions.
      </p>
    </div>
  );

  return (
    <>
      <div className="border-b border-[#EEE8F0] bg-white px-5 py-2 lg:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen} aria-controls="hiau-mobile-workspace-navigation"
          className="inline-flex items-center gap-2 rounded-md border border-[#E5DDE7] px-3 py-2 text-sm font-semibold text-[#4A1249]">
          <Menu className="h-4 w-4" /> Workspace menu
        </button>
      </div>
      {drawerOpen && (
        <button type="button" tabIndex={-1} aria-label="Close workspace menu"
          className="fixed inset-0 z-[65] cursor-default bg-[#201020]/50 lg:hidden"
          onClick={() => setDrawerOpen(false)} />
      )}
      <aside id="hiau-mobile-workspace-navigation"
        className={`hiau-erp-sidebar z-[70] h-full min-w-0 shrink-0 border-r border-[#E9E1EB] bg-white transition-transform
          fixed inset-y-0 left-0 w-[min(82vw,310px)] shadow-xl lg:relative lg:inset-auto lg:z-10 lg:h-auto lg:translate-x-0 lg:shadow-none
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
          ${collapsed ? 'lg:w-[76px]' : 'lg:w-[248px]'}`}>
        {contents}
      </aside>
    </>
  );
};
