'use strict';

const request = require('supertest');
const testServer = require('../helpers/test-server');
const config = require('../fixtures/simple-config/webpack.config');
const port = require('../ports-map')['cross-origin-header-check'];

// A classic <script> tag on a malicious site sends a cross-site "no-cors"
// request, which is not subject to the same origin policy, so the bundle
// (and its source code) could be read by the attacker.
// See https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v
function crossSiteNoCors(req, path, host) {
  return req
    .get(path)
    .set('Host', host)
    .set('Sec-Fetch-Mode', 'no-cors')
    .set('Sec-Fetch-Site', 'cross-site')
    .set('Sec-Fetch-Dest', 'script');
}

describe('cross-origin header check', () => {
  let server;
  let req;

  describe('with default options', () => {
    beforeAll((done) => {
      server = testServer.start(config, { port }, done);
      req = request(server.app);
    });

    afterAll(testServer.close);

    it('should return 403 for cross-site no-cors requests of the bundle', () => {
      return crossSiteNoCors(req, '/main.js', `localhost:${port}`)
        .expect(403)
        .then((res) => {
          expect(res.text).toBe('Cross-Origin request blocked');
        });
    });

    it('should return 403 for cross-site no-cors requests with an IP address host', () => {
      return crossSiteNoCors(req, '/main.js', `127.0.0.1:${port}`)
        .expect(403)
        .then((res) => {
          expect(res.text).toBe('Cross-Origin request blocked');
        });
    });

    it('should return 403 for cross-site no-cors requests of the client bundles', () => {
      return crossSiteNoCors(req, '/webpack-dev-server.js', `localhost:${port}`)
        .expect(403)
        .then(() =>
          crossSiteNoCors(
            req,
            '/__webpack_dev_server__/live.bundle.js',
            `localhost:${port}`
          ).expect(403)
        );
    });

    it('should return 403 for cross-site no-cors requests with other methods', () => {
      return req
        .post('/main.js')
        .set('Host', `localhost:${port}`)
        .set('Sec-Fetch-Mode', 'no-cors')
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
    });

    it('should return 200 for same-origin no-cors requests', () => {
      return req
        .get('/main.js')
        .set('Host', `localhost:${port}`)
        .set('Sec-Fetch-Mode', 'no-cors')
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(200);
    });

    it('should return 200 for same-site no-cors requests', () => {
      return req
        .get('/main.js')
        .set('Host', `localhost:${port}`)
        .set('Sec-Fetch-Mode', 'no-cors')
        .set('Sec-Fetch-Site', 'same-site')
        .expect(200);
    });

    it('should return 200 for cross-site cors requests', () => {
      return req
        .get('/main.js')
        .set('Host', `localhost:${port}`)
        .set('Sec-Fetch-Mode', 'cors')
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(200);
    });

    it('should return 200 for requests without fetch metadata headers', () => {
      return req
        .get('/main.js')
        .set('Host', `localhost:${port}`)
        .expect(200);
    });
  });

  describe('with the "allowedHosts" option', () => {
    beforeAll((done) => {
      server = testServer.start(
        config,
        { port, allowedHosts: ['my.example.com', '.example.org'] },
        done
      );
      req = request(server.app);
    });

    afterAll(testServer.close);

    it('should return 200 for cross-site no-cors requests to an allowed host', () => {
      return crossSiteNoCors(req, '/main.js', 'my.example.com').expect(200);
    });

    it('should return 200 for cross-site no-cors requests to an allowed subdomain', () => {
      return crossSiteNoCors(req, '/main.js', 'www.example.org').expect(200);
    });

    it('should return 403 for cross-site no-cors requests to a host that is not explicitly allowed', () => {
      return crossSiteNoCors(req, '/main.js', `localhost:${port}`).expect(403);
    });
  });

  describe('with the "public" option', () => {
    beforeAll((done) => {
      server = testServer.start(
        config,
        { port, public: 'my.example.com:8080' },
        done
      );
      req = request(server.app);
    });

    afterAll(testServer.close);

    it('should return 200 for cross-site no-cors requests to the public host', () => {
      return crossSiteNoCors(req, '/main.js', 'my.example.com:8080').expect(
        200
      );
    });

    it('should return 403 for cross-site no-cors requests to another host', () => {
      return crossSiteNoCors(req, '/main.js', `localhost:${port}`).expect(403);
    });
  });

  describe('with the "disableHostCheck" option', () => {
    beforeAll((done) => {
      server = testServer.start(config, { port, disableHostCheck: true }, done);
      req = request(server.app);
    });

    afterAll(testServer.close);

    it('should return 200 for cross-site no-cors requests', () => {
      return crossSiteNoCors(req, '/main.js', `localhost:${port}`).expect(200);
    });
  });
});
