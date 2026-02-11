/**
 * Store Provisioner Service
 * 
 * Orchestrates the lifecycle of a store:
 * Create DB record -> Validate Engine -> Helm Install -> Wait for Readiness -> Update DB
 * 
 * DESIGN PATTERNS:
 * - Facade: This service acts as the single entry point for store operations, hiding 
 *   the complexity of Helm, Kubernetes, and Database interactions from the API layer.
 * - Strategy: Uses different "Store Engines" (WooCommerce, Medusa) to handle 
 *   engine-specific logic (Helm values, URL generation), while keeping the core 
 *   provisioning flow generic.
 * - State Machine: Enforces valid state transitions (queued -> provisioning -> ready/failed).
 * - Reconciliation: The recoverOnStartup() function acts as a reconciler, fixing 
 *   inconsistent states (e.g. stores stuck in 'provisioning' if the server crashed).
 * - Concurrency Control: Uses an in-memory Map to prevent double-submitting operations 
 *   for the same store ID.
 */

const { store, audit } = require('../db');
const helm = require('../utils/helmClient');
const kubectl = require('../utils/kubectlClient');
const config = require('../config');

// Load store engines (Strategy Pattern)
const engines = {
  woocommerce: require('./storeEngines/woocommerce'),
  medusa: require('./storeEngines/medusa'),
};

// In-memory lock to prevent concurrent operations on the same store
const activeOperations = new Map();

function getEngine(engineName) {
  const engine = engines[engineName];
  if (!engine) {
    throw new Error(`Unknown store engine: ${engineName}. Available: ${Object.keys(engines).join(', ')}`);
  }
  return engine;
}

/**
 * Provision a store (Async)
 * 
 * Flow:
 * 1. Mark as 'provisioning'
 * 2. Get Helm values from engine
 * 3. Run Helm Install
 * 4. Poll K8s for pod readiness (this is the long-running part)
 * 5. Mark as 'ready' and save URLs
 * 
 * On Failure:
 * - Logs error to DB
 * - Marks store as 'failed'
 * - Does NOT automatically rollback (allows for manual debugging/retrying)
 */
async function provisionStore(storeId) {
  if (activeOperations.has(storeId)) {
    console.log(`[provisioner] Operation already active for ${storeId}`);
    return;
  }

  activeOperations.set(storeId, 'provisioning');
  
  // Safety timeout to clear the lock if something hangs indefinitely
  const timeoutHandle = setTimeout(() => {
    handleTimeout(storeId);
  }, config.provisionTimeoutMs);

  try {
    const storeRecord = store.getById(storeId);
    if (!storeRecord) {
      throw new Error(`Store ${storeId} not found in database`);
    }

    const engine = getEngine(storeRecord.engine);

    // Validate engine requirements (check if chart exists, etc.)
    const validation = engine.validate();
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 1. Update status
    store.updateStatus(storeId, 'provisioning');
    console.log(`[provisioner] Starting provisioning for ${storeId} (${storeRecord.engine})`);

    const namespace = storeRecord.namespace;
    const releaseName = storeRecord.helm_release;
    const chartPath = engine.getChartPath();
    const values = engine.getHelmValues(storeId);

    // 2. Helm Install
    console.log(`[provisioner] Running helm install for ${releaseName} in ${namespace}`);
    const helmResult = await helm.install({
      releaseName,
      chartPath,
      namespace,
      values,
    });

    if (helmResult.alreadyExists) {
      console.log(`[provisioner] Helm release already exists, proceeding to check readiness`);
    }

    // 3. Wait for readiness
    // This is crucial: we don't want to say "Ready" until the user can actually use the store.
    console.log(`[provisioner] Waiting for pods to be ready in ${namespace}`);
    await waitForPodsReady(namespace, storeId);

    // 4. Finalize
    const urls = engine.getUrls(storeId);
    store.markReady(storeId, urls.storeUrl, urls.adminUrl);
    
    console.log(`[provisioner] Store ${storeId} is READY at ${urls.storeUrl}`);

  } catch (error) {
    console.error(`[provisioner] Failed to provision ${storeId}:`, error.message);
    
    // Update DB with failure reason
    store.updateStatus(storeId, 'failed', error.message);
    
  } finally {
    clearTimeout(timeoutHandle);
    activeOperations.delete(storeId);
  }
}

/**
 * Delete a store (Async)
 * 
 * Flow:
 * 1. Helm Uninstall (removes most resources)
 * 2. Kubectl Delete Namespace (cascading delete for anything left behind)
 * 3. Mark as 'deleted' in DB
 * 
 * Idempotency is key here: we must be able to retry if the first attempt fails.
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

    // 1. Uninstall Helm release
    try {
      await helm.uninstall({ releaseName, namespace });
      console.log(`[provisioner] Helm release ${releaseName} uninstalled`);
    } catch (error) {
      console.warn(`[provisioner] Helm uninstall warning: ${error.message}`);
      // Continue anyway, namespace delete is the big hammer
    }

    // 2. Delete namespace (ensures PVCs and Secrets are gone)
    try {
      await kubectl.deleteNamespace(namespace);
      console.log(`[provisioner] Namespace ${namespace} deleted`);
    } catch (error) {
      console.warn(`[provisioner] Namespace delete warning: ${error.message}`);
    }

    // 3. Mark deleted
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

/**
 * Polls for pod readiness
 * 
 * Fails fast if it detects CrashLoopBackOff or ImagePullBackOff.
 */
async function waitForPodsReady(namespace, storeId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    // Check if everything is ready
    const ready = await kubectl.allPodsReady(namespace);
    if (ready) {
      console.log(`[provisioner] All pods ready in ${namespace} (attempt ${i + 1})`);
      return;
    }

    // Check for obvious failures to fail fast
    const pods = await kubectl.getPodStatuses(namespace);
    const failedPods = pods.filter(p => p.phase === 'Failed' || p.restarts > 5);
    
    if (failedPods.length > 0) {
      const events = await kubectl.getEvents(namespace, 5);
      const eventSummary = events.map(e => `${e.reason}: ${e.message}`).join('; ');
      throw new Error(`Pods failed: ${failedPods.map(p => p.name).join(', ')}. Events: ${eventSummary}`);
    }

    // Wait 5 seconds between checks
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
 * Startup Recovery
 * 
 * Called when the API server starts. Checks if any stores were left in 
 * 'provisioning' state (e.g. if the server crashed).
 * 
 * It checks the actual cluster state (Are pods running?) and updates the DB.
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
      
      // Check actual cluster state
      const ready = await kubectl.allPodsReady(stuckStore.namespace);
      
      if (ready) {
        // It finished while we were down!
        const engine = getEngine(stuckStore.engine);
        const urls = engine.getUrls(stuckStore.id);
        store.markReady(stuckStore.id, urls.storeUrl, urls.adminUrl);
        audit.log(stuckStore.id, 'recovery', { result: 'marked_ready', reason: 'pods ready after restart' });
        console.log(`[provisioner] Recovery: ${stuckStore.id} marked READY (pods were running)`);
      } else {
        // It failed or was interrupted. Mark failed so user can retry.
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
