import { h } from '../../vendor/preact.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

export function TabBar({ tabs, activeTab, onTabChange }) {
  return html`
    <nav class="tab-bar">
      ${tabs.map(tab => html`
        <button
          class="tab-item ${activeTab === tab.id ? 'active' : ''}"
          onClick=${() => onTabChange(tab.id)}
          title=${tab.label}
        >
          <span class="tab-icon">${tab.icon}</span>
          <span class="tab-label">${tab.label}</span>
        </button>
      `)}
    </nav>
  `;
}
