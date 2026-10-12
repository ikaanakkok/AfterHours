import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  CalendarDays,
  Cpu,
  Globe,
  Inbox,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Phone,
  Settings2,
  Workflow,
  Radio,
} from 'lucide-react';
export const sections = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    group: 'WORKSPACE',
    description: 'What is happening in your business today?',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    group: 'WORKSPACE',
    description: 'Manage customer conversations in one place.',
  },
  {
    id: 'agent-operations',
    label: 'Agent Operations',
    icon: Activity,
    group: 'WORKSPACE',
    description: 'Track human interventions and your agent’s activity.',
  },
  {
    id: 'context',
    label: 'Context',
    icon: BookOpen,
    group: 'WORKSPACE',
    description: 'Add business information and answer open questions.',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: Workflow,
    group: 'WORKSPACE',
    description: 'Describe tasks in plain language, then test and verify them.',
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    group: 'WORKSPACE',
    description: 'Review drafted emails and track sent messages.',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: CalendarDays,
    group: 'WORKSPACE',
    description: 'Manage appointments and availability using your business rules.',
  },
  {
    id: 'management',
    label: 'Management Assistant',
    icon: MessageSquare,
    group: 'WORKSPACE',
    description: 'Describe your business and build lasting settings together.',
    admin: true,
  },
  {
    id: 'front-desk-channels',
    label: 'Front Desk Channels',
    icon: Radio,
    group: 'SETTINGS',
    description: 'Connect the channels you use to communicate with customers.',
    admin: true,
  },
  {
    id: 'backoffice-systems',
    label: 'Backoffice Systems',
    icon: Globe,
    group: 'SETTINGS',
    description: 'Name your business systems and test their sign-in flows.',
    admin: true,
  },
  {
    id: 'ai-providers',
    label: 'AI Providers',
    icon: Cpu,
    group: 'SETTINGS',
    description: 'Configure your AI provider and model securely.',
    admin: true,
  },
  {
    id: 'settings',
    label: 'Business Settings',
    icon: Settings2,
    group: 'SETTINGS',
    description: 'Business details, active hours, and permissions.',
    admin: true,
  },
  {
    id: 'voice',
    label: 'Voice Channels',
    icon: Phone,
    group: 'SETTINGS',
    description: 'Verification status for Mac and iPhone voice channels.',
    admin: true,
  },
] as const satisfies Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  description: string;
  admin?: boolean;
}>;
export type Section = (typeof sections)[number]['id'];
export function isSection(value: string): value is Section {
  return sections.some((section) => section.id === value);
}
export const sectionInfo = (value: Section) => sections.find((section) => section.id === value)!;
