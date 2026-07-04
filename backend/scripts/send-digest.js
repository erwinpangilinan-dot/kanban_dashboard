#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { sendDailyDigest } = require('../src/services/digest');

sendDailyDigest()
  .then((ok) => {
    if (!ok) {
      console.error('Digest not configured. Set GOOGLE_* + EMAIL_TO or SMTP_* + EMAIL_TO.');
      process.exit(1);
    }
    console.log('✓ Daily digest sent');
  })
  .catch((err) => {
    console.error('✗ Digest send failed:', err.message);
    process.exit(1);
  });
