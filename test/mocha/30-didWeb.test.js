/*!
 * Copyright 2023 - 2024 California Department of Motor Vehicles
 * Copyright 2023 - 2024 Digital Bazaar, Inc.
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as sinon from 'sinon';
import {httpClient} from '@digitalbazaar/http-client';
import https from 'node:https';

import {baseUrl} from '../mock-data.js';
import {config} from '@bedrock/core';
import {exampleKey2} from '../fixtures/signingKeys.js';
import '../../lib/index.js';

const agent = new https.Agent({rejectUnauthorized: false});
const client = httpClient.extend({agent});

const testDidWebDoc = {
  id: 'did:web:example.com',
  '@context': [
    'https://www.w3.org/ns/did/v1',
    {
      '@base': 'did:web:example.com'
    }
  ],
  service: [
    {
      id: '#linkeddomains',
      type: 'LinkedDomains',
      serviceEndpoint: {
        origins: [
          'https://example.com'
        ]
      }
    },
    {
      id: '#hub',
      type: 'IdentityHub',
      serviceEndpoint: {
        instances: [
          'https://hub.did.msidentity.com/v1.0/test-instance-id'
        ]
      }
    }
  ],
  verificationMethod: [
    {
      id: 'test-signing-key',
      controller: 'did:web:example.com',
      type: 'EcdsaSecp256k1VerificationKey2019',
      publicKeyJwk: {
        crv: 'secp256k1',
        kty: 'EC',
        x: 'test-x',
        y: 'test-y'
      }
    }
  ],
  authentication: [
    'test-signing-key'
  ],
  assertionMethod: [
    'test-signing-key'
  ]
};

const testLinkageDoc = {
  '@context': 'https://identity.foundation/.well-known/did-configuration/v1',
  // eslint-disable-next-line max-len
  linked_dids: ['eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDprZXk6ejZNa29USHNnTk5yYnk4SnpDTlExaVJMeVc1UVE2UjhYdXU2QUE4aWdHck1WUFVNI3o2TWtvVEhzZ05OcmJ5OEp6Q05RMWlSTHlXNVFRNlI4WHV1NkFBOGlnR3JNVlBVTSJ9.eyJleHAiOjE3NjQ4NzkxMzksImlzcyI6ImRpZDprZXk6ejZNa29USHNnTk5yYnk4SnpDTlExaVJMeVc1UVE2UjhYdXU2QUE4aWdHck1WUFVNIiwibmJmIjoxNjA3MTEyNzM5LCJzdWIiOiJkaWQ6a2V5Ono2TWtvVEhzZ05OcmJ5OEp6Q05RMWlSTHlXNVFRNlI4WHV1NkFBOGlnR3JNVlBVTSIsInZjIjp7IkBjb250ZXh0IjpbImh0dHBzOi8vd3d3LnczLm9yZy8yMDE4L2NyZWRlbnRpYWxzL3YxIiwiaHR0cHM6Ly9pZGVudGl0eS5mb3VuZGF0aW9uLy53ZWxsLWtub3duL2RpZC1jb25maWd1cmF0aW9uL3YxIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7ImlkIjoiZGlkOmtleTp6Nk1rb1RIc2dOTnJieThKekNOUTFpUkx5VzVRUTZSOFh1dTZBQThpZ0dyTVZQVU0iLCJvcmlnaW4iOiJpZGVudGl0eS5mb3VuZGF0aW9uIn0sImV4cGlyYXRpb25EYXRlIjoiMjAyNS0xMi0wNFQxNDoxMjoxOS0wNjowMCIsImlzc3VhbmNlRGF0ZSI6IjIwMjAtMTItMDRUMTQ6MTI6MTktMDY6MDAiLCJpc3N1ZXIiOiJkaWQ6a2V5Ono2TWtvVEhzZ05OcmJ5OEp6Q05RMWlSTHlXNVFRNlI4WHV1NkFBOGlnR3JNVlBVTSIsInR5cGUiOlsiVmVyaWZpYWJsZUNyZWRlbnRpYWwiLCJEb21haW5MaW5rYWdlQ3JlZGVudGlhbCJdfX0.aUFNReA4R5rcX_oYm3sPXqWtso_gjPHnWZsB6pWcGv6m3K8-4JIAvFov3ZTM8HxPOrOL17Qf4vBFdY9oK0HeCQ']
};

describe('OpenCred did:web support', function() {
  it('should return 404 if not enabled', async function() {
    const configStub = sinon.stub(config.opencred, 'didWeb')
      .value({mainEnabled: false});
    let result;
    let err;
    try {
      result = await client.get(`${baseUrl}/.well-known/did.json`);
    } catch(e) {
      err = e;
    }

    should.not.exist(result);
    err.status.should.be.equal(404);
    err.data.message.should.be.equal(
      'A did:web document is not available for this domain.'
    );

    configStub.restore();
  });

  it('should return did:web document', async function() {
    const didWebStub = sinon.stub(config.opencred, 'didWeb').value({
      mainEnabled: true,
      mainDocument: testDidWebDoc
    });
    const signingKeyStub = sinon.stub(config.opencred, 'signingKeys').value(
      [{...exampleKey2, purpose: ['authorization_request']}]
    );

    let result;
    let err;
    try {
      result = await client.get(`${baseUrl}/.well-known/did.json`);
    } catch(e) {
      err = e;
    }

    should.not.exist(err);
    result.status.should.be.equal(200);
    result.data.id.should.be.equal('did:web:example.com');
    result.data.verificationMethod.length.should.be.equal(2);

    didWebStub.restore();
    signingKeyStub.restore();
  });

  it('should return did:web document verificationMethod', async function() {
    const didWebStub = sinon.stub(config.opencred, 'didWeb').value({
      mainEnabled: true,
      mainDocument: testDidWebDoc
    });
    const signingKeyStub = sinon.stub(config.opencred, 'signingKeys').value(
      [{...exampleKey2, purpose: ['authorization_request']}]
    );

    let result;
    let err;
    try {
      result = await client.get(`${baseUrl}/.well-known/did.json`);
    } catch(e) {
      err = e;
    }

    should.not.exist(err);
    result.status.should.be.equal(200);
    result.data.id.should.be.equal('did:web:example.com');
    result.data.verificationMethod.length.should.be.equal(2);
    result.data.assertionMethod.length.should.be.equal(2);
    result.data.verificationMethod[0].id.should.be.equal(
      result.data.assertionMethod[0]
    );

    didWebStub.restore();
    signingKeyStub.restore();
  });
});

describe('DID Linked Domain credential endpoint', () => {
  it('should return an empty list if not enabled', async function() {
    const configStub = sinon.stub(config.opencred, 'didWeb').value({
      mainEnabled: true,
      linkageEnabled: false
    });

    let result;
    let err;
    try {
      result = await client.get(
        `${baseUrl}/.well-known/did-configuration.json`
      );
    } catch(e) {
      err = e;
    }

    should.not.exist(err);
    result.status.should.be.equal(200);
    result.data.linked_dids.length.should.be.equal(0);

    configStub.restore();
  });

  it('should return a DomainLinkageCredential', async function() {
    const didWebStub = sinon.stub(config.opencred, 'didWeb').value({
      mainEnabled: true,
      linkageEnabled: true,
      mainDocument: testDidWebDoc,
      linkageDocument: testLinkageDoc
    });

    let result;
    let err;
    try {
      result = await client.get(
        `${baseUrl}/.well-known/did-configuration.json`
      );
    } catch(e) {
      err = e;
    }

    should.not.exist(err);
    result.status.should.be.equal(200);
    result.data.linked_dids.length.should.be.equal(1);

    didWebStub.restore();
  });
});
