'use strict';

const http = require('http');
const testServer = require('../helpers/test-server');
const config = require('../fixtures/client-config/webpack.config');
const runBrowser = require('../helpers/run-browser');
const [port1, port2] = require('../ports-map')['cross-origin-request'];

describe('cross-origin requests', () => {
  const devServerPort = port1;
  const htmlServerPort = port2;
  const htmlServerHost = '127.0.0.1';

  // Loads a page from a separate (cross-site) origin containing `scriptTag`
  // and resolves with the HTTP status the dev server answered the script with.
  function getScriptTagResponseStatus(devServerOptions, scriptTag) {
    let htmlServer;
    let browser;

    const cleanup = () => {
      return Promise.resolve()
        .then(() => (browser ? browser.close() : null))
        .then(
          () =>
            new Promise((resolve) => {
              if (htmlServer) {
                htmlServer.close(() => resolve());
              } else {
                resolve();
              }
            })
        )
        .then(() => new Promise((resolve) => testServer.close(resolve)));
    };

    return new Promise((resolve) => {
      testServer.startAwaitingCompilation(
        config,
        Object.assign({ port: devServerPort }, devServerOptions),
        resolve
      );
    })
      .then(
        () =>
          new Promise((resolve) => {
            // Start a separate server for serving the HTML file
            htmlServer = http.createServer((req, res) => {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head>
                    ${scriptTag}
                  </head>
                  <body></body>
                </html>
              `);
            });
            htmlServer.listen(htmlServerPort, htmlServerHost, () => resolve());
          })
      )
      .then(() => runBrowser())
      .then((result) => {
        browser = result.browser;

        const { page } = result;
        const scriptTagRequest = page.waitForResponse(
          `http://localhost:${devServerPort}/main.js`
        );

        return page
          .goto(`http://${htmlServerHost}:${htmlServerPort}`)
          .then(() => scriptTagRequest);
      })
      .then((response) => response.status())
      .then(
        (status) => cleanup().then(() => status),
        (error) =>
          cleanup().then(() => {
            throw error;
          })
      );
  }

  it('should return 403 for cross-origin no-cors non-module script tag requests', () => {
    return getScriptTagResponseStatus(
      {},
      `<script src="http://localhost:${devServerPort}/main.js"></script>`
    ).then((status) => {
      expect(status).toBe(403);
    });
  });

  it('should return 200 for cross-origin cors non-module script tag requests', () => {
    return getScriptTagResponseStatus(
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      },
      `<script src="http://localhost:${devServerPort}/main.js" crossorigin></script>`
    ).then((status) => {
      expect(status).toBe(200);
    });
  });

  it("should return 200 for cross-origin no-cors non-module script tag requests with the 'disableHostCheck' option", () => {
    return getScriptTagResponseStatus(
      {
        disableHostCheck: true,
      },
      `<script src="http://localhost:${devServerPort}/main.js"></script>`
    ).then((status) => {
      expect(status).toBe(200);
    });
  });

  it("should return 200 for cross-origin no-cors non-module script tag requests with the 'allowedHosts' option and the 'localhost' value", () => {
    return getScriptTagResponseStatus(
      {
        allowedHosts: ['localhost'],
      },
      `<script src="http://localhost:${devServerPort}/main.js"></script>`
    ).then((status) => {
      expect(status).toBe(200);
    });
  });
});

// @see https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-79cf-xcqc-c78w
describe('cross-origin resource policy header', () => {
  const devServerPort = port1;

  function startServer(devServerOptions) {
    return new Promise((resolve, reject) => {
      testServer.start(
        config,
        Object.assign({ port: devServerPort }, devServerOptions),
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  function request(path, headers) {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: 'localhost',
          port: devServerPort,
          path,
          headers: headers || {},
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        }
      );
      req.on('error', reject);
    });
  }

  afterEach((done) => {
    testServer.close(done);
  });

  it('should set Cross-Origin-Resource-Policy: same-origin by default', () => {
    return startServer({})
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBe(
          'same-origin'
        );
      });
  });

  // Over plain HTTP on a non-localhost origin (e.g. a LAN IP), browsers omit
  // the Sec-Fetch-* headers, so the 403 check is bypassed and a <script> tag
  // on a malicious site can load the bundle; CORP makes the browser block it.
  it('should set Cross-Origin-Resource-Policy: same-origin for cross-site requests without fetch metadata headers', () => {
    const headers = {
      Host: `192.168.1.10:${devServerPort}`,
      Referer: 'http://attacker.example.com/',
    };

    return startServer({})
      .then(() =>
        Promise.all([
          request('/main.js', headers),
          request('/webpack-dev-server.js', headers),
          request('/__webpack_dev_server__/live.bundle.js', headers),
        ])
      )
      .then((responses) => {
        responses.forEach((res) => {
          expect(res.status).toBe(200);
          expect(res.headers['cross-origin-resource-policy']).toBe(
            'same-origin'
          );
        });
      });
  });

  it("should NOT set CORP header with the 'disableHostCheck' option", () => {
    return startServer({ disableHostCheck: true })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
      });
  });

  it('should NOT set CORP header when user configures wildcard CORS', () => {
    return startServer({
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
      });
  });

  it('should set CORP header when user configures a specific-origin Access-Control-Allow-Origin (no-cors embedding is not governed by CORS)', () => {
    return startServer({
      headers: { 'Access-Control-Allow-Origin': 'http://foo.example.com' },
    })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBe(
          'same-origin'
        );
      });
  });

  it('should set CORP header when user configures Access-Control-Allow-Origin as an array with a specific origin', () => {
    return startServer({
      headers: { 'Access-Control-Allow-Origin': ['http://foo.example.com'] },
    })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBe(
          'same-origin'
        );
      });
  });

  it('should NOT set CORP header when user configures wildcard Access-Control-Allow-Origin as an array', () => {
    return startServer({
      headers: { 'access-control-allow-origin': ['*'] },
    })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
      });
  });

  it('should NOT set CORP header when host is in allowedHosts', () => {
    return startServer({ allowedHosts: ['localhost'] })
      .then(() => request('/main.js'))
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
      });
  });
});
