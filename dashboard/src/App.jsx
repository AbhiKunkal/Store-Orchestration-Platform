import { useState, useEffect, useCallback } from 'react';
import { storesApi } from './api/stores';

/* ─────────────────────────────────────────────────────────────────
 * App — Main Application Component
 * 
 * Responsibilities:
 * - Polls API every 5 seconds for store status updates
 * - Manages global store list state
 * - Renders Header, Stats, StoreGrid, and CreateModal
 * ───────────────────────────────────────────────────────────────── */

const POLL_INTERVAL = 5000; // 5 seconds

// ─── STATUS CONFIG ─────────────────────────────────────────────
const STATUS_CONFIG = {
    ready: { label: 'Ready', icon: '✓' },
    provisioning: { label: 'Provisioning', icon: '⟳' },
    queued: { label: 'Queued', icon: '◦' },
    failed: { label: 'Failed', icon: '✕' },
    deleting: { label: 'Deleting', icon: '⟳' },
    deleted: { label: 'Deleted', icon: '—' },
};

export default function App() {
    const [stores, setStores] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [error, setError] = useState(null);
    const [apiConnected, setApiConnected] = useState(false);
    const [activeTab, setActiveTab] = useState('stores');
    const [auditLog, setAuditLog] = useState([]);
    const [metrics, setMetrics] = useState(null);

    // ── Fetch stores ──
    const fetchStores = useCallback(async () => {
        try {
            const data = await storesApi.getAll();
            // Filter out deleted stores from display
            setStores(data.stores.filter(s => s.status !== 'deleted'));
            setApiConnected(true);
            setError(null);
        } catch (err) {
            setApiConnected(false);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ── Poll every 5 seconds ──
    useEffect(() => {
        fetchStores();
        const interval = setInterval(fetchStores, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchStores]);

    // ── Create store ──
    const handleCreate = async (name, engine) => {
        try {
            await storesApi.create(name, engine);
            setShowCreate(false);
            // Immediately fetch to show the new store
            await fetchStores();
        } catch (err) {
            throw err; // Let the modal handle the error
        }
    };

    // ── Delete store ──
    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this store? This will remove ALL resources.')) {
            return;
        }
        try {
            await storesApi.delete(id);
            await fetchStores();
        } catch (err) {
            alert(`Failed to delete store: ${err.message}`);
        }
    };

    // ── Retry store ──
    const handleRetry = async (id) => {
        try {
            await storesApi.retry(id);
            await fetchStores();
        } catch (err) {
            alert(`Failed to retry: ${err.message}`);
        }
    };

    // ── Fetch audit log ──
    useEffect(() => {
        if (activeTab !== 'activity') return;
        storesApi.getAudit(50)
            .then(data => setAuditLog(data.audit || []))
            .catch(() => { });
    }, [activeTab, stores]); // re-fetch when stores change

    // ── Fetch metrics ──
    useEffect(() => {
        if (activeTab !== 'metrics') return;
        storesApi.getMetrics()
            .then(data => setMetrics(data))
            .catch(() => { });
    }, [activeTab, stores]);

    // ── Stats ──
    const stats = {
        total: stores.length,
        ready: stores.filter(s => s.status === 'ready').length,
        provisioning: stores.filter(s => ['provisioning', 'queued'].includes(s.status)).length,
        failed: stores.filter(s => s.status === 'failed').length,
    };

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header__brand">
                    <div className="header__icon">⚡</div>
                    <div>
                        <h1 className="header__title">Store Platform</h1>
                        <p className="header__subtitle">Kubernetes Store Orchestration</p>
                    </div>
                </div>
                <div className="header__actions">
                    <div className="connection-status">
                        <span className={`connection-dot ${apiConnected ? 'connection-dot--connected' : 'connection-dot--error'}`} />
                        {apiConnected ? 'Connected' : 'Disconnected'}
                    </div>
                    <button
                        className="btn btn--primary"
                        onClick={() => setShowCreate(true)}
                        disabled={!apiConnected}
                    >
                        + Create Store
                    </button>
                </div>
            </header>

            {/* Stats */}
            <div className="stats">
                <div className="stat">
                    Total <span className="stat__value">{stats.total}</span>
                </div>
                <div className="stat stat--ready">
                    Ready <span className="stat__value">{stats.ready}</span>
                </div>
                <div className="stat stat--provisioning">
                    In Progress <span className="stat__value">{stats.provisioning}</span>
                </div>
                <div className="stat stat--failed">
                    Failed <span className="stat__value">{stats.failed}</span>
                </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'stores' ? 'tab--active' : ''}`}
                    onClick={() => setActiveTab('stores')}
                >
                    🏪 Stores
                </button>
                <button
                    className={`tab ${activeTab === 'activity' ? 'tab--active' : ''}`}
                    onClick={() => setActiveTab('activity')}
                >
                    📋 Activity Log
                </button>
                <button
                    className={`tab ${activeTab === 'metrics' ? 'tab--active' : ''}`}
                    onClick={() => setActiveTab('metrics')}
                >
                    📊 Metrics
                </button>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="store-card__error" style={{ marginBottom: 20 }}>
                    {error}
                </div>
            )}

            {/* Tab Content */}
            {activeTab === 'stores' && (
                <>
                    {isLoading ? (
                        <div className="empty-state">
                            <div className="spinner" style={{ width: 32, height: 32 }} />
                            <p style={{ marginTop: 16 }}>Loading stores...</p>
                        </div>
                    ) : stores.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state__icon">🏪</div>
                            <h2 className="empty-state__title">No stores yet</h2>
                            <p className="empty-state__text">
                                Create your first WooCommerce store. It will be provisioned
                                automatically on Kubernetes with its own isolated namespace.
                            </p>
                            <button
                                className="btn btn--primary"
                                onClick={() => setShowCreate(true)}
                                disabled={!apiConnected}
                            >
                                + Create Your First Store
                            </button>
                        </div>
                    ) : (
                        <div className="store-grid">
                            {stores.map(store => (
                                <StoreCard
                                    key={store.id}
                                    store={store}
                                    onDelete={handleDelete}
                                    onRetry={handleRetry}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {activeTab === 'activity' && (
                <ActivityLog entries={auditLog} />
            )}

            {activeTab === 'metrics' && (
                <MetricsPanel data={metrics} />
            )}

            {/* Create Modal */}
            {showCreate && (
                <CreateModal
                    onClose={() => setShowCreate(false)}
                    onCreate={handleCreate}
                />
            )}
        </div>
    );
}

/* ─── Store Card Component ──────────────────────────────────────── */
function StoreCard({ store, onDelete, onRetry }) {
    const statusCfg = STATUS_CONFIG[store.status] || STATUS_CONFIG.queued;
    const isActive = ['provisioning', 'queued', 'deleting'].includes(store.status);

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    return (
        <div className={`store-card store-card--${store.status}`}>
            <div className="store-card__header">
                <div>
                    <div className="store-card__name">{store.name}</div>
                    <div className="store-card__engine">{store.engine}</div>
                </div>
                <span className={`status-badge status-badge--${store.status}`}>
                    <span className="status-badge__dot" />
                    {statusCfg.label}
                </span>
            </div>

            <div className="store-card__details">
                {store.store_url && (
                    <div className="store-card__detail">
                        <span className="store-card__detail-label">Store</span>
                        <span className="store-card__detail-value">
                            <a href={store.store_url} target="_blank" rel="noopener noreferrer">
                                {store.store_url}
                            </a>
                        </span>
                    </div>
                )}
                {store.admin_url && (
                    <div className="store-card__detail">
                        <span className="store-card__detail-label">Admin</span>
                        <span className="store-card__detail-value">
                            <a href={store.admin_url} target="_blank" rel="noopener noreferrer">
                                {store.admin_url}
                            </a>
                        </span>
                    </div>
                )}
                <div className="store-card__detail">
                    <span className="store-card__detail-label">Namespace</span>
                    <span className="store-card__detail-value">{store.namespace}</span>
                </div>
                <div className="store-card__detail">
                    <span className="store-card__detail-label">Created</span>
                    <span className="store-card__detail-value">{formatDate(store.created_at)}</span>
                </div>
            </div>

            {store.error_message && (
                <div className="store-card__error">
                    <strong>Error:</strong> {store.error_message}
                </div>
            )}

            <div className="store-card__actions">
                {store.status === 'failed' && (
                    <button className="btn btn--ghost" onClick={() => onRetry(store.id)}>
                        ↻ Retry
                    </button>
                )}
                {!['deleting', 'deleted'].includes(store.status) && (
                    <button className="btn btn--danger" onClick={() => onDelete(store.id)}>
                        Delete
                    </button>
                )}
                {isActive && (
                    <span className="spinner" style={{ marginLeft: 'auto' }} />
                )}
            </div>
        </div>
    );
}

/* ─── Create Store Modal ─────────────────────────────────────────── */
function CreateModal({ onClose, onCreate }) {
    const [name, setName] = useState('');
    const [engine, setEngine] = useState('woocommerce');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        setIsCreating(true);
        setError(null);
        try {
            await onCreate(name.trim(), engine);
        } catch (err) {
            setError(err.message);
            setIsCreating(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="modal">
                <h2 className="modal__title">Create New Store</h2>
                <p className="modal__subtitle">
                    A new WooCommerce store will be provisioned in an isolated Kubernetes namespace.
                </p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="store-name">Store Name</label>
                        <input
                            id="store-name"
                            type="text"
                            placeholder="e.g., My Test Shop"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={100}
                            autoFocus
                            disabled={isCreating}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="store-engine">Store Engine</label>
                        <select
                            id="store-engine"
                            value={engine}
                            onChange={(e) => setEngine(e.target.value)}
                            disabled={isCreating}
                        >
                            <option value="woocommerce">WooCommerce (WordPress)</option>
                            <option value="medusa" disabled>MedusaJS (Coming Soon)</option>
                        </select>
                    </div>

                    {error && (
                        <div className="store-card__error">
                            {error}
                        </div>
                    )}

                    <div className="modal__actions">
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={onClose}
                            disabled={isCreating}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={!name.trim() || isCreating}
                        >
                            {isCreating ? (
                                <>
                                    <span className="spinner" />
                                    Creating...
                                </>
                            ) : (
                                '+ Create Store'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* ─── Activity Log Component ────────────────────────────────────── */
function ActivityLog({ entries }) {
    const formatTime = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr + 'Z');
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    };

    const actionIcons = {
        create: '🆕',
        delete: '🗑️',
        status_change: '🔄',
        retry: '↻',
        recovery: '🔧',
    };

    if (entries.length === 0) {
        return (
            <div className="empty-state">
                <div className="empty-state__icon">📋</div>
                <h2 className="empty-state__title">No activity yet</h2>
                <p className="empty-state__text">Actions will appear here as you create, delete, and manage stores.</p>
            </div>
        );
    }

    return (
        <div className="activity-log">
            {entries.map(entry => {
                let details = {};
                try { details = JSON.parse(entry.details || '{}'); } catch (e) { }
                return (
                    <div key={entry.id} className="activity-entry">
                        <span className="activity-entry__icon">
                            {actionIcons[entry.action] || '•'}
                        </span>
                        <div className="activity-entry__content">
                            <span className="activity-entry__action">
                                {entry.action.replace('_', ' ')}
                            </span>
                            <span className="activity-entry__store">
                                {entry.store_id}
                            </span>
                            {details.status && (
                                <span className={`status-badge status-badge--${details.status}`} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                                    {details.status}
                                </span>
                            )}
                            {details.errorMessage && (
                                <span className="activity-entry__error">
                                    {details.errorMessage}
                                </span>
                            )}
                        </div>
                        <span className="activity-entry__time">
                            {formatTime(entry.created_at)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Metrics Panel Component ───────────────────────────────────── */
function MetricsPanel({ data }) {
    if (!data) {
        return (
            <div className="empty-state">
                <div className="spinner" style={{ width: 32, height: 32 }} />
                <p style={{ marginTop: 16 }}>Loading metrics...</p>
            </div>
        );
    }

    const formatDuration = (seconds) => {
        if (!seconds) return '—';
        if (seconds < 60) return `${seconds}s`;
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    };

    return (
        <div className="metrics-panel">
            <div className="metrics-section">
                <h3 className="metrics-section__title">📦 Store Overview</h3>
                <div className="metrics-grid">
                    <div className="metric-card">
                        <div className="metric-card__value">{data.stores?.total || 0}</div>
                        <div className="metric-card__label">Total Stores</div>
                    </div>
                    <div className="metric-card metric-card--ready">
                        <div className="metric-card__value">{data.stores?.byStatus?.ready || 0}</div>
                        <div className="metric-card__label">Ready</div>
                    </div>
                    <div className="metric-card metric-card--failed">
                        <div className="metric-card__value">{data.stores?.byStatus?.failed || 0}</div>
                        <div className="metric-card__label">Failed</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-card__value">{data.stores?.byStatus?.deleted || 0}</div>
                        <div className="metric-card__label">Deleted</div>
                    </div>
                </div>
            </div>

            <div className="metrics-section">
                <h3 className="metrics-section__title">⏱️ Provisioning Performance</h3>
                <div className="metrics-grid">
                    <div className="metric-card">
                        <div className="metric-card__value">{data.provisioning?.totalProvisioned || 0}</div>
                        <div className="metric-card__label">Total Provisioned</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-card__value">{formatDuration(data.provisioning?.avgDurationSeconds)}</div>
                        <div className="metric-card__label">Avg Duration</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-card__value">{formatDuration(data.provisioning?.minDurationSeconds)}</div>
                        <div className="metric-card__label">Fastest</div>
                    </div>
                    <div className="metric-card">
                        <div className="metric-card__value">{formatDuration(data.provisioning?.maxDurationSeconds)}</div>
                        <div className="metric-card__label">Slowest</div>
                    </div>
                </div>
            </div>

            {data.recentFailures?.length > 0 && (
                <div className="metrics-section">
                    <h3 className="metrics-section__title">❌ Recent Failures</h3>
                    <div className="failures-list">
                        {data.recentFailures.map(f => (
                            <div key={f.id} className="failure-entry">
                                <span className="failure-entry__name">{f.name}</span>
                                <span className="failure-entry__error">{f.error_message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
