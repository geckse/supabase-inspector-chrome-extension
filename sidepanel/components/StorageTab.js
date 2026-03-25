import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { SupabaseStorage } from '../../lib/supabase-storage.js';

const html = htm.bind(h);

export function StorageTab({ credentials }) {
  const [buckets, setBuckets] = useState([]);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const storage = new SupabaseStorage(credentials);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await storage.listBuckets();
      if (result.error) {
        setError(result.error.message || 'Failed to load buckets');
      } else {
        setBuckets(result.data);
        if (result.data.length > 0) {
          setSelectedBucket(result.data[0]);
        }
      }
      setLoading(false);
    }
    load();
  }, [credentials]);

  useEffect(() => {
    if (!selectedBucket) return;
    async function loadObjects() {
      setLoading(true);
      const result = await storage.listObjects(selectedBucket.id, { prefix: currentPath });
      setObjects(result.data || []);
      setLoading(false);
    }
    loadObjects();
  }, [selectedBucket?.id, currentPath]);

  function navigateTo(folderName) {
    setCurrentPath(prev => prev ? `${prev}/${folderName}` : folderName);
  }

  function navigateUp() {
    setCurrentPath(prev => prev.split('/').slice(0, -1).join('/'));
  }

  const pathSegments = currentPath ? currentPath.split('/') : [];

  async function handleDownload(obj) {
    const fullPath = currentPath ? `${currentPath}/${obj.name}` : obj.name;
    const result = await storage.downloadFile(selectedBucket.id, fullPath);
    if (result.data) {
      const url = URL.createObjectURL(result.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = obj.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const path = currentPath ? `${currentPath}/${file.name}` : file.name;
    const result = await storage.uploadFile(selectedBucket.id, path, file);
    if (result.error) {
      setError(`Upload failed: ${result.error.message}`);
    } else {
      const refreshed = await storage.listObjects(selectedBucket.id, { prefix: currentPath });
      setObjects(refreshed.data || []);
    }
    e.target.value = '';
  }

  async function handleDelete(obj) {
    const fullPath = currentPath ? `${currentPath}/${obj.name}` : obj.name;
    const result = await storage.deleteFile(selectedBucket.id, [fullPath]);
    if (!result.error) {
      setObjects(prev => prev.filter(o => o.name !== obj.name));
    }
  }

  return html`
    <div class="storage-tab">
      <div class="storage-sidebar">
        <div class="sidebar-header">Buckets</div>
        ${buckets.map(b => html`
          <button
            class="sidebar-item ${b.id === selectedBucket?.id ? 'active' : ''}"
            onClick=${() => { setSelectedBucket(b); setCurrentPath(''); }}
          >
            ${b.name}
            <span class="bucket-badge ${b.public ? 'public' : 'private'}">
              ${b.public ? 'pub' : 'prv'}
            </span>
          </button>
        `)}
      </div>

      <div class="storage-main">
        ${selectedBucket && html`
          <div class="storage-toolbar">
            <${Breadcrumbs}
              bucket=${selectedBucket.name}
              segments=${pathSegments}
              onNavigate=${(idx) => setCurrentPath(pathSegments.slice(0, idx + 1).join('/'))}
              onRoot=${() => setCurrentPath('')}
            />
            <label class="btn btn-sm btn-primary upload-btn">
              Upload
              <input type="file" hidden onChange=${handleUpload} />
            </label>
          </div>

          <div class="file-list">
            ${currentPath && html`
              <div class="file-item folder" onClick=${navigateUp}>
                <span class="file-icon">\u{1F4C1}</span>
                <span class="file-name">..</span>
              </div>
            `}
            ${objects.map(obj => html`
              <${FileItem}
                object=${obj}
                isPublic=${selectedBucket.public}
                onNavigate=${() => navigateTo(obj.name)}
                onDownload=${() => handleDownload(obj)}
                onDelete=${() => handleDelete(obj)}
                downloadUrl=${obj.metadata ? storage.getDownloadUrl(selectedBucket.id,
                  currentPath ? `${currentPath}/${obj.name}` : obj.name, selectedBucket.public) : null}
              />
            `)}
            ${!loading && objects.length === 0 && html`
              <div class="empty-hint">Empty${currentPath ? ' folder' : ' bucket'}</div>
            `}
          </div>
        `}
        ${error && html`<div class="error-msg">${error}</div>`}
      </div>
    </div>
  `;
}

function FileItem({ object, isPublic, onNavigate, onDownload, onDelete, downloadUrl }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isFolder = object.id === null;
  const isImage = object.metadata?.mimetype?.startsWith('image/');
  const size = object.metadata?.size ? formatFileSize(object.metadata.size) : null;

  return html`
    <div class="file-item ${isFolder ? 'folder' : ''}">
      <span class="file-icon" onClick=${isFolder ? onNavigate : undefined}>
        ${isFolder ? '\u{1F4C1}' : isImage ? '\u{1F5BC}' : '\u{1F4C4}'}
      </span>
      <span class="file-name" onClick=${isFolder ? onNavigate : undefined}>
        ${object.name}
      </span>
      ${size && html`<span class="file-size">${size}</span>`}
      ${object.metadata?.mimetype && html`
        <span class="file-type">${object.metadata.mimetype}</span>
      `}
      ${!isFolder && html`
        <div class="file-actions">
          <button class="btn btn-sm btn-ghost" onClick=${onDownload} title="Download">\u2193</button>
          ${!confirmDelete && html`
            <button class="btn btn-sm btn-ghost" onClick=${() => setConfirmDelete(true)} title="Delete">\u2715</button>
          `}
          ${confirmDelete && html`
            <button class="btn btn-sm btn-danger" onClick=${() => { onDelete(); setConfirmDelete(false); }}>
              Delete
            </button>
            <button class="btn btn-sm" onClick=${() => setConfirmDelete(false)}>Cancel</button>
          `}
        </div>
      `}
    </div>
  `;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function Breadcrumbs({ bucket, segments, onNavigate, onRoot }) {
  return html`
    <div class="breadcrumbs">
      <span class="breadcrumb-item" onClick=${onRoot}>${bucket}</span>
      ${segments.map((seg, i) => html`
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-item" onClick=${() => onNavigate(i)}>${seg}</span>
      `)}
    </div>
  `;
}
