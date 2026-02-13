// Application configuration — env vars with sensible defaults.
// In Kubernetes, values are injected via ConfigMap/Secret.

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  dbPath: process.env.DB_PATH || './data/store-platform.db',

  helmChartPath: process.env.HELM_CHART_PATH || '/app/charts/woocommerce-chart',
  kubeconfig: process.env.KUBECONFIG || '',

  // nip.io provides wildcard DNS without /etc/hosts edits
  baseDomain: process.env.BASE_DOMAIN || '127.0.0.1.nip.io',

  maxStores: parseInt(process.env.MAX_STORES || '10', 10),
  provisionTimeoutMs: parseInt(process.env.PROVISION_TIMEOUT_MS || '600000', 10),

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10),
  rateLimitMaxCreates: parseInt(process.env.RATE_LIMIT_MAX_CREATES || '5', 10),

  wpAdminUser: process.env.WP_ADMIN_USER || 'admin',
  wpAdminEmail: process.env.WP_ADMIN_EMAIL || 'admin@example.com',
};

module.exports = config;
