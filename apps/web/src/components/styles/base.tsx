'use client';

export function BaseStyles() {
  return (
    <style jsx global>{`
      :root {
        --canvas: #f8f9fa;
        --surface: #fff;
        --ink: #202020;
        --muted: #646464;
        --line: #e8e8e8;
        --accent: #6647f0;
        --accent-light: #f0ecff;
        --nav: #fff;
        --green: #176344;
        --green-light: #e9f6ef;
        --red: #a52b37;
        --red-light: #fff0f2;
        --amber: #8a4b0f;
        --amber-light: #fff4e5;
        --blue: #245b91;
        --blue-light: #edf5ff;
        --radius-input: 9px;
        --radius-pill: 9999px;
        --space-1: 4px;
        --space-2: 8px;
        --space-3: 12px;
        --space-4: 16px;
        --space-5: 20px;
        --space-6: 24px;
        --space-8: 32px;
        --radius: 12px;
      }
      * {
        box-sizing: border-box;
      }
      html {
        color-scheme: light;
      }
      body {
        margin: 0;
        background: var(--canvas);
        color: var(--ink);
        font-family:
          'Plus Jakarta Sans Variable',
          system-ui,
          -apple-system,
          sans-serif;
        font-size: 14px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button,
      a,
      input,
      select,
      textarea {
        -webkit-tap-highlight-color: transparent;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      button {
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      button,
      a {
        touch-action: manipulation;
      }
      :focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
      }
      h1,
      h2,
      h3,
      p {
        margin: 0;
      }
      h1 {
        font-size: 30px;
        letter-spacing: -1px;
        font-weight: 700;
        line-height: 1.2;
      }
      h2 {
        font-size: 18px;
        letter-spacing: -0.35px;
        line-height: 1.35;
        font-weight: 600;
      }
      h3 {
        font-size: 14px;
        font-weight: 600;
      }
      small {
        font-size: 12px;
      }
      svg {
        flex-shrink: 0;
      }
      .muted {
        color: var(--muted);
      }
      .micro {
        font-size: 12px;
        letter-spacing: 0.7px;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--muted);
      }
      .mono {
        font-family: SFMono-Regular, Consolas, monospace;
        font-size: 12px;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .between {
        justify-content: space-between;
      }
      .wrap {
        flex-wrap: wrap;
      }
      .spacer {
        flex: 1;
      }
      .grid-two {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-6);
        align-items: start;
      }
      .grid-main {
        display: grid;
        grid-template-columns: minmax(0, 1.65fr) minmax(320px, 1fr);
        gap: var(--space-6);
        align-items: start;
      }
      .spacer,
      .panel,
      .field,
      .stack > *,
      .row > div {
        min-width: 0;
      }
      h1,
      h2,
      h3,
      p,
      .list-title,
      .notice,
      .tag-list {
        overflow-wrap: anywhere;
      }
    `}</style>
  );
}
