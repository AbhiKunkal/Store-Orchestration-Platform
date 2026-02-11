/**
 * Helm Client (Wrapper)
 * 
 * Interacts with the Helm CLI to install/uninstall charts.
 * 
 * WHY shell out to CLI?
 * - Node.js Helm libraries are often unmaintained or incomplete
 * - The CLI is the reference implementation
 * - Easy to debug (just run the same command in terminal)
 * - Same approach used by sophisticated tools like ArgoCD (execs helm/git)
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);

// Helm operations can be slow (pulling images, waiting for resources)
const HELM_TIMEOUT = 600000; // 10 minutes

async function helmExec(args) {
  try {
    const opts = {
      timeout: HELM_TIMEOUT,
      maxBuffer: 1024 * 1024, // 1MB buffer for large outputs
    };

    // Inject KUBECONFIG if set (for local dev vs in-cluster)
    if (config.kubeconfig) {
      opts.env = { ...process.env, KUBECONFIG: config.kubeconfig };
    }

    const { stdout, stderr } = await execFileAsync('helm', args, opts);

    if (stderr) {
      // Helm sometimes prints warnings to stderr which aren't fatal
      console.warn(`[helm warn] ${args.join(' ')}: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    const msg = error.stderr || error.message;
    console.error(`[helm error] ${args.join(' ')}: ${msg}`);
    throw new Error(`Helm command failed: ${msg}`);
  }
}

/**
 * Install or Upgrade a Release
 * 
 * Idempotent: safe to run multiple times.
 * - --create-namespace: ensures target namespace exists
 * - --atomic: if it fails, it rolls back (removed here to allow debugging, see note)
 * 
 * NOTE: We do NOT use --wait or --atomic here because the Init Job can take
 * 3-10 minutes. We don't want to block the API thread for that long.
 * We rely on the Provisioner service to poll for readiness.
 */
async function install({ releaseName, chartPath, namespace, values = {} }) {
  // Check if already installed
  const exists = await releaseExists(releaseName, namespace);
  if (exists) {
    console.log(`[helm] Release ${releaseName} already exists in ${namespace}, skipping install`);
    return { alreadyExists: true };
  }

  const args = [
    'install', releaseName, chartPath,
    '--namespace', namespace,
    '--create-namespace',
  ];

  // Flatten values object into --set arguments
  for (const [key, value] of Object.entries(values)) {
    args.push('--set', `${key}=${value}`);
  }

  const output = await helmExec(args);
  return { installed: true, output };
}

/**
 * Uninstall a Release
 * 
 * Idempotent: checks existence first.
 */
async function uninstall({ releaseName, namespace }) {
  const exists = await releaseExists(releaseName, namespace);
  if (!exists) {
    console.log(`[helm] Release ${releaseName} not found in ${namespace}, nothing to uninstall`);
    return { alreadyRemoved: true };
  }

  const output = await helmExec([
    'uninstall', releaseName,
    '--namespace', namespace,
    '--wait', // Wait for deletion to finish
  ]);
  return { uninstalled: true, output };
}

async function releaseExists(releaseName, namespace) {
  try {
    const output = await helmExec([
      'status', releaseName,
      '--namespace', namespace,
      '--output', 'json',
    ]);
    return true;
  } catch (error) {
    return false;
  }
}

async function listReleases(namespace) {
  const args = ['list', '--output', 'json'];
  if (namespace) {
    args.push('--namespace', namespace);
  } else {
    args.push('--all-namespaces');
  }

  const output = await helmExec(args);
  return JSON.parse(output || '[]');
}

module.exports = {
  install,
  uninstall,
  releaseExists,
  listReleases,
};
