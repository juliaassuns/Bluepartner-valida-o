const { closeDb } = require('../db');
const { cleanTestDb } = require('./setup');

module.exports = async () => {
  await closeDb();
  cleanTestDb();
};
