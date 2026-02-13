// Helm CLI wrapper — shells out to helm binary for install/uninstall/status.
// Same approach used by ArgoCD — CLI is the reference implementation.

const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);
const HELM_TIMEOUT = 600000; // 10 minutes

async function helmExec(args) {
  try {
    const opts = {
      timeout: HELM_TIMEOUT,
      maxBuffer: 1024 * 1024,
    };

    if (config.kubeconfig) {
      opts.env = { ...process.env, KUBECONFIG: config.kubeconfig };
    }

    const { stdout, stderr } = await execFileAsync('helm', args, opts);

    if (stderr) {
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
 * Install a release. Idempotent — skips if already installed.
 * Does NOT use --wait or --atomic: init jobs can take 3-10 minutes,
 * and we rely on the provisioner to poll for readiness instead.
 */
async function install({ releaseName, chartPath, namespace, values = {} }) {
  const exists = await releaseExists(releaseName, namespace);
  if (exists) {
    console.log(`[helm] Release ${releaseName} already exists in ${namespace}, skipping`);
    return { alreadyExists: true };
  }

  const args = [
    'install', releaseName, chartPath,
    '--namespace', namespace,
    '--create-namespace',
  ];

  for (const [key, value] of Object.entries(values)) {
    args.push('--set', `${key}=${value}`);
  }

  const output = await helmExec(args);
  return { installed: true, output };
}

/** Uninstall a release. Idempotent — no-op if not found. */
async function uninstall({ releaseName, namespace }) {
  const exists = await releaseExists(releaseName, namespace);
  if (!exists) {
    console.log(`[helm] Release ${releaseName} not found in ${namespace}, nothing to uninstall`);
    return { alreadyRemoved: true };
  }

  const output = await helmExec([
    'uninstall', releaseName,
    '--namespace', namespace,
    '--wait',
  ]);
  return { uninstalled: true, output };
}

async function releaseExists(releaseName, namespace) {
  try {
    await helmExec([
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
