// Store provisioner — orchestrates lifecycle: create → provision → ready/failed → delete.
// Uses store engines (Strategy pattern) for engine-specific Helm values and URLs.
// Tracks active operations in-memory to prevent concurrent ops on the same store.

const { store, audit } = require('../db');
const helm = require('../utils/helmClient');
const kubectl = require('../utils/kubectlClient');
const config = require('../config');

const engines = {
  woocommerce: require('./storeEngines/woocommerce'),
  medusa: require('./storeEngines/medusa'),
};

// Prevents concurrent operations on the same store (single-process lock)
const activeOperations = new Map();

function getEngine(engineName) {
  const engine = engines[engineName];
  if (!engine) {
    throw new Error(`Unknown store engine: ${engineName}. Available: ${Object.keys(engines).join(', ')}`);
  }
  return engine;
}

/**
 * Provision a store asynchronously.
 * Flow: mark provisioning → helm install → poll readiness → mark ready.
 * On failure: logs error, marks failed. Does NOT auto-rollback (allows debugging/retry).
 */
async function provisionStore(storeId) {
  if (activeOperations.has(storeId)) {
    console.log(`[provisioner] Operation already active for ${storeId}`);
    return;
  }

  activeOperations.set(storeId, 'provisioning');

  const timeoutHandle = setTimeout(() => {
    handleTimeout(storeId);
  }, config.provisionTimeoutMs);

  try {
    const storeRecord = store.getById(storeId);
    if (!storeRecord) {
      throw new Error(`Store ${storeId} not found in database`);
    }

    const engine = getEngine(storeRecord.engine);

    const validation = engine.validate();
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    store.updateStatus(storeId, 'provisioning');
    console.log(`[provisioner] Starting provisioning for ${storeId} (${storeRecord.engine})`);

    const namespace = storeRecord.namespace;
    const releaseName = storeRecord.helm_release;
    const chartPath = engine.getChartPath();
    const values = engine.getHelmValues(storeId);

    console.log(`[provisioner] Running helm install for ${releaseName} in ${namespace}`);
    const helmResult = await helm.install({
      releaseName, chartPath, namespace, values,
    });

    if (helmResult.alreadyExists) {
      console.log(`[provisioner] Helm release already exists, checking readiness`);
    }

    console.log(`[provisioner] Waiting for pods to be ready in ${namespace}`);
    await waitForPodsReady(namespace, storeId);

    const urls = engine.getUrls(storeId);
    store.markReady(storeId, urls.storeUrl, urls.adminUrl);

    console.log(`[provisioner] Store ${storeId} is READY at ${urls.storeUrl}`);

  } catch (error) {
    console.error(`[provisioner] Failed to provision ${storeId}:`, error.message);
    store.updateStatus(storeId, 'failed', error.message);

  } finally {
    clearTimeout(timeoutHandle);
    activeOperations.delete(storeId);
  }
}

/**
 * Delete a store asynchronously.
 * Flow: helm uninstall → kubectl delete namespace (cascade) → mark deleted.
 * Belt-and-suspenders: namespace delete catches anything helm missed.
 */
async function deleteStore(storeId) {
  if (activeOperations.has(storeId)) {
    console.log(`[provisioner] Operation already active for ${storeId}`);
    throw new Error('An operation is already in progress for this store');
  }

  activeOperations.set(storeId, 'deleting');

  try {
    const storeRecord = store.getById(storeId);
    if (!storeRecord) {
      throw new Error(`Store ${storeId} not found`);
    }

    store.updateStatus(storeId, 'deleting');
    console.log(`[provisioner] Deleting store ${storeId}`);

    const namespace = storeRecord.namespace;
    const releaseName = storeRecord.helm_release;

    try {
      await helm.uninstall({ releaseName, namespace });
      console.log(`[provisioner] Helm release ${releaseName} uninstalled`);
    } catch (error) {
      console.warn(`[provisioner] Helm uninstall warning: ${error.message}`);
    }

    try {
      await kubectl.deleteNamespace(namespace);
      console.log(`[provisioner] Namespace ${namespace} deleted`);
    } catch (error) {
      console.warn(`[provisioner] Namespace delete warning: ${error.message}`);
    }

    store.markDeleted(storeId);
    console.log(`[provisioner] Store ${storeId} fully deleted`);

  } catch (error) {
    console.error(`[provisioner] Failed to delete ${storeId}:`, error.message);
    store.updateStatus(storeId, 'failed', `Delete failed: ${error.message}`);
    throw error;
  } finally {
    activeOperations.delete(storeId);
  }
}

/** Polls pod readiness. Fails fast on CrashLoopBackOff or excessive restarts. */
async function waitForPodsReady(namespace, storeId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await kubectl.allPodsReady(namespace);
    if (ready) {
      console.log(`[provisioner] All pods ready in ${namespace} (attempt ${i + 1})`);
      return;
    }

    const pods = await kubectl.getPodStatuses(namespace);
    const failedPods = pods.filter(p => p.phase === 'Failed' || p.restarts > 5);

    if (failedPods.length > 0) {
      const events = await kubectl.getEvents(namespace, 5);
      const eventSummary = events.map(e => `${e.reason}: ${e.message}`).join('; ');
      throw new Error(`Pods failed: ${failedPods.map(p => p.name).join(', ')}. Events: ${eventSummary}`);
    }

    await sleep(5000);

    if (i % 5 === 0) {
      console.log(`[provisioner] Waiting for pods in ${namespace} (attempt ${i + 1}/${maxAttempts})`);
    }
  }

  throw new Error(`Pods did not become ready within ${maxAttempts * 5} seconds`);
}

function handleTimeout(storeId) {
  if (activeOperations.has(storeId)) {
    console.error(`[provisioner] Timeout for ${storeId}`);
    store.updateStatus(storeId, 'failed', 'Provisioning timed out');
    activeOperations.delete(storeId);
  }
}

function getOperationStatus(storeId) {
  return activeOperations.get(storeId) || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Startup recovery — reconciles DB state with cluster reality.
 * Called on API boot to fix stores stuck in 'provisioning' or 'queued'
 * (e.g., after an API crash mid-provision).
 */
async function recoverOnStartup() {
  const allStores = store.getAll();
  const stuckStores = allStores.filter(s =>
    s.status === 'provisioning' || s.status === 'queued'
  );

  if (stuckStores.length === 0) {
    console.log('[provisioner] Startup recovery: no stuck stores found');
    return;
  }

  console.log(`[provisioner] Startup recovery: found ${stuckStores.length} stuck store(s)`);

  for (const stuckStore of stuckStores) {
    try {
      console.log(`[provisioner] Checking stuck store ${stuckStore.id} (status: ${stuckStore.status})`);

      const ready = await kubectl.allPodsReady(stuckStore.namespace);

      if (ready) {
        const engine = getEngine(stuckStore.engine);
        const urls = engine.getUrls(stuckStore.id);
        store.markReady(stuckStore.id, urls.storeUrl, urls.adminUrl);
        audit.log(stuckStore.id, 'recovery', { result: 'marked_ready', reason: 'pods ready after restart' });
        console.log(`[provisioner] Recovery: ${stuckStore.id} marked READY (pods were running)`);
      } else {
        store.updateStatus(
          stuckStore.id,
          'failed',
          'API restarted during provisioning. Click retry to re-attempt.'
        );
        audit.log(stuckStore.id, 'recovery', { result: 'marked_failed', reason: 'API restart interrupted provisioning' });
        console.log(`[provisioner] Recovery: ${stuckStore.id} marked FAILED (provisioning interrupted)`);
      }
    } catch (error) {
      console.error(`[provisioner] Recovery failed for ${stuckStore.id}:`, error.message);
      store.updateStatus(stuckStore.id, 'failed', `Recovery failed: ${error.message}`);
    }
  }

  console.log('[provisioner] Startup recovery complete');
}

module.exports = {
  provisionStore,
  deleteStore,
  getEngine,
  getOperationStatus,
  recoverOnStartup,
};
