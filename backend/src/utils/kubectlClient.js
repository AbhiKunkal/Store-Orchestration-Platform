/**
 * Kubectl Client (Wrapper)
 * 
 * Used for operations that Helm doesn't handle well or for status checks.
 * - Namespace management (ensuring complete cleanup)
 * - Pod status polling (readiness checks)
 * - Log retrieval (future use)
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);
const KUBECTL_TIMEOUT = 30000; // 30s timeout for status checks

async function kubectlExec(args) {
  try {
    const opts = { timeout: KUBECTL_TIMEOUT };
    if (config.kubeconfig) {
      opts.env = { ...process.env, KUBECONFIG: config.kubeconfig };
    }

    const { stdout } = await execFileAsync('kubectl', args, opts);
    return stdout.trim();
  } catch (error) {
    const msg = error.stderr || error.message;
    // Don't log here, let caller handle errors (e.g. "Previous install failed")
    throw new Error(`kubectl failed: ${msg}`);
  }
}

async function namespaceExists(namespace) {
  try {
    await kubectlExec(['get', 'namespace', namespace, '-o', 'name']);
    return true;
  } catch (e) {
    return false;
  }
}

async function deleteNamespace(namespace) {
  const exists = await namespaceExists(namespace);
  if (!exists) {
    console.log(`[kubectl] Namespace ${namespace} doesn't exist, skipping delete`);
    return;
  }

  // Cascading delete - removes all resources in the namespace
  await kubectlExec(['delete', 'namespace', namespace, '--wait=true']);
}

/**
 * Get detailed pod status for debugging
 * Returns: [{ name, phase, ready, restarts }]
 */
async function getPodStatuses(namespace) {
  try {
    const output = await kubectlExec([
      'get', 'pods',
      '--namespace', namespace,
      '-o', 'json',
    ]);
    
    const data = JSON.parse(output);
    return data.items.map(pod => {
      const conditions = pod.status.conditions || [];
      const isReady = conditions.some(c => c.type === 'Ready' && c.status === 'True');
      const containerStatuses = pod.status.containerStatuses || [];
      const restarts = containerStatuses.reduce((acc, curr) => acc + curr.restartCount, 0);

      return {
        name: pod.metadata.name,
        phase: pod.status.phase,
        ready: isReady,
        restarts: restarts,
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * Check if ALL pods in a namespace are active and ready.
 * Used by the provisioner to know when a store is "Ready".
 */
async function allPodsReady(namespace) {
  const pods = await getPodStatuses(namespace);
  if (pods.length === 0) return false;

  // Filter out Completed jobs (like valid init jobs)
  // We want to check if long-running pods (like wordpress, mysql) are Ready
  const runningPods = pods.filter(p => p.phase !== 'Succeeded');

  if (runningPods.length === 0) return false; // Should be at least one running pod

  return runningPods.every(p => p.ready);
}

// Check if a specific job has completed successfully
async function jobCompleted(namespace, jobName) {
  try {
    const output = await kubectlExec([
      'get', 'job', jobName,
      '--namespace', namespace,
      '-o', 'jsonpath={.status.conditions[?(@.type=="Complete")].status}',
    ]);
    return output === 'True';
  } catch {
    return false;
  }
}

// Check if a job failed (backoff limit reached)
async function jobFailed(namespace, jobName) {
  try {
    const output = await kubectlExec([
      'get', 'job', jobName,
      '--namespace', namespace,
      '-o', 'jsonpath={.status.conditions[?(@.type=="Failed")].status}',
    ]);
    return output === 'True';
  } catch {
    return false;
  }
}

/**
 * Get recent events for a namespace (useful for error messages)
 */
async function getEvents(namespace, limit = 10) {
  try {
    const output = await kubectlExec([
      'get', 'events', 
      '--namespace', namespace,
      '--sort-by=.metadata.creationTimestamp',
      '-o', 'json'
    ]);
    const data = JSON.parse(output);
    const items = data.items || [];
    
    return items.slice(-limit).map(e => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      object: e.involvedObject.name,
      timestamp: e.lastTimestamp
    }));
  } catch {
    return [];
  }
}

module.exports = {
  namespaceExists,
  deleteNamespace,
  getPodStatuses,
  allPodsReady,
  jobCompleted,
  jobFailed,
  getEvents,
};
