/**
 * API Client for Store Platform Backend
 * 
 * Centralizes all API calls in one place.
 * In Kubernetes, the API is at api.127.0.0.1.nip.io
 * In development, Vite proxies /api to localhost:3001
 */

// In production (K8s), use the full API domain.
// In development (Vite), use proxy path.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    const data = await res.json();

    if (!res.ok) {
      // Supports both structured errors ({error: {code, message}}) and legacy strings
      const errorMsg = data.error?.message || data.error || `Request failed with status ${res.status}`;
      throw new Error(errorMsg);
    }

    return data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      throw new Error('Cannot connect to API. Is the backend running?');
    }
    throw error;
  }
}

export const storesApi = {
  /**
   * Get all stores.
   */
  getAll() {
    return request('/stores');
  },

  /**
   * Get a single store by ID.
   */
  getById(id) {
    return request(`/stores/${id}`);
  },

  /**
   * Create a new store.
   * @param {string} name - Store name
   * @param {string} engine - 'woocommerce' or 'medusa'
   */
  create(name, engine = 'woocommerce') {
    return request('/stores', {
      method: 'POST',
      body: JSON.stringify({ name, engine }),
    });
  },

  /**
   * Delete a store.
   */
  delete(id) {
    return request(`/stores/${id}`, { method: 'DELETE' });
  },

  /**
   * Retry a failed store provisioning.
   */
  retry(id) {
    return request(`/stores/${id}/retry`, { method: 'POST' });
  },

  /**
   * Get audit log.
   */
  getAudit(limit = 50) {
    return request(`/audit?limit=${limit}`);
  },

  /**
   * Health check.
   */
  health() {
    return request('/health');
  },

  /**
   * Get platform metrics.
   */
  getMetrics() {
    return request('/metrics');
  },
};
