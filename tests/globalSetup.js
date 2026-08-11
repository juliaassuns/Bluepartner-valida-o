const { cleanTestDb } = require('./setup');
const { initDatabase } = require('../db');

module.exports = async () => {
  cleanTestDb();
  await initDatabase();
};
