'use client';

export function FormStyles() {
  return (
    <style jsx global>{`
      .field {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .field label {
        font-weight: 600;
        font-size: 14px;
      }
      .field input,
      .field select,
      .field textarea {
        width: 100%;
        border: 1px solid #d4d4d4;
        border-radius: var(--radius-input);
        padding: 10px 11px;
        color: var(--ink);
        background: #fff;
        min-height: 44px;
      }
      .field textarea {
        min-height: 90px;
        resize: vertical;
        line-height: 1.6;
      }
      .field .hint {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      .fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .form-stack {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .checkbox {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        font-size: 12px;
        line-height: 1.6;
      }
      .checkbox input {
        width: 16px;
        height: 16px;
        accent-color: var(--accent);
        margin: 2px 0 0;
        flex-shrink: 0;
      }
      .check-group {
        display: flex;
        gap: 10px 18px;
        flex-wrap: wrap;
        margin-top: 7px;
      }
      fieldset {
        border: 1px solid var(--line);
        border-radius: 8px;
        margin: 0;
        padding: 14px;
        min-width: 0;
      }
      legend {
        font-size: 12px;
        font-weight: 600;
        padding: 0 5px;
      }
      .notice {
        border: 1px solid #e4dcff;
        background: #f5f2ff;
        padding: 13px 15px;
        border-radius: 8px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        color: #584e75;
        font-size: 12px;
        line-height: 1.65;
      }
      .notice.orange {
        background: #fff4e5;
        border-color: #ead3b7;
        color: #8a4b0f;
      }
      .notice.error {
        background: #fff0f2;
        border-color: #edc4cd;
        color: #a52b37;
      }
      .toast {
        position: fixed;
        bottom: 22px;
        right: 28px;
        max-width: 430px;
        z-index: 60;
        box-shadow: 0 10px 40px #20202018;
        background: #fff;
        border: 1px solid #e8e8e8;
        border-radius: 9px;
        padding: 14px 17px;
        display: flex;
        gap: 12px;
        align-items: center;
        font-size: 12px;
      }
      .toast.error {
        border-color: #edc4cd;
        color: var(--red);
      }
      .loading {
        padding: 60px 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        color: var(--muted);
      }
      .spin {
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes enter {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .content {
        animation: enter 0.2s ease-out;
      }
      .progress-steps {
        display: flex;
        gap: 0;
        align-items: center;
        margin: 21px 0;
      }
      .progress-step {
        flex: 1;
        font-size: 12px;
        color: var(--muted);
        text-align: center;
        position: relative;
      }
      .progress-step:before {
        content: '';
        height: 1px;
        background: var(--line);
        width: 100%;
        position: absolute;
        top: 14px;
        left: 50%;
      }
      .progress-step:last-child:before {
        display: none;
      }
      .step-dot {
        height: 28px;
        width: 28px;
        border: 1px solid #e8e8e8;
        background: #f8f9fa;
        border-radius: 50%;
        display: grid;
        place-items: center;
        margin: 0 auto 9px;
        position: relative;
        z-index: 1;
        color: #646464;
      }
      .step-dot.done {
        background: #e9f6ef;
        border-color: #c4e2d2;
        color: #176344;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
      }
      th {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        background: #f8f9fa;
        padding: 12px 18px;
        white-space: nowrap;
        border-bottom: 1px solid var(--line);
      }
      td {
        padding: 15px 18px;
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        vertical-align: top;
      }
      tr:last-child td {
        border-bottom: 0;
      }
      td .muted {
        font-size: 12px;
        margin-top: 4px;
      }
      details summary {
        cursor: pointer;
        font-size: 12px;
        color: #5233c9;
        padding: 8px 0;
      }
      pre {
        margin: 6px 0 0;
        background: #f8f9fa;
        padding: 14px;
        border-radius: var(--radius-input);
        font-size: 12px;
        line-height: 1.6;
        overflow: auto;
        max-height: 280px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .field input:hover,
      .field select:hover,
      .field textarea:hover {
        border-color: #aaa;
      }
      .field [aria-invalid='true'] {
        border-color: var(--red);
      }
      .field-error {
        color: var(--red);
        font-size: 12px;
      }
      .command-error {
        margin-bottom: 24px;
      }
      .table-wrap {
        max-width: 100%;
      }
      td {
        overflow-wrap: anywhere;
      }
      details {
        min-width: 0;
      }
      details summary {
        color: #5233c9;
        font-weight: 600;
      }
    `}</style>
  );
}
