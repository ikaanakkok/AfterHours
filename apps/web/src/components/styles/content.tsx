'use client';

export function ContentStyles() {
  return (
    <style jsx global>{`
      .inbox-layout {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        min-height: 560px;
      }
      .conversation-list {
        border-right: 1px solid var(--line);
        max-height: 650px;
        overflow-y: auto;
      }
      .conversation-button {
        display: block;
        text-align: left;
        border: 0;
        border-bottom: 1px solid var(--line);
        width: 100%;
        background: white;
        padding: 20px;
      }
      .conversation-button:hover,
      .conversation-button[aria-pressed='true'] {
        background: #f0ecff;
      }
      .conversation-button p {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
        margin-top: 7px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .conversation-button time {
        color: #646464;
        font-size: 12px;
      }
      .chat {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .chat-heading {
        padding: 18px 22px;
        border-bottom: 1px solid var(--line);
      }
      .messages {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 310px;
        max-height: 510px;
        overflow: auto;
      }
      .message {
        max-width: 83%;
        background: #f8f9fa;
        border: 1px solid #e8e8e8;
        border-radius: 10px 10px 10px 2px;
        padding: 12px 14px;
        align-self: flex-start;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 14px;
      }
      .message.outbound {
        align-self: flex-end;
        background: #f0ecff;
        border-color: #e4dcff;
        border-radius: 10px 10px 2px 10px;
      }
      .message-meta {
        margin-top: 7px;
        font-size: 12px;
        color: var(--muted);
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 7px;
      }
      .composer {
        border-top: 1px solid var(--line);
        padding: 16px 22px;
      }
      .split-editor {
        display: grid;
        grid-template-columns: 250px minmax(0, 1fr);
      }
      .workflow-choice {
        padding: 15px 20px;
        border: 0;
        border-bottom: 1px solid var(--line);
        text-align: left;
        background: white;
        width: 100%;
      }
      .workflow-choice[aria-pressed='true'] {
        background: #f0ecff;
      }
      .workflow-choice p {
        font-size: 12px;
        color: var(--muted);
        margin: 5px 0;
      }
      .editor {
        padding: 22px;
        min-width: 0;
      }
      .trial-dots {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .trial-dot {
        width: 21px;
        height: 21px;
        border-radius: 50%;
        background: #f8f9fa;
        border: 1px solid #e8e8e8;
        color: #646464;
        display: grid;
        place-items: center;
        font-size: 12px;
      }
      .trial-dot.success {
        background: #e9f6ef;
        border-color: #c4e2d2;
        color: #176344;
      }
      .integration-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }
      .integration {
        padding: 20px;
      }
      .integration-logo {
        background: #f8f9fa;
        width: 41px;
        height: 41px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        color: #6647f0;
      }
      .integration-detail {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin: 17px 0;
        padding: 13px 0;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        color: var(--muted);
      }
      .integration-detail strong {
        display: block;
        color: var(--ink);
        font-size: 12px;
        margin-top: 3px;
        font-weight: 500;
      }
      .login-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        min-height: 100vh;
      }
      .login-story {
        background: var(--accent-light);
        color: var(--ink);
        padding: 65px max(45px, 8vw);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .login-story .brand {
        padding: 0;
      }
      .login-story h1 {
        font-size: 44px;
        font-weight: 800;
        line-height: 1.15;
        max-width: 450px;
        letter-spacing: -2px;
        margin-bottom: 23px;
      }
      .login-story p {
        font-size: 14px;
        color: #646464;
        max-width: 420px;
        line-height: 1.8;
      }
      .login-story small {
        font-size: 12px;
        color: #646464;
      }
      .login-form-side {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
      }
      .login-form {
        width: 100%;
        max-width: 420px;
      }
      .login-form h2 {
        font-size: 25px;
        margin-bottom: 10px;
      }
      .login-form > p {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 28px;
      }
      .active-hours {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .hours-row {
        display: grid;
        grid-template-columns: 115px 1fr 20px 1fr;
        gap: 10px;
        align-items: center;
        font-size: 12px;
      }
      .hours-row input[type='time'] {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: white;
        width: 100%;
        padding: 7px;
        font-size: 12px;
      }
      .hours-row label {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .search {
        width: 240px;
        border: 1px solid var(--line);
        background: white;
        border-radius: 7px;
        padding: 8px 11px;
        font-size: 12px;
      }
      .disabled-panel {
        padding: 30px;
        border: 1px dashed #d4d4d4;
        background: #f8f9fa;
        border-radius: 10px;
      }
      .timeline {
        padding: 5px 22px;
      }
      .timeline-item {
        padding: 14px 0 14px 20px;
        position: relative;
        border-left: 1px solid var(--line);
        margin-left: 5px;
      }
      .timeline-item:before {
        content: '';
        height: 7px;
        width: 7px;
        border-radius: 50%;
        background: #6647f0;
        position: absolute;
        left: -4px;
        top: 20px;
        border: 1px solid white;
      }
      .timeline-item p {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
      }
      .timeline-item time {
        font-size: 12px;
        color: #646464;
      }
      .qr-image {
        display: block;
        width: 220px;
        height: 220px;
        max-width: 100%;
        margin: 15px auto;
      }
      .admin-chat {
        background: #f8f9fa;
        border-radius: 8px;
        padding: 15px;
        max-height: 480px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }
      .admin-chat .message {
        margin-bottom: 14px;
      }
      .admin-chat .message.outbound {
        margin-left: auto;
      }
      .skip-link {
        position: fixed;
        top: 8px;
        left: 8px;
        background: white;
        color: var(--ink);
        padding: 12px;
        z-index: 100;
        transform: translateY(-200%);
      }
      .skip-link:focus {
        transform: translateY(0);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .conversation-back {
        display: none;
      }
      .conversation-button {
        transition: background 150ms;
      }
      .conversation-button[aria-pressed='true'] {
        box-shadow: inset 3px 0 var(--accent);
      }
      .conversation-button strong {
        font-size: 14px;
      }
      .chat-heading h3 {
        font-size: 16px;
      }
      .chat-heading .row {
        flex-wrap: wrap;
      }
      .composer {
        margin-top: auto;
        background: var(--surface);
      }
      .composer .row {
        flex-wrap: wrap;
      }
      .workflow-text {
        padding: 20px;
        background: var(--canvas);
        border: 1px solid var(--line);
        border-radius: var(--radius);
      }
      .integration > .row {
        flex-wrap: wrap;
      }
      .integration-detail strong {
        font-weight: 600;
      }
      .login-form h2 {
        font-weight: 700;
      }
      .login-form .button.primary {
        width: 100%;
      }
      .admin-chat .message {
        margin-bottom: 0;
      }
      .search {
        min-height: 44px;
        border-radius: var(--radius-pill);
      }
      .tag-list .status {
        white-space: normal;
      }
    `}</style>
  );
}
