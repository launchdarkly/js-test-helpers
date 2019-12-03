import {
  SSEItem,
  TestHttpHandlers,
  TestHttpServer,
  TestHttpServers,
} from "../src";

import {
  AsyncQueue,
  eventSink,
  PromiseAndValueCallback,
  promisifySingle,
  readAllStream,
  withCloseable,
} from "../src";

import * as http from "http";
import * as https from "https";
import { parse } from "url";

// doGet and doPost allow this test code to use simpler semantics that aren't supported by Node 6

async function doGet(url: string, options?: https.RequestOptions): Promise<http.IncomingMessage> {
  const reqProps = parse(url) as http.RequestOptions;
  return promisifySingle(http.get)({ ...reqProps, ...options });
}

async function doPost(url: string, headers: http.OutgoingHttpHeaders, body: string): Promise<http.IncomingMessage> {
  const reqPromiseAndCallback = new PromiseAndValueCallback<http.IncomingMessage>();
  const reqProps = parse(url) as http.RequestOptions;
  const req = http.request({ ...reqProps, method: "post", headers }, reqPromiseAndCallback.callback);
  req.write(body);
  req.end();
  return reqPromiseAndCallback.promise;
}

async function withServer<T>(callback: (server: TestHttpServer) => Promise<T>): Promise<T> {
  const server = await TestHttpServer.start();
  return await withCloseable(server, callback);
}

async function withSecureServer<T>(callback: (server: TestHttpServer) => Promise<T>): Promise<T> {
  const server = await TestHttpServer.startSecure();
  return await withCloseable(server, callback);
}

describe("TestHttpServer", () => {
  it("returns 404 if there are no handlers", async () =>
    withServer(async (server) => {
      const res = await promisifySingle(http.get)(server.url);
      expect(res.statusCode).toBe(404);
    }));

  it("can specify default handler", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(201));
      const res = await promisifySingle(http.get)(server.url + "/arbitrary/path");
      expect(res.statusCode).toBe(201);
    }));

  it("can specify multiple handlers", async () =>
    withServer(async (server) => {
      server.forMethodAndPath("get", "/path1", TestHttpHandlers.respond(200));
      server.forMethodAndPath("get", "/path2", TestHttpHandlers.respond(201));
      server.forMethodAndPath("post", "/path1", TestHttpHandlers.respond(202));

      const res1 = await doGet(server.url + "/path1");
      expect(res1.statusCode).toBe(200);

      const res2 = await doGet(server.url + "/path2");
      expect(res2.statusCode).toBe(201);

      const res3 = await doPost(server.url + "/path1", {}, "hi");
      expect(res3.statusCode).toBe(202);
    }));

  it("records request properties", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(200));
      const headers = { "my-header": "x" };

      const res = await doGet(server.url + "/thing", { headers });
      expect(res.statusCode).toBe(200);

      const req = await server.nextRequest();
      expect(req.method).toEqual("get");
      expect(req.path).toEqual("/thing");
      expect(req.headers).toMatchObject(headers);
      expect(req.body).toBeUndefined();

      expect(server.requestCount()).toEqual(1);
    }));

  it("reads request body", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(200));

      const res = await doPost(server.url + "/thing", {}, "this is the content");
      expect(res.statusCode).toBe(200);

      const req = await server.nextRequest();
      expect(req.method).toEqual("post");
      expect(req.path).toEqual("/thing");
      expect(req.body).toEqual("this is the content");
    }));

  it("can be created via TestHttpServers alias", async () =>
    withCloseable(async () => await TestHttpServers.start(), async (server) => undefined));
});

describe("TestHttpHandlers", () => {
  it("respond (no body)", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(400));

      const res = await promisifySingle(http.get)(server.url);
      expect(res.statusCode).toBe(400);
    }));

  it("respond (with body)", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(400, {}, "hi"));

      const res = await doGet(server.url);
      expect(res.statusCode).toBe(400);
      expect(await readAllStream(res)).toEqual("hi");
    }));

  it("respondJson", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.respondJson({ thing: "stuff" }));

      const res = await doGet(server.url);
      expect(res.statusCode).toBe(200);
      expect(res.headers).toMatchObject({ "content-type": "application/json" });
    }));

  it("chunkedStream", async () =>
    withServer(async (server) => {
      const chunkQueue = new AsyncQueue<string>();
      server.byDefault(TestHttpHandlers.chunkedStream(200, { "content-type": "text/plain "}, chunkQueue));

      const req = doGet(server.url);
      chunkQueue.add("thing");
      chunkQueue.add("+stuff");
      chunkQueue.close();
      const res = await req;
      expect(res.statusCode).toBe(200);
      expect(res.headers).toMatchObject({ "content-type": "text/plain "});
      expect(await readAllStream(res)).toEqual("thing+stuff");
    }));

  it("sseStream", async () =>
    withServer(async (server) => {
      const eventQueue = new AsyncQueue<SSEItem>();
      server.byDefault(TestHttpHandlers.sseStream(eventQueue));

      const req = doGet(server.url);
      eventQueue.add({ comment: "hi" });
      eventQueue.add({ type: "put", data: "stuff" });
      eventQueue.close();
      const res = await req;
      expect(res.statusCode).toBe(200);
      expect(res.headers).toMatchObject({ "content-type": "text/event-stream"});
      const body = await readAllStream(res);
      expect(body).toEqual(":hi\nevent: put\ndata: stuff\n\n");
    }));

  it("networkError", async () =>
    withServer(async (server) => {
      server.byDefault(TestHttpHandlers.networkError());

      const req = http.get(server.url);
      const errs = eventSink(req, "error");
      expect(await errs.take()).not.toBeUndefined();
    }));
});

describe("secure server", () => {
  it("provides self-signed certificate", async () =>
    withSecureServer(async (server) => {
      server.byDefault(TestHttpHandlers.respond(200));
      const reqProps = parse(server.url) as https.RequestOptions;
      const res = await promisifySingle(https.get)({ ...reqProps, ca: server.certificate });
      expect(res.statusCode).toBe(200);
    }));

  it("can be created via TestHttpServers alias", async () =>
    withCloseable(async () => await TestHttpServers.startSecure(), async (server) => undefined));
});
