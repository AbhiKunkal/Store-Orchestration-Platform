/**
 * WooCommerce Store Engine
 * 
 * Implements the Store Engine Interface.
 * Defines how to configure and deploy a WooCommerce store.
 * 
 * ARCHITECTURE NOTE:
 * This engine generates Helm values that configure the generic 'woocommerce-chart'.
 * It injects:
 * - Unique MySQL credentials (so each store is isolated)
 * - WordPress admin credentials
 * - Ingress hostnames (e.g. store-123.platform.local)
 */

const path = require('path');
const crypto = require('crypto');
const config = require('../../config');

const ENGINE_NAME = 'woocommerce';

// Helper to generate secure random passwords
function generatePassword(length = 16) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function getChartPath() {
  return config.helmChartPath;
}

/**
 * Generate Helm 'values.yaml' overrides for a specific store instance.
 */
function getHelmValues(storeId) {
  // Generate unique credentials for this store instance
  const mysqlRootPassword = generatePassword();
  const mysqlPassword = generatePassword();
  const wpAdminPassword = generatePassword(12);

  return {
    'store.id': storeId,
    'store.domain': `${storeId}.${config.baseDomain}`,

    // MySQL configuration
    'mysql.rootPassword': mysqlRootPassword,
    'mysql.database': 'wordpress',
    'mysql.user': 'wordpress',
    'mysql.password': mysqlPassword,

    // WordPress configuration
    'wordpress.adminUser': config.wpAdminUser,
    'wordpress.adminPassword': wpAdminPassword,
    'wordpress.adminEmail': config.wpAdminEmail,
    'wordpress.siteTitle': storeId,

    // Ingress configuration
    'ingress.host': `${storeId}.${config.baseDomain}`,
    'ingress.className': 'nginx',
  };
}

function getUrls(storeId) {
  const host = `${storeId}.${config.baseDomain}`;
  return {
    storeUrl: `http://${host}`,
    adminUrl: `http://${host}/wp-admin`,
  };
}

function validate() {
  // We could check if the chart path exists here
  return { valid: true };
}

module.exports = {
  name: ENGINE_NAME,
  getChartPath,
  getHelmValues,
  getUrls,
  validate,
};
