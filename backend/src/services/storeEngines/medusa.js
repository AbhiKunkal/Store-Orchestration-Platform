// MedusaJS store engine — stub for future implementation.
// Adding a new engine requires: this file + a new Helm chart.

const ENGINE_NAME = 'medusa';

function getChartPath() {
  throw new Error('MedusaJS engine is not implemented yet');
}

function getHelmValues(_storeId) {
  throw new Error('MedusaJS engine is not implemented yet');
}

function getUrls(storeId) {
  return {
    storeUrl: `http://${storeId}.localhost:8000`,
    adminUrl: `http://${storeId}.localhost:7001`,
  };
}

function validate() {
  return {
    valid: false,
    error: 'MedusaJS engine is not yet implemented. Please use WooCommerce.',
  };
}

module.exports = {
  name: ENGINE_NAME,
  getChartPath,
  getHelmValues,
  getUrls,
  validate,
};
