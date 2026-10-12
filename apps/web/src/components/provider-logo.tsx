import type { ChannelKind } from './sections/integrations';

export function ProviderLogo({ kind, size = 26 }: { kind: ChannelKind; size?: number }) {
  if (kind === 'whatsapp') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="WhatsApp">
        <path
          fill="#25D366"
          d="M24 3a20.7 20.7 0 0 0-17.8 31.3L3 45l11.1-3A20.8 20.8 0 1 0 24 3Z"
        />
        <path
          fill="#fff"
          d="M24 7a16.8 16.8 0 0 0-14.4 25.4l.6 1-1.8 6.6 6.8-1.8 1 .6A16.8 16.8 0 1 0 24 7Zm9.4 24.1c-.4 1.1-2.2 2-3.1 2.1-.8.1-1.8.2-2.9-.2-.7-.2-1.5-.5-2.6-1-4.5-2-7.4-6.6-7.6-6.9-.2-.3-1.8-2.4-1.8-4.6s1.1-3.3 1.5-3.8c.4-.4.9-.5 1.2-.5h.9c.3 0 .7-.1 1 .8.4.9 1.3 3.1 1.4 3.3.1.2.2.5 0 .8-.1.3-.2.5-.4.7-.2.2-.5.6-.7.8-.2.2-.5.5-.2 1 .3.5 1.2 2 2.6 3.2 1.8 1.6 3.3 2.1 3.8 2.4.5.2.8.2 1.1-.2.3-.4 1.3-1.5 1.6-2 .3-.5.7-.4 1.1-.2.5.2 2.8 1.3 3.2 1.6.5.2.8.4.9.6.1.2.1 1.2-.3 2.3Z"
        />
      </svg>
    );
  }

  if (kind === 'gmail') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Gmail">
        <path
          fill="#4285F4"
          d="M6 12.5A4.5 4.5 0 0 1 10.5 8H13l11 8.5L35 8h2.5a4.5 4.5 0 0 1 4.5 4.5V38h-8V18L24 25.5 14 18v20H6V12.5Z"
        />
        <path
          fill="#EA4335"
          d="M6 12.5A4.5 4.5 0 0 1 10.5 8H13l11 8.5L35 8h2.5a4.5 4.5 0 0 1 3.1 1.2L24 24 6 9.2a4.5 4.5 0 0 0 0 3.3Z"
        />
        <path fill="#34A853" d="M6 12.5V38h8V18L6 12.5Z" />
        <path fill="#FBBC04" d="M34 18v20h8V12.5L34 18Z" />
      </svg>
    );
  }

  if (kind === 'outlook') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Outlook">
        <path fill="#0078D4" d="M25 8h15a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H25V8Z" />
        <path fill="#28A8EA" d="M25 13h18v22H25V13Z" />
        <path fill="#fff" d="m26 18 8 6 9-6v3l-9 6-8-6v-3Z" />
        <path fill="#185ABD" d="M5 14.5 25 11v26L5 33.5v-19Z" />
        <path
          fill="#fff"
          d="M15 17c-4.2 0-7 3-7 7s2.8 7 7 7 7-3 7-7-2.8-7-7-7Zm0 11c-1.8 0-3-1.5-3-4s1.2-4 3-4 3 1.5 3 4-1.2 4-3 4Z"
        />
      </svg>
    );
  }

  if (kind === 'google_calendar') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Google Calendar">
        <path fill="#4285F4" d="M8 11h32v29H8z" />
        <path fill="#34A853" d="M8 11h8v29H8z" />
        <path fill="#EA4335" d="M8 11a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v3H8v-3Z" />
        <path fill="#FBBC04" d="M36 11h4v29h-4z" />
        <path fill="#fff" d="M18 19h12v14H18z" />
        <path fill="#4285F4" d="M21 22h6v2h-4v2h3v2h-3v2h4v2h-6V22Z" />
      </svg>
    );
  }

  if (kind === 'microsoft_calendar') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label="Microsoft Calendar"
      >
        <path fill="#F25022" d="M5 5h17v17H5z" />
        <path fill="#7FBA00" d="M26 5h17v17H26z" />
        <path fill="#00A4EF" d="M5 26h17v17H5z" />
        <path fill="#FFB900" d="M26 26h17v17H26z" />
      </svg>
    );
  }

  return null;
}
