'use client';

export function ShellStyles() {
  return (
    <style jsx global>{`
      .workspace {
        display: flex;
        min-height: 100vh;
      }
      .sidebar {
        width: 260px;
        position: fixed;
        inset: 0 auto 0 0;
        background: var(--nav);
        color: #202020;
        padding: 28px 16px 20px;
        border-right: 1px solid var(--line);
        overflow-y: auto;
        z-index: 30;
        display: flex;
        flex-direction: column;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 11px;
        color: var(--ink);
        font-size: 22px;
        letter-spacing: -0.7px;
        font-weight: 600;
        padding: 0 12px 24px;
      }
      .brand-mark {
        width: 29px;
        height: 29px;
        border: 7px solid #6647f0;
        border-top-color: #9781f5;
        border-radius: 50%;
        transform: rotate(-25deg);
      }
      .sidebar-caption {
        font-size: 12px;
        letter-spacing: 1.5px;
        font-weight: 600;
        color: #646464;
        padding: 20px 12px 8px;
      }
      .nav-link {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 10px 12px;
        margin: 2px 0;
        border-radius: 10px;
        font-size: 14px;
        color: #646464;
        transition:
          background 0.15s,
          color 0.15s;
      }
      .nav-link:hover {
        color: var(--ink);
        background: #f8f9fa;
      }
      .nav-link[aria-current='page'] {
        background: #f0ecff;
        color: #5233c9;
        font-weight: 700;
      }
      .nav-link .count {
        margin-left: auto;
        background: #6647f0;
        color: #ffffff;
        border-radius: var(--radius-pill);
        font-size: 12px;
        padding: 1px 6px;
      }
      .sidebar-footer {
        margin-top: auto;
        padding: 25px 12px 0;
      }
      .sidebar-runtime {
        padding: 13px;
        border: 1px solid #e8e8e8;
        border-radius: 9px;
        background: #f8f9fa;
        font-size: 12px;
      }
      .sidebar-runtime p {
        color: #646464;
        font-size: 12px;
        margin-top: 5px;
      }
      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #176344;
        display: inline-block;
      }
      .dot.offline {
        background: #8a4b0f;
      }
      .sidebar-bottom {
        margin: 17px 0 0;
        color: #646464;
        font-size: 12px;
        letter-spacing: 0.6px;
      }
      .main {
        margin-left: 260px;
        flex: 1;
        min-width: 0;
      }
      .topbar {
        min-height: 72px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 32px;
        border-bottom: 1px solid var(--line);
        background: #ffffff;
        gap: 20px;
      }
      .breadcrumb {
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--muted);
      }
      .breadcrumb strong {
        font-weight: 500;
        color: var(--ink);
      }
      .tenant-selector {
        background: transparent;
        border: 0;
        max-width: 240px;
        color: var(--ink);
        font-weight: 600;
        font-size: 12px;
        padding: 8px 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius-pill);
      }
      .avatar {
        width: 31px;
        height: 31px;
        display: grid;
        place-items: center;
        background: #f0ecff;
        border-radius: 50%;
        font-size: 12px;
        font-weight: 700;
        color: #5233c9;
      }
      .user-name {
        font-size: 12px;
        font-weight: 600;
      }
      .user-role {
        color: var(--muted);
        font-size: 12px;
      }
      .icon-button {
        border: 1px solid var(--line);
        border-radius: 10px;
        height: 40px;
        width: 40px;
        background: var(--surface);
        display: grid;
        place-items: center;
        color: var(--muted);
      }
      .mobile-menu {
        display: none;
      }
      .content {
        max-width: 1480px;
        margin: auto;
        padding: 32px 32px 48px;
      }
      .page-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 32px;
      }
      .page-heading p {
        color: var(--muted);
        margin-top: 9px;
        font-size: 14px;
      }
      .eyebrow {
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 9px;
        font-weight: 500;
        letter-spacing: 0.35px;
      }
      .page-actions {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid var(--line);
        background: white;
        color: var(--ink);
        border-radius: var(--radius-pill);
        padding: 10px 20px;
        min-height: 44px;
        font-size: 14px;
        font-weight: 600;
        transition:
          background 0.15s,
          border-color 0.15s,
          transform 0.15s;
      }
      .button:hover:not(:disabled) {
        background: #f5f5f5;
        border-color: #cccccc;
      }
      .button:active:not(:disabled) {
        transform: translateY(1px);
      }
      .button.primary {
        background: var(--ink);
        border-color: var(--ink);
        color: white;
      }
      .button.primary:hover:not(:disabled) {
        background: #383838;
        border-color: #383838;
      }
      .button.danger {
        color: var(--red);
      }
      .button.small {
        min-height: 36px;
        padding: 6px 12px;
        font-size: 12px;
      }
      .button.ghost {
        background: transparent;
        border-color: transparent;
        color: var(--muted);
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .panel-heading {
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        border-bottom: 1px solid var(--line);
      }
      .panel-heading p {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
      }
      .panel-body {
        padding: 24px;
      }
      .panel-footer {
        padding: 14px 22px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 7px;
        background: #fafafa;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: var(--radius-pill);
        font-size: 12px;
        font-weight: 600;
        line-height: 1.35;
        color: #555555;
        background: #f2f2f2;
        white-space: nowrap;
      }
      .status.green {
        background: var(--green-light);
        color: var(--green);
      }
      .status.orange {
        background: var(--amber-light);
        color: var(--amber);
      }
      .status.red {
        background: #fff0f2;
        color: var(--red);
      }
      .status.blue {
        background: #edf5ff;
        color: #245b91;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin-bottom: 24px;
      }
      .stat {
        background: white;
        border: 1px solid var(--line);
        border-radius: 11px;
        padding: 20px;
        min-height: 148px;
      }
      .stat-title {
        font-size: 12px;
        color: var(--muted);
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
      .stat-number {
        font-size: 36px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -1px;
        margin: 14px 0 7px;
      }
      .stat-detail {
        font-size: 12px;
        color: var(--muted);
      }
      .briefing {
        background: #f0ecff;
        padding: 24px;
        border: 1px solid #e4dcff;
        border-radius: var(--radius);
        margin-bottom: 22px;
        position: relative;
        overflow: hidden;
      }
      .briefing h2 {
        font-weight: 700;
        font-size: 24px;
        line-height: 1.3;
        max-width: 540px;
        letter-spacing: -0.6px;
        margin: 9px 0;
      }
      .briefing p {
        color: #584e75;
        max-width: 530px;
        font-size: 12px;
        line-height: 1.65;
      }
      .briefing .row {
        margin-top: 18px;
      }
      .briefing-stamp {
        position: absolute;
        right: 26px;
        top: 26px;
        width: 48px;
        height: 48px;
        color: #6647f0;
        border: 1px solid #d4c9ff;
        border-radius: 50%;
        display: grid;
        place-items: center;
      }
      .list-row {
        padding: 16px 24px;
        border-bottom: 1px solid var(--line);
        display: flex;
        align-items: center;
        gap: 13px;
      }
      .list-row:last-child {
        border-bottom: 0;
      }
      .list-row p {
        font-size: 12px;
        color: var(--muted);
        margin-top: 3px;
      }
      .list-icon {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        background: #f4f2fc;
        border-radius: 8px;
        color: #6647f0;
        flex-shrink: 0;
      }
      .list-title {
        font-size: 14px;
        font-weight: 600;
      }
      .empty {
        padding: 35px 24px;
        text-align: center;
        max-width: 520px;
        margin: auto;
      }
      .empty-icon {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        background: #f0ecff;
        border-radius: 10px;
        color: #6647f0;
        margin: 0 auto 13px;
      }
      .empty h3 {
        margin-bottom: 6px;
      }
      .empty p {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .empty .button {
        margin-top: 17px;
      }
      .stat.attention {
        border-color: #d4c9ff;
        background: #f5f2ff;
      }
      .overview-attention {
        margin-bottom: 24px;
      }
      .overview-attention .panel-heading {
        border-bottom: 0;
      }
      .sidebar-dismiss {
        display: none;
      }
      .screen-state {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .screen-state-card {
        width: 100%;
        max-width: 480px;
        padding: 32px;
      }
      [role='tablist'] {
        padding: 4px;
        border: 1px solid var(--line);
        border-radius: var(--radius-pill);
        background: var(--surface);
        gap: 4px;
        width: fit-content;
        max-width: 100%;
      }
      .button[role='tab'] {
        border-color: transparent;
        min-height: 40px;
        color: var(--muted);
      }
      .button[role='tab'][aria-selected='true'] {
        background: var(--accent-light);
        color: #5233c9;
      }
    `}</style>
  );
}
