export function resolveWorkflowSystems(
  text: string,
  connections: Array<{ id: string; name: string; kind: string }>,
): { systemIds: string[]; error: string | null } {
  const steps = text
    .split('>')
    .map((v) => v.trim())
    .filter(Boolean);
  const systems: string[] = [];
  const errors: string[] = [];
  for (const step of steps) {
    const matching = connections.filter(
      (c) =>
        ['browser', 'google_calendar', 'microsoft_calendar', 'gmail', 'outlook', 'mcp'].includes(
          c.kind,
        ) && step.toLocaleLowerCase('tr').includes(c.name.toLocaleLowerCase('tr')),
    );
    if (matching.length > 1)
      errors.push(`“${step.slice(0, 100)}” birden fazla sisteme uyuyor; sistem ismini açık yazın.`);
    else if (matching[0] && !systems.includes(matching[0].id)) systems.push(matching[0].id);
  }
  if (!systems.length)
    errors.push('Metinde kayıtlı bir Backoffice sistemi veya kanal ismini belirtin.');
  return { systemIds: systems, error: errors.join(' ') || null };
}
