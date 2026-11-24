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
