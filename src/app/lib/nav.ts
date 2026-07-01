// Canonical sidebar nav config for the redesign (UI initiative). Used by the live app (App.svelte)
// and re-exported by the /dev preview harness + styleguide. Icons are @lucide/svelte components.
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
