'use strict';

const http = require('http');
const path = require('path');
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const testServer = require('../helpers/test-server');
const config = require('../fixtures/proxy-config/webpack.config');
const [port1, port2, port3, port4] = require('../ports-map')['proxy-option'];
const port5 = require('../ports-map')['proxy-option-hmr'];

const WebSocketServer = WebSocket.Server;
const contentBase = path.resolve(__dirname, '../fixtures/proxy-config');

const proxyOptionPathsAsProperties = {
  '/proxy1': {
    target: `http://localhost:${port1}`,
  },
  '/api/proxy2': {
    target: `http://localhost:${port2}`,
    pathRewrite: { '^/api': '' },
  },
  '/foo': {
    bypass(req) {
      if (/\.html$/.test(req.path)) {
        return '/index.html';
      }

      return null;
    },
  },
  '/proxyfalse': {
    bypass(req) {
      if (/\/proxyfalse$/.test(req.path)) {
        return false;
      }
    },
  },
};

const proxyOption = {
  context: () => true,
  target: `http://localhost:${port1}`,
};

const proxyOptionOfArray = [
  { context: '/proxy1', target: proxyOption.target },
  function proxy() {
    return {
      context: '/api/proxy2',
      target: `http://localhost:${port2}`,
      pathRewrite: { '^/api': '' },
    };
  },
];

function startProxyServers() {
  const listeners = [];
  const proxy1 = express();
  const proxy2 = express();

  proxy1.get('/proxy1', (req, res) => {
    res.send('from proxy1');
  });
  proxy1.get('/api', (req, res) => {
    res.send('api response from proxy1');
  });
  proxy2.get('/proxy2', (req, res) => {
    res.send('from proxy2');
  });

  listeners.push(proxy1.listen(port1));
  listeners.push(proxy2.listen(port2));

  // return a function to shutdown proxy servers
  return function proxy() {
    listeners.forEach((listener) => {
      listener.close();
    });
  };
}

// true when one of the raw dev server socket messages has the given type
function hasMessageOfType(messages, type) {
  return messages.some((message) => {
    try {
      return JSON.parse(message).type === type;
    } catch (error) {
      return false;
    }
  });
}

describe('proxy option', () => {
  describe('as an object of paths with properties', () => {
    let server;
    let req;
    let closeProxyServers;

    beforeAll((done) => {
      closeProxyServers = startProxyServers();
      server = testServer.start(
        config,
        {
          contentBase,
          proxy: proxyOptionPathsAsProperties,
          port: port3,
        },
        done
      );
      req = request(server.app);
    });

    afterAll((done) => {
      testServer.close(() => {
        closeProxyServers();
        done();
      });
    });

    describe('target', () => {
      it('respects a proxy option when a request path is matched', (done) => {
        req.get('/proxy1').expect(200, 'from proxy1', done);
      });
    });

    describe('pathRewrite', () => {
      it('respects a pathRewrite option', (done) => {
        req.get('/api/proxy2').expect(200, 'from proxy2', done);
      });
    });

    describe('bypass', () => {
      it('can rewrite a request path', (done) => {
        req.get('/foo/bar.html').expect(200, /Hello/, done);
      });

      it('can rewrite a request path regardless of the target defined a bypass option', (done) => {
        req.get('/baz/hoge.html').expect(200, /Hello/, done);
      });

      it('should pass through a proxy when a bypass function returns null', (done) => {
        req.get('/foo.js').expect(200, /Hey/, done);
      });

      it('should not pass through a proxy when a bypass function returns false', (done) => {
        req.get('/proxyfalse').expect(404, done);
      });
    });
  });

  describe('as an option is an object', () => {
    let server;
    let req;
    let closeProxyServers;

    beforeAll((done) => {
      closeProxyServers = startProxyServers();
      server = testServer.start(
        config,
        {
          contentBase,
          proxy: proxyOption,
          port: port3,
        },
        done
      );
      req = request(server.app);
    });

    afterAll((done) => {
      testServer.close(() => {
        closeProxyServers();
        done();
      });
    });

    it('respects a proxy option', (done) => {
      req.get('/proxy1').expect(200, 'from proxy1', done);
    });
  });

  describe('as an array', () => {
    let server;
    let req;
    let closeProxyServers;

    beforeAll((done) => {
      closeProxyServers = startProxyServers();
      server = testServer.start(
        config,
        {
          contentBase,
          proxy: proxyOptionOfArray,
          port: port3,
        },
        done
      );
      req = request(server.app);
    });

    afterAll((done) => {
      testServer.close(() => {
        closeProxyServers();
        done();
      });
    });

    it('respects a proxy option', (done) => {
      req.get('/proxy1').expect(200, 'from proxy1', done);
    });

    it('respects a proxy option of function', (done) => {
      req.get('/api/proxy2').expect(200, 'from proxy2', done);
    });
  });

  describe('should sharing a proxy option', () => {
    let server;
    let req;
    let listener;
    const proxyTarget = {
      target: `http://localhost:${port1}`,
    };

    beforeAll((done) => {
      const proxy = express();

      proxy.get('*', (proxyReq, res) => {
        res.send('from proxy');
      });

      listener = proxy.listen(port1);

      server = testServer.start(
        config,
        {
          contentBase,
          proxy: {
            '/proxy1': proxyTarget,
            '/proxy2': proxyTarget,
          },
          port: port3,
        },
        done
      );
      req = request(server.app);
    });

    afterAll((done) => {
      testServer.close(() => {
        listener.close();
        done();
      });
    });

    it('respects proxy1 option', (done) => {
      req.get('/proxy1').expect(200, 'from proxy', done);
    });

    it('respects proxy2 option', (done) => {
      req.get('/proxy2').expect(200, 'from proxy', done);
    });
  });

  describe('should handles external websocket upgrade', () => {
    let ws;
    let wsServer;
    let responseMessage;

    const transportModes = ['sockjs', 'ws'];
    transportModes.forEach((transportMode) => {
      describe(`with transportMode: ${transportMode}`, () => {
        beforeAll((done) => {
          testServer.start(
            config,
            {
              contentBase,
              transportMode,
              proxy: [
                {
                  context: '/',
                  target: `http://localhost:${port4}`,
                  ws: true,
                },
              ],
              port: port3,
            },
            done
          );

          wsServer = new WebSocketServer({ port: port4 });
          wsServer.on('connection', (server) => {
            server.on('message', (message) => {
              server.send(message);
            });
          });
        });

        beforeEach((done) => {
          ws = new WebSocket(`ws://localhost:${port3}/proxy3/socket`);
          ws.on('message', (message) => {
            responseMessage = message;
            done();
          });
          ws.on('open', () => {
            ws.send('foo');
          });
        });

        it('Should receive response', () => {
          expect(responseMessage).toEqual('foo');
        });

        afterAll((done) => {
          wsServer.close();
          testServer.close(done);
        });
      });
    });
  });

  // See https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-mx8g-39q3-5c79
  describe('dev server socket upgrade dispatching to user proxies', () => {
    const devServerOrigin = `http://localhost:${port3}`;
    const transportModes = [
      // SockJS serves its websocket transport under
      // `/<prefix>/<server>/<session>/websocket`, not the bare prefix
      {
        transportMode: 'sockjs',
        hmrPath: '/sockjs-node/000/abcd1234/websocket',
      },
      { transportMode: 'ws', hmrPath: '/sockjs-node' },
    ];

    let backend;
    let backendWss;
    let backendSockets;
    let backendUpgrades;

    // Start a backend (the user proxy target) answering HTTP requests and
    // accepting WebSocket upgrades on every path, then a dev server proxying
    // everything to it with `ws: true`.
    const setup = (devServerOptions, done) => {
      backendSockets = [];
      backendUpgrades = [];

      backend = http.createServer((req, res) => {
        res.end('from backend');
      });
      backend.on('connection', (socket) => {
        backendSockets.push(socket);
      });
      backendWss = new WebSocketServer({ server: backend });
      backendWss.on('connection', (connection, req) => {
        backendUpgrades.push({ url: req.url, headers: req.headers });
      });

      backend.listen(port5, () => {
        testServer.start(
          config,
          Object.assign(
            {
              contentBase,
              hot: true,
              proxy: [
                {
                  context: '/',
                  target: `http://localhost:${port5}`,
                  ws: true,
                },
              ],
              port: port3,
            },
            devServerOptions
          ),
          done
        );
      });
    };

    const teardown = (done) => {
      backendWss.clients.forEach((client) => {
        client.terminate();
      });
      backendWss.close();

      testServer.close(() => {
        backendSockets.forEach((socket) => {
          socket.destroy();
        });
        backend.close(() => {
          done();
        });
      });
    };

    // Open a WebSocket to `urlPath` on the dev server and report whether the
    // handshake completed (`opened`), the messages received and whether the
    // upgrade was forwarded to the proxy target (`forwarded`).
    const probe = (urlPath, options) => {
      const before = backendUpgrades.length;
      const messages = [];
      const ws = new WebSocket(`ws://localhost:${port3}${urlPath}`, options);

      ws.on('message', (data) => {
        messages.push(data.toString());
      });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(false);
        }, 2000);

        ws.on('open', () => {
          clearTimeout(timer);
          resolve(true);
        });
        ws.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      })
        .then(
          (opened) =>
            // give a (wrongly) forwarded upgrade the time to reach the backend
            new Promise((resolve) => {
              setTimeout(() => {
                resolve(opened);
              }, 300);
            })
        )
        .then((opened) => {
          ws.terminate();

          return {
            opened,
            messages,
            forwarded: backendUpgrades.length > before,
          };
        });
    };

    const get = (urlPath) =>
      new Promise((resolve, reject) => {
        http
          .get(`http://localhost:${port3}${urlPath}`, (res) => {
            let body = '';

            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, body });
            });
          })
          .on('error', reject);
      });

    transportModes.forEach(({ transportMode, hmrPath }) => {
      describe(`with transportMode: ${transportMode}`, () => {
        beforeAll((done) => {
          setup({ transportMode }, done);
        });

        afterAll(teardown);

        it('serves the dev server socket locally and does not forward it (nor its cookies) to the proxy target', () =>
          probe(hmrPath, {
            origin: devServerOrigin,
            headers: { Cookie: 'session=secret' },
          }).then(({ opened, messages, forwarded }) => {
            expect(opened).toBe(true);
            expect(forwarded).toBe(false);
            expect(
              backendUpgrades.some(
                (upgrade) => upgrade.headers.cookie === 'session=secret'
              )
            ).toBe(false);

            if (transportMode === 'ws') {
              expect(hasMessageOfType(messages, 'hot')).toBe(true);
            }
          }));

        it('forwards an upgrade outside of the dev server socket path to the proxy target', () =>
          probe('/not-hmr').then(({ opened, forwarded }) => {
            expect(opened).toBe(true);
            expect(forwarded).toBe(true);
          }));
      });

      // http-proxy-middleware subscribes itself to the server `upgrade` event
      // on the first request it sees when it is created with `ws: true`, so a
      // proxied HTTP request must not open a second way around the filter.
      describe(`with transportMode: ${transportMode}, after an HTTP request went through the proxy`, () => {
        beforeAll((done) => {
          setup({ transportMode }, done);
        });

        afterAll(teardown);

        it('still serves the dev server socket locally and does not forward it to the proxy target', () =>
          get('/proxied-http')
            .then(({ statusCode, body }) => {
              expect(statusCode).toBe(200);
              expect(body).toBe('from backend');

              return probe(hmrPath, { origin: devServerOrigin });
            })
            .then(({ opened, forwarded }) => {
              expect(opened).toBe(true);
              expect(forwarded).toBe(false);
            }));

        it('still forwards an upgrade outside of the dev server socket path to the proxy target', () =>
          probe('/not-hmr').then(({ opened, forwarded }) => {
            expect(opened).toBe(true);
            expect(forwarded).toBe(true);
          }));
      });
    });

    // The dev server socket must be protected by its own Host/Origin check, it
    // must not reach the proxy target when that check rejects it.
    describe('with an untrusted Origin header', () => {
      beforeAll((done) => {
        setup({ transportMode: 'ws' }, done);
      });

      afterAll(teardown);

      it('rejects the dev server socket and does not forward it to the proxy target', () =>
        probe('/sockjs-node', { origin: 'http://evil.example' }).then(
          ({ messages, forwarded }) => {
            expect(hasMessageOfType(messages, 'error')).toBe(true);
            expect(hasMessageOfType(messages, 'hot')).toBe(false);
            expect(forwarded).toBe(false);
          }
        ));
    });

    // `ws`-specific: the dispatch compares the path exactly the same way
    // `WebSocketServer#shouldHandle` does, so only the configured path (query
    // stripped) is the dev server socket; every other variant is forwarded.
    describe('with transportMode: ws, path matching is exact', () => {
      beforeAll((done) => {
        setup({ transportMode: 'ws' }, done);
      });

      afterAll(teardown);

      it.each([
        ['exact path', '/sockjs-node'],
        ['path with query string', '/sockjs-node?token=1'],
      ])('treats %s (%s) as the dev server socket', (label, urlPath) =>
        probe(urlPath).then(({ forwarded }) => {
          expect(forwarded).toBe(false);
        })
      );

      it.each([
        ['leading double slash', '//sockjs-node'],
        ['trailing slash', '/sockjs-node/'],
        ['uppercase', '/SOCKJS-NODE'],
        ['mixed case', '/SockJS-Node'],
        ['percent-encoded path', '/%73ockjs-node'],
      ])('forwards %s (%s) to the proxy target', (label, urlPath) =>
        probe(urlPath).then(({ forwarded }) => {
          expect(forwarded).toBe(true);
        })
      );
    });

    // The dev server socket path is read from the `sockPath` option, not a
    // hardcoded `/sockjs-node`.
    describe('with a custom sockPath', () => {
      beforeAll((done) => {
        setup({ transportMode: 'ws', sockPath: '/custom-hmr' }, done);
      });

      afterAll(teardown);

      it('treats the configured path (/custom-hmr) as the dev server socket', () =>
        probe('/custom-hmr').then(({ forwarded }) => {
          expect(forwarded).toBe(false);
        }));

      it('forwards the default path (/sockjs-node) once it is no longer the dev server socket', () =>
        probe('/sockjs-node').then(({ forwarded }) => {
          expect(forwarded).toBe(true);
        }));
    });
  });

  describe('should not log proxy errors for the dev server socket upgrade', () => {
    let backend;
    let backendSockets;
    const proxyErrors = [];
    // http-proxy-middleware's default log provider binds `console` when it is
    // loaded, so capture its errors through a custom provider
    const noop = () => {};
    const logProvider = () => {
      return {
        log: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: (message) => {
          proxyErrors.push(message);
        },
      };
    };

    beforeAll((done) => {
      backendSockets = [];
      backend = http.createServer();
      backend.on('connection', (socket) => {
        backendSockets.push(socket);
      });
      backend.on('upgrade', (req, socket) => {
        socket.destroy();
      });

      backend.listen(port5, () => {
        testServer.start(
          config,
          {
            contentBase,
            hot: true,
            transportMode: 'ws',
            proxy: [
              {
                context: '/',
                target: `http://localhost:${port5}`,
                ws: true,
                logProvider,
              },
            ],
            port: port3,
          },
          done
        );
      });
    });

    afterAll((done) => {
      testServer.close(() => {
        backendSockets.forEach((socket) => {
          socket.destroy();
        });
        backend.close(() => {
          done();
        });
      });
    });

    it('does not surface any [HPM] error when the dev server socket connects', () => {
      const messages = [];
      const ws = new WebSocket(`ws://localhost:${port3}/sockjs-node`, {
        origin: `http://localhost:${port3}`,
      });

      ws.on('message', (data) => {
        messages.push(data.toString());
      });

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for the hot message. Got: ${JSON.stringify(
                messages
              )}`
            )
          );
        }, 3000);

        ws.on('message', () => {
          if (hasMessageOfType(messages, 'hot')) {
            clearTimeout(timer);
            resolve();
          }
        });
        ws.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      })
        .then(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 300);
            })
        )
        .then(
          () => {
            ws.terminate();

            expect(
              proxyErrors.filter((message) => message.indexOf('[HPM]') !== -1)
            ).toEqual([]);
            expect(hasMessageOfType(messages, 'hot')).toBe(true);
          },
          (error) => {
            ws.terminate();

            throw error;
          }
        );
    });
  });

  describe('should supports http methods', () => {
    let server;
    let req;
    let listener;
    const proxyTarget = {
      target: `http://localhost:${port1}`,
    };

    beforeAll((done) => {
      const proxy = express();

      // Parse application/x-www-form-urlencoded
      proxy.use(bodyParser.urlencoded({ extended: false }));

      // Parse application/json
      proxy.use(bodyParser.json());

      // This forces Express to try to decode URLs, which is needed for the test
      // associated with the middleware below.
      proxy.all('*', (_req, res, next) => {
        next();
      });
      // We must define all 4 params in order for this to be detected as an
      // error handling middleware.
      // eslint-disable-next-line no-unused-vars
      proxy.use((error, proxyReq, res, next) => {
        res.status(500);
        res.send('error from proxy');
      });

      proxy.get('/get', (proxyReq, res) => {
        res.send('GET method from proxy');
      });

      proxy.head('/head', (proxyReq, res) => {
        res.send('HEAD method from proxy');
      });

      proxy.post('/post-x-www-form-urlencoded', (proxyReq, res) => {
        const id = proxyReq.body.id;

        res.status(200).send(`POST method from proxy (id: ${id})`);
      });

      proxy.post('/post-application-json', (proxyReq, res) => {
        const id = proxyReq.body.id;

        res.status(200).send({ answer: `POST method from proxy (id: ${id})` });
      });

      proxy.delete('/delete', (proxyReq, res) => {
        res.send('DELETE method from proxy');
      });

      listener = proxy.listen(port1);

      server = testServer.start(
        config,
        {
          contentBase,
          proxy: {
            '**': proxyTarget,
          },
        },
        done
      );
      req = request(server.app);
    });

    afterAll((done) => {
      testServer.close(() => {
        listener.close();
        done();
      });
    });

    it('errors', (done) => {
      req.get('/%').expect(500, 'error from proxy', done);
    });

    it('GET method', (done) => {
      req.get('/get').expect(200, 'GET method from proxy', done);
    });

    it('HEAD method', (done) => {
      req.head('/head').expect(200, done);
    });

    it('POST method (application/x-www-form-urlencoded)', (done) => {
      req
        .post('/post-x-www-form-urlencoded')
        .send('id=1')
        .expect(200, 'POST method from proxy (id: 1)', done);
    });

    it('POST method (application/json)', (done) => {
      req
        .post('/post-application-json')
        .send({ id: '1' })
        .set('Accept', 'application/json')
        .expect('Content-Type', /json/)
        .expect(
          200,
          JSON.stringify({ answer: 'POST method from proxy (id: 1)' }),
          done
        );
    });

    it('DELETE method', (done) => {
      req.delete('/delete').expect(200, 'DELETE method from proxy', done);
    });
  });
});
