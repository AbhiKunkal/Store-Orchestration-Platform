// WooCommerce store engine — generates Helm values and URLs for WooCommerce deployments.

const path = require('path');
const crypto = require('crypto');
const config = require('../../config');

const ENGINE_NAME = 'woocommerce';

function generatePassword(length = 16) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function getChartPath() {
  return config.helmChartPath;
}

/** Generate Helm value overrides for a specific store instance. */
function getHelmValues(storeId) {
  const mysqlRootPassword = generatePassword();
  const mysqlPassword = generatePassword();
  const wpAdminPassword = generatePassword(12);

  return {
    'store.id': storeId,
    'store.domain': `${storeId}.${config.baseDomain}`,

    'mysql.rootPassword': mysqlRootPassword,
    'mysql.database': 'wordpress',
    'mysql.user': 'wordpress',
    'mysql.password': mysqlPassword,

    'wordpress.adminUser': config.wpAdminUser,
    'wordpress.adminPassword': wpAdminPassword,
    'wordpress.adminEmail': config.wpAdminEmail,
    'wordpress.siteTitle': storeId,

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
  return { valid: true };
}

module.exports = {
  name: ENGINE_NAME,
  getChartPath,
  getHelmValues,
  getUrls,
  validate,
};
