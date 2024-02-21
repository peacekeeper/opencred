/*!
 * Copyright (c) 2024 Digital Bazaar, Inc. All rights reserved.
 */
import '@bedrock/core';

import '@bedrock/express';
import '@bedrock/views';
import '@bedrock/webpack';
import '@bedrock/health';
// import '@bedrock/manifest-proxy';
// import '@bedrock/package-manager';
import '@bedrock/express-browser-fixes';
import '@bedrock/health';
import '@bedrock/server';

// load config
import '../configs/config.js';

import './api.js';
import './http.js';
import './database.js';