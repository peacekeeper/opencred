import {
  createId,
  normalizeVpTokenDataIntegrity,
  normalizeVpTokenJWT
} from '../../common/utils.js';
import {config} from '../../config/config.js';
import {exchanges} from '../../common/database.js';
import {getDocumentLoader} from '../../common/documentLoader.js';
import jp from 'jsonpath';
import {oid4vp} from '@digitalbazaar/oid4-client';
import {SUITES} from '../../common/suites.js';
import {UnsecuredJWT} from 'jose';
import {verifyUtils} from '../../common/utils.js';

export const createExchange = async (domain, workflow, oidcState = '') => {
  const id = await createId();
  const workflowId = workflow.id;
  const accessToken = await createId();
  const challenge = await createId();
  const createdAt = new Date();
  const ttl = 60 * 15;
  const oidc = {
    code: null,
    state: oidcState
  };
  await exchanges.insertOne({
    id,
    workflowId,
    sequence: 0,
    ttl,
    state: 'pending',
    variables: {},
    step: workflow.initialStep,
    challenge,
    accessToken,
    createdAt,
    recordExpiresAt: new Date(createdAt.getTime() + 86400000 + (ttl * 1000)),
    oidc
  });
  const vcapi = `${domain}/workflows/${workflow.id}/exchanges/${id}`;
  const authzReqUrl = `${vcapi}/openid/client/authorization/request`;
  const searchParams = new URLSearchParams({
    client_id: `${vcapi}/openid/client/authorization/response`,
    request_uri: authzReqUrl
  });
  const OID4VP = 'openid4vp://?' + searchParams.toString();
  return {id, vcapi, OID4VP, accessToken, workflowId};
};

export const getExchange = async (id, {others, allowExpired} = {
  others: {}, allowExpired: false
}) => {
  const exchange = await exchanges.findOne({id, ...others}, {
    projection: {_id: 0}
  });
  if(!allowExpired) {
    const expiry = new Date(exchange.createdAt.getTime() + exchange.ttl * 1000);
    if(new Date() > expiry) {
      return null;
    }
  }
  return exchange;
};

export const createNativeExchange = async (req, res, next) => {
  const rp = req.rp;
  if(!rp || !rp.workflow || rp.workflow.type !== 'native') {
    next();
    return;
  }
  req.exchange = await createExchange(
    config.domain, rp.workflow, req.query.state
  );
  next();
};

export const verifySubmission = async (vp_token, submission, exchange) => {
  let errors = [];
  let vpVerified = false;
  const documentLoader = getDocumentLoader().build();
  const {presentation_definition} = exchange.variables.authorizationRequest;
  if(submission.definition_id !== presentation_definition.id) {
    errors.push(`Presentation Definition doesn't match Submission`);
  } else if(submission.descriptor_map.length !==
    presentation_definition.input_descriptors.length) {
    errors.push(`${presentation_definition.input_descriptors.length} ` +
      `Presentation Definition descriptors found and ` +
      `${submission.descriptor_map.length} Presentation Submission ` +
      `descriptors found`);
  } else {
    for(const descriptor of presentation_definition.input_descriptors) {
      const submitted = submission.descriptor_map
        .find(d => d.id === descriptor.id);
      if(!submitted) {
        errors.push(`Submission not found for input descriptor`);
      } else if(submitted.format === 'jwt_vc_json') {
        const vp = normalizeVpTokenJWT(vp_token)[0];
        if(!vpVerified) {
          const result = await verifyUtils.verifyJWT(vp.jwt);
          if(!result.verified) {
            errors = [...errors, ...result.errors];
          }
          vpVerified = true;
        }
        const vc = jp.query(vp.payload, submitted.path_nested.path)[0];
        console.log(vc, submitted.path_nested.path);
        // const result = await verifyUtils.verifyJWT({
        //   credential: vc,
        //   documentLoader,
        //   suite: SUITES,
        // });
        // if(!result.verified) {
        //   errors.push(result.error);
        // }
        // console.log(vp);
      } else if(submitted.format === 'ldp_vp') {
        const vp = normalizeVpTokenDataIntegrity(vp_token)[0];
        if(!vpVerified) {
          const result = await verifyUtils.verifyDataIntegrity({
            presentation: vp,
            documentLoader,
            suite: SUITES,
            challenge: exchange.id
          });
          if(!result.verified) {
            errors.push(result.error);
          }
          vpVerified = true;
        }
        const vc = jp.query(vp, submitted.path_nested.path)[0];
        const result = await verifyUtils.verifyCredentialDataIntegrity({
          credential: vc,
          documentLoader,
          suite: SUITES,
        });
        if(!result.verified) {
          errors.push(result.error);
        }
      } else {
        errors.push(`Format ${submitted.format} not yet supported.`);
      }
    }
  }
  if(errors.length > 0) {
    console.error('errors: ', errors);
    return {errors, verified: false};
  }
  return {errors, verified: true};
};

export default function(app) {
  app.post('/workflows/:workflowId/exchanges', createNativeExchange);

  app.get('/login', createNativeExchange);

  app.get('/workflows/:workflowId/exchanges/:exchangeId', async (req, res,
    next) => {
    const rp = req.rp;
    if(!rp || !rp.workflow || rp.workflow.type !== 'native') {
      next();
      return;
    }
    if(!req.exchange) {
      req.exchange = await getExchange(req.params.exchangeId, {
        allowExpired: true
      });
    }
    next();
  });

  app.get('/workflows/:workflowId/exchanges/:exchangeId/openid/client/' +
    'authorization/request', async (req, res) => {
    const exchange = await getExchange(req.params.exchangeId);
    if(!exchange || exchange?.workflowId !== req.params.workflowId) {
      res.status(404).send({message: 'Exchange not found'});
      return;
    }
    if(exchange.state !== 'pending') {
      res.status(400).send(`Exchange in state ${exchange.state}`);
      return;
    }
    try {
      const step = req.rp.workflow.steps[exchange.step];

      const vpr = JSON.parse(step.verifiablePresentationRequest);
      vpr.domain = `${config.domain}${
        req.originalUrl.replace('request', 'response')}`;
      vpr.challenge = exchange.id;

      const authorizationRequest = {
        ...oid4vp.fromVpr({verifiablePresentationRequest: vpr}),
        presentation_definition: {
          id: 'ea905a29-0f82-4ccd-961d-27d752d88a94',
          input_descriptors: [
            {
              id: '9157b16b-ff34-4cf7-a944-a2c41dc5a31e',
              name: 'Iso18013DriversLicenseCredential',
              schema: [
                {
                  uri: 'Iso18013DriversLicenseCredential'
                }
              ]
            }
          ]
        },
        client_id: vpr.domain,
      };

      await exchanges.updateOne({id: exchange.id}, {
        $set: {
          'variables.authorizationRequest': authorizationRequest,
          updatedAt: Date.now()
        }
      });
      const jwt = new UnsecuredJWT(authorizationRequest).encode();
      res.set('Content-Type', 'application/oauth-authz-req+jwt');
      res.send(jwt);
    } catch(e) {
      console.error(e);
      res.sendStatus(500);
    }
    return;
  });

  app.post('/workflows/:workflowId/exchanges/:exchangeId/openid/client/' +
    'authorization/response', async (req, res) => {
    const exchange = await getExchange(req.params.exchangeId);
    if(!exchange) {
      res.sendStatus(404);
      return;
    }

    if(exchange.state !== 'pending') {
      await exchanges.updateOne({
        id: exchange.id
      }, {$set: {state: 'invalid', updatedAt: Date.now()}});
      res.status(400).send(`Exchange in state ${exchange.state}`);
      return;
    }
    try {
      const submission = typeof req.body.presentation_submission === 'string' ?
        JSON.parse(req.body.presentation_submission) :
        req.body.presentation_submission;
      const {verified, errors} = await verifySubmission(
        req.body.vp_token, submission, exchange
      );
      if(verified) {
        const update = {
          $inc: {sequence: 1},
          $set: {
            updatedAt: new Date(),
            state: 'complete',
            oidc: {
              code: await createId(),
              state: exchange.oidc?.state
            },
            variables: {
              results: {
                'templated-vpr': {
                  verifiablePresentation: req.body.vp_token
                }
              }
            }
          }
        };
        await exchanges.updateOne({
          id: exchange.id,
          state: 'pending'
        }, update);
        res.sendStatus(204);
        return;
      }
      res.status(400).send({errors});
      return;
    } catch(e) {
      console.error(e);
      res.sendStatus(500);
      return;
    }
  });

  app.post('/workflows/:workflowId/exchanges/:exchangeId', async (req, res) => {
    if(req.rp.workflow.id !== req.params.workflowId) {
      res.status(400).send({message: 'Incorrect workflowId'});
      return;
    }
    try {
      const exchange = await getExchange(req.params.exchangeId);
      if(exchange) {
        const step = req.rp.workflow.steps[exchange.step];
        let vpr;
        try {
          vpr = JSON.parse(step.verifiablePresentationRequest);
        } catch(e) {
          console.error(e);
          res.sendStatus(404);
          return;
        }
        res.send({
          verifiablePresentationRequest:
            {
              ...vpr,
              challenge: exchange.challenge
            }
        });
        return;
      } else {
        res.sendStatus(404);
      }
    } catch(e) {
      console.error(e);
      res.sendStatus(500);
    }
    return;
  });
}
