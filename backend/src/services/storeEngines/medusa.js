/**
 * MedusaJS Store Engine (STUB)
 * 
 * Placeholder for future MedusaJS support.
 * Demonstrates how the Strategy pattern allows adding new engines 
 * without modifying the core provisioner logic.
 * 
 * INTERVIEW NOTE:
 * This exists to show I thought about extensibility.
 * Adding a new e-commerce engine (Magneto, Shopify-compatible, etc.) 
 * would just mean adding a new file here and a new Helm chart.
 */

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
    error: 'MedusaJS engine is not yet implemented. Please use WooCommerce.' 
  };
}

module.exports = {
  name: ENGINE_NAME,
  getChartPath,
  getHelmValues,
  getUrls,
  validate,
};
