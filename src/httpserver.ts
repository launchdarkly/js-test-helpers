import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as selfsigned from "selfsigned";
import * as url from "url";

import { AsyncQueue, readAllStream } from "./async";

// This file provides a simple interface for using an embedded HTTP or HTTPS server to handle
// requests in an end-to-end integration test. The implementation is based on Node's built-in
// server functionality, but the Node APIs are not exposed directly so test code can just use
// our abstraction.

// The original design was based on helper code in
// https://github.com/EventSource/eventsource/blob/master/test/eventsource_test.js

/**
 * An arbitrary set of header names and values.
 */
export interface TestHttpHeaders {
  [key: string]: string;
}

/**
 * Properties of an HTTP request recorded by [[TestHttpServer]].
 */
export interface TestHttpRequest {
  /**
   * The HTTP method, lowercased ("get").
   */
  method: string;

  /**
   * The URL path ("/index.html").
   */
  path: string;

  /**
   * The request headers.
   */
  headers: TestHttpHeaders;

  /**
   * The request body, if any. Requests with a streamed body will be read in full before being handled.
   */
  body?: string;
}

/**
 * A function that provides a response for [[TestHttpServer]]. May be synchronous or async.
 */
export type TestHttpHandler =
  ((req: TestHttpRequest, res: http.ServerResponse) => void) |
  ((req: TestHttpRequest, res: http.ServerResponse) => Promise<void>);

/**
 * A wrapper for Node's HTTP server API that provides convenient semantics for test code.
 *
 * Do not use this for actual server applications, since its request matching logic is inefficient
 * and its request queue can grow without limit.
 *
 * ```
 *     const server = await TestHttpServer.start();
 *
 *     // simulate an endpoint
 *     server.forMethodAndPath('get', '/thing',
 *         TestHttpHandlers.respond(200, {}, 'hello'));
 *
 *     // return 500 error for non-matching requests
 *     server.byDefault(TestHttpHandlers.respond(500));
 *
 *     // ... do some HTTP requests to server.url
 *
 *     const request = await server.nextRequest(); // retrieve the first request
 *     server.close();
 * ```
 */
export class TestHttpServer {
  /**
   * Creates and starts a [[TestHttpServer]] instance.
   *
   * Note: in a non-TypeScript project that uses a transpiler, you may not be able to access this
   * static method; if so, use the same method in [[TestHttpServers]] instead.
   *
   * @param options
   *   Any desired [[http.ServerOptions]].
   */
  public static async start(options?: http.ServerOptions): Promise<TestHttpServer> {
    const server = new TestHttpServer(false, false, options);
    await server.startInstance();
    return server;
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that uses HTTPS, with a self-signed certificate.
   *
   * Note: in a non-TypeScript project that uses a transpiler, you may not be able to access this
   * static method; if so, use the same method in [[TestHttpServers]] instead.
   *
   * @param options
   *   Any desired [[https.ServerOptions]] other than the certificate.
   */
  public static async startSecure(options?: https.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.startSecureInternal(options, false);
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that acts as an HTTP proxy.
   *
   * The server will only act as a proxy and will ignore any request handlers that you specify, but
   * it still has the same properties as a regular [[TestHttpServer]], behaves the same in terms of
   * dynamically choosing a port, and allows you to inspect received requests. The received
   * requests will have a `path` property equal to either the full request URL or, if using a
   * tunneling agent, the request URL minus the path.
   *
   * Note that the current implementation does not support proxying a request to an HTTPS URL.
   *
   * @param options
   *   Any desired [[http.ServerOptions]].
   */
  public static async startProxy(options?: http.ServerOptions): Promise<TestHttpServer> {
    const server = new TestHttpServer(false, true, options);
    await server.startInstance();
    return server;
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that acts as a secure HTTP proxy with a
   * self-signed certificate.
   *
   * This is the same as [[TestHttpServer.startProxy]], but the proxy server itself is secure.
   * Note that the current implementation does not support proxying a request to an HTTPS URL
   * (that is, when the target server is itself secure).
   *
   * @param options
   *   Any desired [[https.ServerOptions]] other than the certificate.
   */
  public static async startSecureProxy(options?: https.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.startSecureInternal(options, true);
  }

  private static nextPort: number = 8000;

  private static async startSecureInternal(options: https.ServerOptions, proxy: boolean): Promise<TestHttpServer> {
    const certAttrs = [{ name: "commonName", value: "localhost" }];
    const certOptions = {
      // This part is based on code within the selfsigned package
      extensions: [
        {
          altNames: [{ type: 6, value: "https://localhost" }],
          name: "subjectAltName",
        },
      ],
    };
    const certData = await selfsigned.generate(certAttrs, certOptions);
    const server = new TestHttpServer(true, proxy,
      { ...options, key: certData.private, cert: certData.cert, ca: certData.public });
    await server.startInstance();
    return server;
  }

  /**
   * The server's base URL ("http://localhost:8000").
   */
  public url: string;

  /**
   * The server's hostname (always "localhost" in this implementation).
   */
  public hostname: string;

  /**
   * The server's port.
   */
  public port: number;

  /**
   * The server's self-signed certificate, if it is a secure server.
   */
  public certificate?: string;

  /**
   * An [[AsyncQueue]] of all requests handled so far. Call `await server.requests.take()` to block
   * untiil the server has handled a request.
   */
  public requests: AsyncQueue<TestHttpRequest>;

  private realServer: http.Server;
  private responses: http.ServerResponse[];
  private matchers: Array<((req: TestHttpRequest, res: http.ServerResponse) => boolean)>;
  private defaultHandler: TestHttpHandler;
  private secure: boolean;
  private count: number;

  private constructor(secure: boolean, proxy: boolean, options: (http.ServerOptions | https.ServerOptions)) {
    this.requests = new  AsyncQueue<TestHttpRequest>();
    this.responses = [];
    this.matchers = [];
    this.secure = secure;
    this.count = 0;

    if (secure) {
      const httpsOptions = options as https.ServerOptions;
      this.realServer = https.createServer(httpsOptions);
      this.certificate = httpsOptions.cert as string;
    } else {
      this.realServer = http.createServer(options as http.ServerOptions);
    }

    this.realServer.on("request", async (req, res) => {
      const reqWrapper = await this.preprocessRequest(req);
      this.responses.push(res);
      if (proxy) {
        const parsedUrl = url.parse(req.url);
        const proxyReq = http.request({ ...parsedUrl, method: req.method, headers: req.headers }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });
        req.pipe(proxyReq);
      } else {
        for (const matcher of this.matchers) {
          if (matcher(reqWrapper, res)) {
            return;
          }
        }
        if (this.defaultHandler) {
          this.defaultHandler(reqWrapper, res);
        }
      }
    });

    if (proxy) {
      this.realServer.on("connect", async (req, clientSocket, head) => {
        const reqWrapper = await this.preprocessRequest(req);
        reqWrapper.path = "http://" + reqWrapper.path; // so tests can see the actual request URL
        const targetHost = req.url.substring(0, req.url.indexOf(":"));
        const targetPort = parseInt(req.url.substring(req.url.indexOf(":") + 1), 10);
        const serverSocket = net.connect(targetPort, targetHost, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
      });
    }

    this.defaultHandler = TestHttpHandlers.respond(404);
  }

  /**
   * Consumes the next received request, waiting until one is available.
   *
   * @returns
   *   A Promise that will be resolved with a [[TestHttpRequest]].
   */
  public async nextRequest(): Promise<TestHttpRequest> {
    return this.requests.take();
  }

  /**
   * Returns the total number of requests that have been received.
   *
   * @returns
   *   The number of requests so far.
   */
  public requestCount(): number {
    return this.count;
  }

  /**
   * Specifies a [[TestHttpHandler]] to use for all requests that are not otherwise matched.
   *
   * @param handler
   *   The request handler. This is normally created with a function like [[respond]].
   * @returns
   *   The same server.
   */
  public byDefault(handler: TestHttpHandler): TestHttpServer {
    this.defaultHandler = handler;
    return this;
  }

  /**
   * Specifies a [[TestHttpHandler]] to use for requests with the specified method and path.
   * This overrides any previous handler for the same method and path.
   *
   * @param method
   *   The HTTP method.
   * @param path
   *   The request path.
   * @handler
   *   The request handler. This is normally created with a function like [[respond]].
   * @returns
   *   The same server.
   */
  public forMethodAndPath(method: string, path: string, handler: TestHttpHandler): TestHttpServer {
    this.matchers.unshift((req, res) => {
      if (req.method === method.toLowerCase() && req.path === path) {
        handler(req, res);
        return true;
      }
      return false;
    });
    return this;
  }

  /**
   * Stops the server.
   */
  public close() {
    this.closeAndWait().then(() => undefined).catch(() => undefined);
  }

  /**
   * Stops the server and provides a Promise to indicate when it is completely stopped.
   */
  public async closeAndWait() {
    this.responses.forEach((res) => res.end()); // in case any handlers didn't close their responses
    this.requests.close();
    return new Promise<void>((resolve, reject) => {
      this.realServer.close((err) => err ? reject(err) : resolve());
    });
  }

  private async startInstance() {
    while (true) {
      const listenOnPort = TestHttpServer.nextPort++;
      try {
        await new Promise((resolve, reject) => {
          this.realServer.listen(listenOnPort);
          this.realServer.on("error", reject);
          this.realServer.on("listening", resolve);
        });
        this.hostname = "localhost";
        this.port = listenOnPort;
        this.url = (this.secure ? "https" : "http") + "://localhost:" + listenOnPort;
        break;
      } catch (err) {
        if (!err.message.match(/EADDRINUSE/)) {
          throw err;
        }
      }
    }
  }

  private async preprocessRequest(req: http.IncomingMessage): Promise<TestHttpRequest> {
    const method = req.method.toLowerCase();
    const body = (method === "post" || method === "put" || method === "report") ?
      await readAllStream(req) :
      undefined;
    const reqWrapper = { method, body, path: req.url, headers: req.headers as TestHttpHeaders };
    this.count++;
    this.requests.add(reqWrapper);
    return reqWrapper;
  }
}

/**
 * Abstract class that provides the same static factory methods as [[TestHttpServer]].
 *
 * This is provided only because some JavaScript projects may have difficulty importing a class that
 * has both a constructor and static methods (transpilers may copy the import in a way that preserves
 * only the constructor function and not the static members). `TestHttpServers.start()` is exactly
 * equivalent to `TestHttpServer.start()`.
 */
export abstract class TestHttpServers {
  /**
   * Creates and starts a [[TestHttpServer]] instance.
   *
   * @param options
   *   Any desired [[http.ServerOptions]].
   */
  public static async start(options?: http.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.start(options);
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that uses HTTPS, with a self-signed certificate.
   *
   * @param options
   *   Any desired [[https.ServerOptions]] other than the certificate.
   */
  public static async startSecure(options?: https.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.startSecure(options);
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that acts as an HTTP proxy.
   *
   * The server will only act as a proxy and will ignore any request handlers that you specify, but
   * it still has the same properties as a regular [[TestHttpServer]], behaves the same in terms of
   * dynamically choosing a port, and allows you to inspect received requests. The received
   * requests will have a `path` property equal to either the full request URL or, if using a
   * tunneling agent, the request URL minus the path.
   *
   * Note that the current implementation does not support proxying a request to an HTTPS URL.
   *
   * @param options
   *   Any desired [[http.ServerOptions]].
   */
  public static async startProxy(options?: http.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.startProxy(options);
  }

  /**
   * Creates and starts a [[TestHttpServer]] instance that acts as a secure HTTP proxy with a
   * self-signed certificate.
   *
   * This is the same as [[TestHttpServers.startProxy]], but the proxy server itself is secure.
   * Note that the current implementation does not support proxying a request to an HTTPS URL
   * (that is, when the target server is itself secure).
   *
   * @param options
   *   Any desired [[https.ServerOptions]] other than the certificate.
   */
  public static async startSecureProxy(options?: https.ServerOptions): Promise<TestHttpServer> {
    return await TestHttpServer.startSecureProxy(options);
  }
}

/**
 * Predefined implementations of [[TestHttpHandler]] for use with [[TestHttpServer]].
 */
export abstract class TestHttpHandlers {
  /**
   * Creates a [[TestHttpHandler]] that sends a simple response.
   *
   * ```
   *     server.forMethodAndPath("get", "/path", TestHttpHandlers.respond(500));
   *     server.forMethodAndPath("get", "/path",
   *         TestHttpHandlers.respond(200, { "content-type": "text/plain" }, "hi"));
   * ```
   *
   * @param status
   *   The desired HTTP status.
   * @param headers
   *   Response headers, if any.
   * @param body
   *   Response body, if any.
   * @returns
   *   A response handler.
   */
  public static respond(status: number, headers?: TestHttpHeaders, body?: string): TestHttpHandler {
    return (req, res) => {
      res.writeHead(status, headers);
      if (body) {
        res.write(body);
      }
      res.end();
    };
  }

  /**
   * Shortcut for creating a [[TestHttpHandler]] that sends a 200 response with JSON content.
   *
   * ```
   *     server.forMethodAndPath("get", "/path",
   *         TestHttpHandlers.respondJson({ message: "hi" }));
   * ```
   *
   * @param serializableData
   *   A value of any type that will be converted to JSON.
   * @returns
   *   A response handler.
   */
  public static respondJson(serializableData: any): TestHttpHandler {
    return TestHttpHandlers.respond(200, { "Content-Type": "application/json" }, JSON.stringify(serializableData));
  }

  /**
   * Creates a [[TestHttpHandler]] that sends a chunked HTTP response, using an [[AsyncQueue]] as a pipe.
   *
   * ```
   *     const chunkQueue = new AsyncQueue<string>();
   *     server.forMethodAndPath("get", "/path",
   *         TestHttpHandlers.chunkedStream(200, {}, chunkQueue));
   *     chunkQueue.add("a chunk of data");
   *     chunkQueue.add("another one");
   *     chunkQueue.close();
   * ```
   *
   * @param status
   *   The desired HTTP status.
   * @param headers
   *   Response headers, if any.
   * @param chunkQueue
   *   An existing [[AsyncQueue]]. As you add chunks of response data to the queue, they will be consumed and
   *   sent. Call `close()` on the queue to end the response.
   * @returns
   *   A response handler.
   */
  public static chunkedStream(status: number, headers: TestHttpHeaders, chunkQueue: AsyncQueue<string>):
      TestHttpHandler {
    return async (req, res) => {
      res.writeHead(status, headers);
      res.write(""); // this just avoids response buffering, and causes all subsequent writes to be chunked
      while (true) {
        try {
          const chunk = await chunkQueue.take();
          res.write(chunk);
        } catch (e) {
          // queue was probably closed
          res.end();
          break;
        }
      }
    };
  }

  /**
   * Creates a [[TestHttpHandler]] that sends a streaming response in Server-Sent Events format, using
   * an [[AsyncQueue]] as an event pipe.
   *
   * ```
   *     const eventQueue = new AsyncQueue<SSEItem>();
   *     server.forMethodAndPath("get", "/path",
   *         TestHttpHandlers.sseStream(200, {}, eventQueue));
   *     eventQueue.add({ type: "patch", data: { path: "/flags", key: "x" } });
   *     eventQueue.add({ comment: "" });
   *     eventQueue.close();
   * ```
   *
   * @param eventQueue
   *   An existing [[AsyncQueue]]. As you add [[SSEItem]] objects to the queue, they will be consumed and
   *   sent. Call `close()` on the queue to end the response.
   */
  public static sseStream(eventQueue: AsyncQueue<SSEItem>): TestHttpHandler {
    const chunkQueue = new AsyncQueue<string>();
    (async () => { // we're not awaiting this task - it keeps running after we return
      while (true) {
        let item: SSEItem;
        let chunk: string = "";
        try {
          item = await eventQueue.take();
        } catch (e) {
          chunkQueue.close();
          break;
        }
        if (item.comment !== undefined) {
          chunk = ":" + item.comment + "\n";
        }
        if (item.data !== undefined) {
          chunk = "event: " + item.type + "\n";
          if (item.id) {
            chunk += "id: " + item.id;
          }
          chunk += "data: " + item.data + "\n\n";
        }
        chunkQueue.add(chunk);
      }
    })();
    return TestHttpHandlers.chunkedStream(200, { "Content-Type": "text/event-stream" }, chunkQueue);
  }

  /**
   * Creates a [[TestHttpHandler]] that will cause the request to terminate with a network error, by
   * closing the response socket prematurely.
   *
   * @returns
   *   A response handler.
   */
  public static networkError(): TestHttpHandler {
    return (req, res) => res.connection.end();
  }
}

/**
 * A data item or comment in a Server-Sent Events stream, for [[TestHttpHandlers.sseStream]].
 */
export interface SSEItem {
  /**
   * The event type ("event:" field).
   */
  type?: string;

  /**
   * The event ID ("id:" field).
   */
  id?: string;

  /**
   * The event data ("data:" field). This must be defined unless `comment` is provided.
   */
  data?: string;

  /**
   * A comment string to be sent instead of an event (":" will be prepended).
   */
  comment?: string;
}
