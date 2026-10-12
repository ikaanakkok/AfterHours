'use client';

export function ResponsiveStyles() {
  return (
    <style jsx global>{`
      @media (min-width: 1600px) {
        .content {
          padding-top: 40px;
        }
      }
      @media (max-width: 1190px) {
        .sidebar {
          width: 232px;
          padding-left: 12px;
          padding-right: 12px;
        }
        .main {
          margin-left: 232px;
        }
        .topbar,
        .content {
          padding-left: 24px;
          padding-right: 24px;
        }
        .grid-main {
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 20px;
        }
        .stats {
          gap: 12px;
        }
        .inbox-layout {
          grid-template-columns: 240px minmax(0, 1fr);
        }
        .user-name,
        .user-role {
          display: none;
        }
      }
      @media (max-width: 1020px) {
        .grid-main,
        .grid-two {
          grid-template-columns: 1fr;
        }
        .stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .split-editor {
          grid-template-columns: 210px minmax(0, 1fr);
        }
        .integration-grid {
          grid-template-columns: 1fr;
        }
        .breadcrumb .muted {
          display: none;
        }
        .briefing-stamp {
          display: none;
        }
        .chat-heading .row {
          gap: 8px;
        }
      }
      @media (max-width: 760px) {
        .sidebar {
          transform: translateX(-100%);
          visibility: hidden;
          transition: transform 200ms;
          width: min(300px, 85vw);
        }
        .sidebar.open {
          transform: translateX(0);
          visibility: visible;
          box-shadow: 8px 0 32px #20202018;
        }
        .sidebar-dismiss {
          display: block;
          position: fixed;
          inset: 0;
          border: 0;
          background: #20202055;
          z-index: 25;
        }
        .sidebar-close {
          margin-left: auto;
          margin-bottom: 12px;
        }
        .main {
          margin-left: 0;
        }
        .mobile-menu {
          display: grid;
        }
        .topbar {
          min-height: 64px;
          padding: 12px 16px;
          gap: 8px;
        }
        .topbar .breadcrumb {
          display: none;
        }
        .topbar .row {
          gap: 8px;
        }
        .tenant-selector {
          max-width: 170px;
          padding: 8px;
        }
        .avatar {
          display: none;
        }
        .content {
          padding: 24px 16px 32px;
        }
        h1 {
          font-size: 28px;
        }
        .page-heading {
          flex-direction: column;
          gap: 16px;
          margin-bottom: 24px;
        }
        .page-actions {
          align-items: center;
          flex-wrap: wrap;
        }
        .panel-heading {
          flex-wrap: wrap;
        }
        .panel-heading,
        .panel-body {
          padding: 20px;
        }
        .panel-heading > div {
          flex: 1 1 180px;
        }
        .panel-footer {
          padding: 16px 20px;
        }
        .briefing {
          padding: 20px;
        }
        .briefing h2 {
          font-size: 22px;
        }
        .stats {
          gap: 12px;
        }
        .stat {
          padding: 16px;
          min-height: 144px;
        }
        .stat-number {
          font-size: 32px;
        }
        .stat-title {
          align-items: flex-start;
        }
        .inbox-layout,
        .split-editor {
          grid-template-columns: minmax(0, 1fr);
        }
        .inbox-layout {
          min-height: 360px;
        }
        .conversation-list {
          border-right: 0;
          max-height: 65vh;
        }
        .inbox-layout .chat {
          display: none;
        }
        .inbox-layout.conversation-open .conversation-list {
          display: none;
        }
        .inbox-layout.conversation-open .chat {
          display: flex;
        }
        .conversation-back {
          display: inline-flex;
          margin-bottom: 16px;
        }
        .conversation-button {
          padding: 20px;
        }
        .chat-heading,
        .messages,
        .composer {
          padding: 20px;
        }
        .messages {
          min-height: 280px;
          max-height: 55vh;
        }
        .message {
          max-width: 95%;
        }
        .fields {
          grid-template-columns: minmax(0, 1fr);
        }
        .toast {
          bottom: 16px;
          right: 16px;
          left: 16px;
          max-width: none;
        }
        .search {
          width: 100%;
        }
        .login-layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .login-story {
          padding: 32px 24px;
          gap: 24px;
        }
        .login-story h1 {
          font-size: 32px;
          margin-bottom: 16px;
          letter-spacing: -1px;
        }
        .login-story > small {
          display: none;
        }
        .login-form-side {
          padding: 32px 24px;
        }
        .hours-row {
          grid-template-columns: 1fr 16px 1fr;
          gap: 8px;
        }
        .hours-row label {
          grid-column: 1 / -1;
        }
        [role='tablist'] {
          border-radius: 12px;
          flex-wrap: wrap;
        }
        .button {
          min-height: 44px;
        }
        .icon-button {
          min-width: 44px;
          min-height: 44px;
        }
        .button.small {
          min-height: 44px;
        }
        .list-row {
          flex-wrap: wrap;
          padding: 16px 20px;
        }
        .progress-steps {
          flex-wrap: wrap;
          gap: 16px 0;
        }
        .progress-step {
          flex: 1 1 50%;
        }
        .progress-step:before {
          display: none;
        }
        .screen-state-card {
          padding: 24px;
        }
      }
      @media (max-width: 760px) {
        .table-wrap table {
          min-width: 640px;
        }
        fieldset input:not([type='checkbox']),
        fieldset select {
          min-height: 44px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
      }
    `}</style>
  );
}
