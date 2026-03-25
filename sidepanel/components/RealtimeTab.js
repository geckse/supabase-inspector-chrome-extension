import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

export function RealtimeTab({ realtimeMonitor }) {
  const [channels, setChannels] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const unsub = realtimeMonitor.subscribe(() => {
      if (!paused) {
        setChannels(realtimeMonitor.getChannels());
      }
    });
    setChannels(realtimeMonitor.getChannels());
    return unsub;
  }, [paused]);

  const selectedChannel = channels.find(c => c.topic === selectedTopic);

  return html`
    <div class="realtime-tab">
      <div class="realtime-toolbar">
        <span class="toolbar-label">Active Channels: ${channels.length}</span>
        <button class="btn btn-sm" onClick=${() => setPaused(!paused)}>
          ${paused ? 'Resume' : 'Pause'}
        </button>
        <button class="btn btn-sm" onClick=${() => realtimeMonitor.clearEvents()}>
          Clear Events
        </button>
      </div>

      <div class="realtime-layout">
        <div class="channel-list">
          ${channels.length === 0 && html`
            <div class="empty-hint">No active subscriptions detected</div>
          `}
          ${channels.map(ch => html`
            <${ChannelItem}
              channel=${ch}
              selected=${ch.topic === selectedTopic}
              onClick=${() => setSelectedTopic(ch.topic)}
            />
          `)}
        </div>

        <div class="event-stream">
          ${!selectedChannel && html`
            <div class="empty-hint">Select a channel to view events</div>
          `}
          ${selectedChannel && html`
            <div class="event-stream-header">
              <span class="stream-topic">${formatTopic(selectedChannel.topic)}</span>
              <span class="event-counts">
                <span class="count-insert">+${selectedChannel.eventCounts.INSERT}</span>
                <span class="count-update">~${selectedChannel.eventCounts.UPDATE}</span>
                <span class="count-delete">-${selectedChannel.eventCounts.DELETE}</span>
              </span>
            </div>
            <div class="event-list">
              ${selectedChannel.events.map(evt => html`
                <${EventItem} key=${evt.id} event=${evt} />
              `)}
              ${selectedChannel.events.length === 0 && html`
                <div class="empty-hint">Waiting for events...</div>
              `}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function ChannelItem({ channel, selected, onClick }) {
  const statusColors = {
    joined: 'var(--safe)',
    joining: 'var(--warning)',
    errored: 'var(--danger)',
    closed: 'var(--text-muted)',
    unknown: 'var(--text-muted)'
  };

  const tableName = formatTopic(channel.topic);
  const totalEvents = channel.eventCounts.INSERT + channel.eventCounts.UPDATE + channel.eventCounts.DELETE;

  return html`
    <div class="channel-item ${selected ? 'selected' : ''}" onClick=${onClick}>
      <span class="channel-status-dot" style="background: ${statusColors[channel.status]}"></span>
      <span class="channel-name">${tableName}</span>
      <span class="channel-badge">${channel.status}</span>
      ${totalEvents > 0 && html`
        <span class="channel-event-count">${totalEvents}</span>
      `}
    </div>
  `;
}

function formatTopic(topic) {
  const parts = topic.replace('realtime:', '').split(':');
  if (parts[0] === 'public') parts.shift();
  return parts.join(' ');
}

function EventItem({ event }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false });

  const eventColors = {
    INSERT: 'var(--safe)',
    UPDATE: 'var(--warning)',
    DELETE: 'var(--danger)'
  };

  return html`
    <div class="event-item" onClick=${() => setExpanded(!expanded)}>
      <div class="event-summary">
        <span class="event-time">${time}</span>
        <span class="event-type" style="color: ${eventColors[event.event]}">${event.event}</span>
        <span class="event-preview">
          ${!expanded && JSON.stringify(event.payload).substring(0, 80)}
        </span>
      </div>
      ${expanded && html`
        <pre class="event-payload">${JSON.stringify(event.payload, null, 2)}</pre>
      `}
    </div>
  `;
}
