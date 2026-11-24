'use strict';

const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const testServer = require('../helpers/test-server');
const config = require('../fixtures/proxy-config/webpack.config');
const [devServerPort, backendPort] = require('../ports-map')[
  'proxy-web-socket-origin'
];

const WebSocketServer = WebSocket.Server;
const devServerOrigin = `http://localhost:${devServerPort}`;
const target = `http://127.0.0.1:${backendPort}`;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// See https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-cfqc-fj3v-j925
describe('proxied WebSocket upgrade origin validation', () => {
  let backend;
  let backendWss;
  let backendSockets;
  let backendConnections;
  let backendUpgradePaths;

  // Start a stand-in for a service the developer proxies over WebSocket, then
  // a dev server proxying `/api` to it.
  const setup = (proxy, devServerOptions) =>
    new Promise((resolve) => {
      backendSockets = [];
      backendConnections = 0;
      backendUpgradePaths = [];

      backend = http.createServer((req, res) => {
        res.end('backend response');
      });
      backend.on('connection', (socket) => {
        backendSockets.push(socket);
      });
      backendWss = new WebSocketServer({ server: backend });
      backendWss.on('connection', (client, req) => {
        backendConnections += 1;
        backendUpgradePaths.push(req.url);
        client.send('INTERNAL-SERVICE-SECRET');
      });

      backend.listen(backendPort, '127.0.0.1', resolve);
    }).then(
      () =>
        new Promise((resolve) => {
          // the test server is a singleton, make sure no previous one is left
          testServer.close(() => {
            testServer.start(
              config,
              Object.assign(
                {
                  port: devServerPort,
                  host: 'localhost',
                  proxy: [proxy],
                },
                devServerOptions
              ),
              resolve
            );
          });
        })
    );

  const teardown = () =>
    new Promise((resolve) => {
      testServer.close(resolve);
    }).then(
      () =>
        new Promise((resolve) => {
          backendWss.clients.forEach((client) => {
            client.terminate();
          });
          backendWss.close();
          backendSockets.forEach((socket) => {
            socket.destroy();
          });
          backend.close(() => {
            resolve();
          });
        })
    );

  // Send a raw WebSocket upgrade request for `/api/socket` to the dev server
  // and report whether it was upgraded and the response status.
  const upgrade = (origin, headers) =>
    new Promise((resolve) => {
      let settled = false;
      let timer;

      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const req = http.request({
        host: 'localhost',
        port: devServerPort,
        path: '/api/socket',
        headers: Object.assign(
          {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': '13',
          },
          typeof origin === 'string' ? { Origin: origin } : {},
          headers
        ),
      });

      timer = setTimeout(() => {
        req.abort();
        finish({ upgraded: false });
      }, 8000);

      req.on('upgrade', (res, socket) => {
        socket.destroy();
        finish({ upgraded: true, status: res.statusCode });
      });
      req.on('response', (res) => {
        res.resume();
        finish({ upgraded: false, status: res.statusCode });
      });
      req.on('error', () => {
        finish({ upgraded: false });
      });
      req.end();
    });

  const proxyHttpRequest = () =>
    request(devServerOrigin)
      .get('/api/hello')
      .expect(200, 'backend response');

  describe('with a proxy config', () => {
    beforeAll(() =>
      setup({
        context: ['/api'],
        target,
        ws: true,
        logLevel: 'warn',
      })
    );

    afterAll(teardown);

    beforeEach(() => {
      backendConnections = 0;
    });

    it('should reject a cross-origin proxied WebSocket upgrade', () =>
      upgrade('http://evil.example.com')
        .then((result) => {
          expect(result.upgraded).toBe(false);
          expect(result.status).toBe(403);

          return delay(100);
        })
        .then(() => {
          expect(backendConnections).toBe(0);
        }));

    it('should allow a same-origin proxied WebSocket upgrade', () =>
      upgrade(devServerOrigin).then((result) => {
        expect(result.upgraded).toBe(true);
        expect(result.status).toBe(101);
        expect(backendConnections).toBe(1);
      }));

    it('should reject an upgrade with an invalid Host header', () =>
      upgrade(devServerOrigin, { Host: 'evil.example.com' }).then((result) => {
        expect(result.status).toBe(403);
        expect(backendConnections).toBe(0);
      }));

    it('should reject an upgrade without an Origin header', () =>
      upgrade().then((result) => {
        expect(result.status).toBe(403);
        expect(backendConnections).toBe(0);
      }));

    it('should reject an upgrade from an IP address origin of another host', () =>
      upgrade('http://192.168.0.10:3000').then((result) => {
        expect(result.status).toBe(403);
        expect(backendConnections).toBe(0);
      }));

    it('should reject an upgrade whose Origin is not the same origin as its Host', () =>
      upgrade(devServerOrigin, { Host: `127.0.0.1:${devServerPort}` }).then(
        (result) => {
          expect(result.status).toBe(403);
          expect(backendConnections).toBe(0);
        }
      ));
  });

  describe('after an HTTP request went through the proxy', () => {
    beforeAll(() =>
      setup({
        context: ['/api'],
        target,
        ws: true,
        logLevel: 'warn',
      })
    );

    afterAll(teardown);

    beforeEach(() => {
      backendConnections = 0;
    });

    it('should not forward a rejected upgrade after an HTTP proxy request', () =>
      proxyHttpRequest()
        .then(() => upgrade('http://evil.example.com'))
        .then((result) => {
          expect(result.upgraded).toBe(false);
          expect(result.status).toBe(403);

          // A separate upgrade listener could still contact the backend after
          // the client receives the rejection, so allow it time to happen.
          return delay(100);
        })
        .then(() => {
          expect(backendConnections).toBe(0);
        }));

    it('should allow a same-origin upgrade after an HTTP proxy request', () =>
      proxyHttpRequest()
        .then(() => upgrade(devServerOrigin))
        .then((result) => {
          expect(result.upgraded).toBe(true);
          expect(result.status).toBe(101);
          expect(backendConnections).toBe(1);
        }));
  });

  describe('with a proxy config callback', () => {
    let proxyConfig;

    beforeAll(() => {
      proxyConfig = {
        context: ['/api'],
        target,
        ws: false,
        logLevel: 'warn',
        pathRewrite: { '^/api': '/initial' },
      };

      return setup(() => Object.assign({}, proxyConfig));
    });

    afterAll(teardown);

    it('should validate upgrades using the current proxy callback configuration', () =>
      proxyHttpRequest()
        .then(() => {
          proxyConfig = Object.assign({}, proxyConfig, {
            ws: true,
            pathRewrite: { '^/api': '/updated' },
          });

          return proxyHttpRequest();
        })
        .then(() => upgrade('http://evil.example.com'))
        .then((rejected) => {
          expect(rejected.status).toBe(403);

          return delay(100);
        })
        .then(() => {
          expect(backendConnections).toBe(0);

          return upgrade(devServerOrigin);
        })
        .then((allowed) => {
          expect(allowed.status).toBe(101);
          expect(backendConnections).toBe(1);
          expect(backendUpgradePaths).toEqual(['/updated/socket']);
        }));
  });

  describe('with allowedHosts', () => {
    beforeAll(() =>
      setup(
        {
          context: ['/api'],
          target,
          ws: true,
          logLevel: 'warn',
        },
        { allowedHosts: ['trusted.example.com'] }
      )
    );

    afterAll(teardown);

    beforeEach(() => {
      backendConnections = 0;
    });

    it('should allow an upgrade from an allowed origin', () =>
      upgrade('http://trusted.example.com').then((result) => {
        expect(result.upgraded).toBe(true);
        expect(result.status).toBe(101);
        expect(backendConnections).toBe(1);
      }));

    it('should still reject a cross-origin upgrade', () =>
      upgrade('http://evil.example.com').then((result) => {
        expect(result.status).toBe(403);
        expect(backendConnections).toBe(0);
      }));
  });

  describe('with disableHostCheck', () => {
    beforeAll(() =>
      setup(
        {
          context: ['/api'],
          target,
          ws: true,
          logLevel: 'warn',
        },
        { disableHostCheck: true }
      )
    );

    afterAll(teardown);

    it('should allow a cross-origin upgrade when the user opted out of the check', () =>
      upgrade('http://evil.example.com').then((result) => {
        expect(result.upgraded).toBe(true);
        expect(result.status).toBe(101);
        expect(backendConnections).toBe(1);
      }));
  });
});
