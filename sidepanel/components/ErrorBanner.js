import { h } from '../../vendor/preact.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

export function ErrorBanner({ message, onRetry, onDismiss }) {
  return html`
    <div class="error-banner">
      <span class="error-banner-msg">${message}</span>
      <div class="error-banner-actions">
        ${onRetry && html`<button class="btn btn-sm" onClick=${onRetry}>Retry</button>`}
        ${onDismiss && html`<button class="btn btn-sm btn-ghost" onClick=${onDismiss}>\u2715</button>`}
      </div>
    </div>
  `;
}
