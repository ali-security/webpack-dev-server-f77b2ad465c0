'use strict';

/* eslint-disable
  no-shadow,
  array-bracket-spacing
*/

const webpack = require('webpack');
const Server = require('../lib/Server');
const schema = require('../lib/options.json');
const config = require('./fixtures/simple-config/webpack.config');

const messages = schema.errorMessage.properties;

describe('Validation', () => {
  let compiler;
  let server;

  beforeAll(() => {
    compiler = webpack(config);
  });

  describe('validation', () => {
    afterEach((done) => {
      // `server` is undefined if a test is good
      if (server) {
        server.close(() => {
          done();
        });
      } else {
        done();
      }
    });

    const tests = [
      {
        name: 'invalid `hot` configuration',
        config: { hot: 'false' },
        message: `options.hot ${messages.hot}`,
      },
      {
        name: 'invalid `logLevel` configuration',
        config: { logLevel: 1 },
        message: `options.logLevel ${messages.logLevel.split('\n\n')[0]}`,
      },
      {
        name: 'invalid `writeToDisk` configuration',
        config: { writeToDisk: 1 },
        message: `options.writeToDisk ${messages.writeToDisk}`,
      },
      {
        name: 'invalid `overlay` configuration',
        config: { overlay: { errors: 1 } },
        message: `options.overlay ${messages.overlay}`,
      },
      {
        name: 'invalid `contentBase` configuration',
        config: { contentBase: [0] },
        message: `options.contentBase ${messages.contentBase}`,
      },
      {
        name: 'no additional properties',
        config: { additional: true },
        message: 'options should NOT have additional properties',
      },
    ];

    tests.forEach((test) => {
      it(`should fail validation for ${test.name}`, () => {
        try {
          server = new Server(compiler, test.config);
        } catch (err) {
          if (err.name !== 'ValidationError') {
            throw err;
          }

          const [title, message] = err.message.split('\n\n');

          expect(title).toEqual('webpack Dev Server Invalid Options');
          expect(message.trim()).toEqual(test.message);

          return;
        }

        throw new Error("Validation didn't fail");
      });
    });
  });

  describe('filename', () => {
    afterEach((done) => {
      server.close(() => {
        done();
      });
    });

    it('should allow filename to be a function', () => {
      try {
        server = new Server(compiler, { filename: () => {} });
      } catch (err) {
        if (err === 'ValidationError') {
          throw err;
        }

        throw new Error("Validation failed and it shouldn't");
      }
    });
  });

  describe('checkHost', () => {
    afterEach((done) => {
      server.close(() => {
        done();
      });
    });

    it('should always allow any host if options.disableHostCheck is set', () => {
      const options = {
        public: 'test.host:80',
        disableHostCheck: true,
      };

      const headers = {
        host: 'bad.host',
      };

      server = new Server(compiler, options);

      if (!server.checkHost(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should allow any valid options.public when host is localhost', () => {
      const options = {
        public: 'test.host:80',
      };
      const headers = {
        host: 'localhost',
      };
      server = new Server(compiler, options);
      if (!server.checkHost(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should allow any valid options.public when host is 127.0.0.1', () => {
      const options = {
        public: 'test.host:80',
      };

      const headers = {
        host: '127.0.0.1',
      };

      server = new Server(compiler, options);

      if (!server.checkHost(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should allow access for every requests using an IP', () => {
      const options = {};

      const tests = [
        '192.168.1.123',
        '192.168.1.2:8080',
        '[::1]',
        '[::1]:8080',
        '[ad42::1de2:54c2:c2fa:1234]',
        '[ad42::1de2:54c2:c2fa:1234]:8080',
      ];

      server = new Server(compiler, options);

      tests.forEach((test) => {
        const headers = { host: test };

        if (!server.checkHost(headers)) {
          throw new Error("Validation didn't pass");
        }
      });
    });

    it("should not allow hostnames that don't match options.public", () => {
      const options = {
        public: 'test.host:80',
      };

      const headers = {
        host: 'test.hostname:80',
      };

      server = new Server(compiler, options);

      if (server.checkHost(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should allow urls with scheme for checking origin', () => {
      const options = {
        public: 'test.host:80',
      };
      const headers = {
        origin: 'https://test.host',
      };
      server = new Server(compiler, options);
      if (!server.checkOrigin(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should not allow an IP address in the origin header when it does not match the host header', () => {
      const options = {};

      const tests = [
        { host: 'localhost:8080', origin: 'http://192.168.1.1' },
        { host: 'localhost:8080', origin: 'http://192.168.1.1/' },
        { host: 'localhost:8080', origin: 'https://192.168.1.1:8080' },
        { host: '127.0.0.1:8080', origin: 'http://192.168.1.1:8080' },
        { host: '192.168.1.2:8080', origin: 'http://192.168.1.1:8080' },
        {
          host: 'localhost:8080',
          origin: 'http://[ad42::1de2:54c2:c2fa:1234]:8080',
        },
        { host: '[::1]:8080', origin: 'http://[ad42::1de2:54c2:c2fa:1234]' },
      ];

      server = new Server(compiler, options);

      tests.forEach((headers) => {
        // the Host header itself is still valid
        if (!server.checkHost(headers)) {
          throw new Error("Validation didn't pass");
        }

        if (server.isSameOrigin(headers)) {
          throw new Error("Validation didn't fail");
        }

        if (server.checkOrigin(headers)) {
          throw new Error("Validation didn't fail");
        }

        if (server.checkHeaders(headers, 'origin')) {
          throw new Error("Validation didn't fail");
        }
      });
    });

    it('should not allow an IP address in the origin header when there is no host header', () => {
      const options = {};

      const headers = {
        origin: 'http://192.168.1.1',
      };

      server = new Server(compiler, options);

      if (server.checkOrigin(headers)) {
        throw new Error("Validation didn't fail");
      }
    });

    it('should allow an IP address in the origin header when it matches the host header', () => {
      const options = {};

      const tests = [
        { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080' },
        { host: '192.168.1.123', origin: 'http://192.168.1.123' },
        { host: '192.168.1.123:8080', origin: 'https://192.168.1.123:8080' },
        { host: '[::1]:8080', origin: 'http://[::1]:8080' },
        {
          host: '[ad42::1de2:54c2:c2fa:1234]:8080',
          origin: 'http://[ad42::1de2:54c2:c2fa:1234]:8080',
        },
      ];

      server = new Server(compiler, options);

      tests.forEach((headers) => {
        if (!server.isSameOrigin(headers)) {
          throw new Error("Validation didn't pass");
        }

        if (!server.checkHost(headers) || !server.checkOrigin(headers)) {
          throw new Error("Validation didn't pass");
        }
      });
    });

    it('should allow an IP address in the origin header if options.disableHostCheck is set', () => {
      const options = {
        disableHostCheck: true,
      };

      const headers = {
        host: 'localhost:8080',
        origin: 'http://192.168.1.1',
      };

      server = new Server(compiler, options);

      if (!server.checkHost(headers) || !server.checkOrigin(headers)) {
        throw new Error("Validation didn't pass");
      }
    });

    it('should allow an IP address in the origin header if it is in allowedHosts', () => {
      const options = {
        allowedHosts: ['192.168.1.1'],
      };

      const headers = {
        host: 'localhost:8080',
        origin: 'http://192.168.1.1',
      };

      server = new Server(compiler, options);

      if (!server.checkHost(headers) || !server.checkOrigin(headers)) {
        throw new Error("Validation didn't pass");
      }
    });

    it('should still allow a localhost origin header for an IP address host header', () => {
      const options = {};

      const headers = {
        host: '127.0.0.1:8080',
        origin: 'http://localhost:8080',
      };

      server = new Server(compiler, options);

      if (!server.checkHost(headers) || !server.checkOrigin(headers)) {
        throw new Error("Validation didn't pass");
      }
    });

    describe('allowedHosts', () => {
      it('should allow hosts in allowedHosts', () => {
        const tests = ['test.host', 'test2.host', 'test3.host'];
        const options = { allowedHosts: tests };
        server = new Server(compiler, options);
        tests.forEach((test) => {
          const headers = { host: test };
          if (!server.checkHost(headers)) {
            throw new Error("Validation didn't fail");
          }
        });
      });

      it('should allow hosts that pass a wildcard in allowedHosts', () => {
        const options = { allowedHosts: ['.example.com'] };
        server = new Server(compiler, options);
        const tests = [
          'www.example.com',
          'subdomain.example.com',
          'example.com',
          'subsubcomain.subdomain.example.com',
          'example.com:80',
          'subdomain.example.com:80',
        ];
        tests.forEach((test) => {
          const headers = { host: test };
          if (!server.checkHost(headers)) {
            throw new Error("Validation didn't fail");
          }
        });
      });
    });

    // @see https://nvd.nist.gov/vuln/detail/CVE-2026-14631
    describe('malformed Host/Origin headers', () => {
      const url = require('url');
      const parse = url.parse;

      // malformed Host headers (invalid IPv6 literals)
      const malformedHosts = ['[::1', '[::1:8080', '[ad42::1de2:54c2'];
      // malformed Origin headers (invalid IPv6 literals)
      const malformedOrigins = [
        'http://[::1/',
        'http://[::1',
        'https://[ad42::1de2:54c2:8080',
      ];

      // Recent Node.js versions throw from `url.parse()` on these malformed
      // values while older ones parse them leniently, so the checks are also
      // run against a `url.parse()` that throws like the recent ones do.
      const mockThrowingUrlParse = () => {
        const malformed = []
          .concat(malformedHosts.map((host) => `//${host}`))
          .concat(malformedOrigins);

        jest.spyOn(url, 'parse').mockImplementation((value, ...args) => {
          if (malformed.indexOf(value) !== -1) {
            const error = new TypeError(`Invalid URL: ${value}`);

            error.code = 'ERR_INVALID_URL';

            throw error;
          }

          return parse.call(url, value, ...args);
        });
      };

      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('should not throw on a malformed Host header', () => {
        server = new Server(compiler, {});

        malformedHosts.forEach((host) => {
          const headers = { host, origin: 'http://localhost:8080' };

          expect(() => server.checkHost(headers)).not.toThrow();
          expect(() =>
            server.checkHeaders(headers, 'host', true, false)
          ).not.toThrow();
          expect(server.isSameOrigin(headers)).toBe(false);
          expect(server.isSameOriginRequest({ headers })).toBe(false);
        });
      });

      it('should reject a malformed Host header when url.parse() throws on it', () => {
        server = new Server(compiler, { allowedHosts: ['.example.com'] });

        mockThrowingUrlParse();

        malformedHosts.forEach((host) => {
          const headers = { host, origin: 'http://localhost:8080' };

          expect(server.checkHost(headers)).toBe(false);
          expect(server.checkHeaders(headers, 'host', true, false)).toBe(false);
          expect(server.isSameOrigin(headers)).toBe(false);
          expect(server.isSameOriginRequest({ headers })).toBe(false);
        });

        expect(url.parse).toHaveBeenCalledWith('//[::1', false, true);
      });

      it('should reject a malformed Origin header', () => {
        server = new Server(compiler, { allowedHosts: ['.example.com'] });

        malformedOrigins.forEach((origin) => {
          const headers = { host: 'localhost:8080', origin };

          expect(server.checkHost(headers)).toBe(true);
          expect(server.isSameOrigin(headers)).toBe(false);
          expect(server.checkOrigin(headers)).toBe(false);
          expect(server.checkHeaders(headers, 'origin')).toBe(false);
          expect(server.isSameOriginRequest({ headers })).toBe(false);
        });
      });

      it('should reject a malformed Origin header when url.parse() throws on it', () => {
        server = new Server(compiler, { allowedHosts: ['.example.com'] });

        mockThrowingUrlParse();

        malformedOrigins.forEach((origin) => {
          const headers = { host: 'localhost:8080', origin };

          expect(server.checkHost(headers)).toBe(true);
          expect(server.isSameOrigin(headers)).toBe(false);
          expect(server.checkOrigin(headers)).toBe(false);
          expect(server.checkHeaders(headers, 'origin')).toBe(false);
          expect(server.isSameOriginRequest({ headers })).toBe(false);
        });

        expect(url.parse).toHaveBeenCalledWith('http://[::1/', false, true);
      });

      it('should reject Host and Origin headers without a hostname', () => {
        // a wildcard in allowedHosts used to dereference the missing hostname
        server = new Server(compiler, { allowedHosts: ['.example.com'] });

        const headers = {
          host: 'localhost:8080',
          origin: 'javascript://evil.example.com',
        };

        expect(server.isSameOrigin(headers)).toBe(false);
        expect(server.checkOrigin(headers)).toBe(false);
        expect(server.checkHeaders(headers, 'origin')).toBe(false);
        expect(server.isSameOriginRequest({ headers })).toBe(false);
        expect(
          server.checkHost({ host: 'javascript://evil.example.com' })
        ).toBe(false);
        expect(
          server.checkHeaders(
            { host: 'javascript://evil.example.com' },
            'host',
            true,
            false
          )
        ).toBe(false);
      });

      it('should still allow well-formed headers', () => {
        server = new Server(compiler, { allowedHosts: ['.example.com'] });

        mockThrowingUrlParse();

        const headers = {
          host: 'www.example.com:8080',
          origin: 'http://www.example.com:8080',
        };

        expect(server.checkHost(headers)).toBe(true);
        expect(server.isSameOrigin(headers)).toBe(true);
        expect(server.checkOrigin(headers)).toBe(true);
        expect(server.isSameOriginRequest({ headers })).toBe(true);
        expect(server.checkHost({ host: '[::1]:8080' })).toBe(true);
        expect(
          server.checkOrigin({
            host: '[::1]:8080',
            origin: 'http://[::1]:8080',
          })
        ).toBe(true);
      });
    });
  });
});
