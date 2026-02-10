/**
 * Application configuration.
 * 
 * All environment-specific values are read from env vars with sensible defaults.
 * In Kubernetes, these are set via the Helm chart's ConfigMap/Secret.
 * Locally for development, defaults are used.
 */

const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  dbPath: process.env.DB_PATH || './data/store-platform.db',

  // Kubernetes / Helm
  helmChartPath: process.env.HELM_CHART_PATH || '/app/charts/woocommerce-chart',
  kubeconfig: process.env.KUBECONFIG || '', // empty = in-cluster config
  
  // Domain configuration
  // nip.io gives us wildcard DNS without editing /etc/hosts
  baseDomain: process.env.BASE_DOMAIN || '127.0.0.1.nip.io',
  
  // Store provisioning
  maxStores: parseInt(process.env.MAX_STORES || '10', 10),
  provisionTimeoutMs: parseInt(process.env.PROVISION_TIMEOUT_MS || '600000', 10), // 10 min

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 min
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10),
  rateLimitMaxCreates: parseInt(process.env.RATE_LIMIT_MAX_CREATES || '5', 10), // stricter for create

  // WooCommerce defaults
  wpAdminUser: process.env.WP_ADMIN_USER || 'admin',
  wpAdminEmail: process.env.WP_ADMIN_EMAIL || 'admin@example.com',
};

module.exports = config;
