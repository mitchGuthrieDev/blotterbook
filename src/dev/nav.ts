// Shared nav config for the redesign (UI initiative, Phase 2). Used by both the styleguide and the
// Dashboard preview harness so the sidebar structure has a single source. Icons are @lucide/svelte
// components. (Lives under src/dev/ for now; relocates into the real app at cutover.)
import { LayoutDashboard, CalendarDays, ChartLine, Table2, Database, List, FileText } from '@lucide/svelte';
import type { NavSection } from '$lib/components/shell/SidebarNav.svelte';

export const navSections: NavSection[] = [
  {
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'calendar', label: 'Calendar', icon: CalendarDays },
      { key: 'analytics', label: 'Analytics', icon: ChartLine },
      { key: 'blotter', label: 'Blotter', icon: Table2 },
    ],
  },
  {
    label: 'Data Management',
    items: [
      { key: 'csv', label: 'CSV Library', icon: Database },
      { key: 'trades', label: 'Trade Editor', icon: List },
      { key: 'reports', label: 'Reports', icon: FileText },
    ],
  },
];

export const navItems = navSections.flatMap(s => s.items);
export const navLabel = (key: string): string => navItems.find(i => i.key === key)?.label ?? '';
