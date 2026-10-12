import { notFound, redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { isSection } from '@/lib/sections';

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const aliases: Record<string, string> = {
    teaching: 'context',
    cron: 'workflows',
    approvals: 'agent-operations',
    operations: 'agent-operations',
    integrations: 'front-desk-channels',
    payments: 'overview',
  };
  if (aliases[section]) redirect(`/${aliases[section]}`);
  if (!isSection(section)) notFound();
  return <Workspace section={section} />;
}
