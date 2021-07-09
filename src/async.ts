import { EventEmitter } from "events";
import { Stream } from "stream";

/**
 * Converts a function whose last parameter is a Node-style callback `(err, result)` into a function
 * with one fewer argument that returns a Promise.
 *
 * This is equivalent to `util.promisify`, but since Node 6 does not provide `promisify`, it is
 * reimplemented here for projects that need to support Node 6. Note that it currently does not
 * type-check the arguments.
 *
 * ```
 *     function someFunction(param1, param2, callback) { callback(err, result); }
 *     var result = await promisify(someFunction)(param1, param2);
 * ```
 *
 * @param functionWithErrorAndValueCallback
 *   An asynchronously implemented function whose last parameter is an error-and-value callback.
 * @returns
 *   An equivalent function that returns a Promise. The Promise will be resolved if the original
 *   function calls its callback with no error `(null, returnValue)`, or rejected if it was called
 *   with an error (or if the original function threw an exception).
 */
export function promisify(functionWithErrorAndValueCallback: (...args: any[]) => void):
    (...args: any[]) => Promise<any> {
  return (...args) => {
    const pc = new PromiseAndErrorValueCallback<any>();
    functionWithErrorAndValueCallback(...args, pc.callback);
    return pc.promise;
  };
}

/**
 * Similar to [[promisify]], but for functions whose callback takes only a single parameter `(result)`
 * instead of the typical Node style `(err, result)`.
 *
 * ```
 *     function someFunction(param1, param2, callback) { callback(result); }
 *     var result = await promisify(someFunction)(param1, param2);
 * ```
 *
 * @param functionWithSingleValueCallback
 *   An asynchronously implemented function whose last parameter is a single-value callback.
 * @returns
 *   An equivalent function that returns a Promise. The Promise will be resolved if the original
 *   function calls its callback with a value, or rejected if the original function threw an exception.
 */
export function promisifySingle(functionWithSingleValueCallback: (...args: any[]) => void):
    (...args: any[]) => Promise<any> {
  return (...args) => {
    const pc = new PromiseAndValueCallback<any>();
    functionWithSingleValueCallback(...args, pc.callback);
    return pc.promise;
  };
}

/**
 * Creates an [[AsyncQueue]] that will receive events. The value of each queue item is the value
 * associated with the event, or an array if there were multiple values.
 *
 * ```
 *     const receivedErrors = eventSink(client, "error");
 *     const firstError = await receivedErrors.take();
 *     const secondError = await receivedErrors.take();
 * ```
 *
 * @param emitter
 *   An event emitter.
 * @param name
 *   The event name.
 * @returns
 *   A Promise that is resolved the first time the event is raised. It will contain the value that
 *   was provided with the event, if any-- or, if there were multiple values, an array of them.
 */
export function eventSink(emitter: EventEmitter, name: string): AsyncQueue<any> {
  const queue = new AsyncQueue<any>();
  emitter.on(name, (...args: any[]) => {
    if (args.length > 1) {
      queue.add(args);
    } else if (args.length === 1) {
      queue.add(args[0]);
    } else {
      queue.add(undefined);
    }
  });
  return queue;
}

/**
 * Helper class for creating a Promise that is paired with a single-value callback.
 *
 * ```
 *     const pvc = new PromiseAndValueCallback<string>();
 *     pvc.callback("a");
 *     const result = await pvc.promise; // returns "a"
 * ```
 */
export class PromiseAndValueCallback<T> {
  /**
   * A Promise that will be resolved when `callback` is called.
   */
  public promise: Promise<T>;

  /**
   * A callback function taking a single value; when it is called, `promise` is resolved with that value.
   */
  public callback: (value: T) => void;

  constructor() {
    const me = this;
    this.promise = new Promise<T>((resolve) => { me.callback = resolve; });
  }
}

/**
 * Helper class for creating a Promise that is paired with an error-and-value callback.
 *
 * ```
 *     const pvc1 = new PromiseAndErrorValueCallback<string>();
 *     pvc1.callback(null, "a");
 *     const result = await pvc1.promise; // returns "a"
 *
 *     const pvc2 = new PromiseAndErrorValueCallback<string>();
 *     pvc2.callback(new Error("sorry"));
 *     await pvc2.promise; // throws error
 * ```
 */
export class PromiseAndErrorValueCallback<T> {
  /**
   * A Promise that will be resolved when `callback` is called without an error, or rejected if `callback` is
   * called with an error.
   */
  public promise: Promise<T>;

  /**
   * A callback function that takes an error value and/or a result value; when it is called, `promise` is
   * resolved or rejected.
   */
  public callback: (err: any, value: T) => void;

  constructor() {
    const me = this;
    this.promise = new Promise<T>((resolve, reject) => {
      me.callback = (err, value) => err ? reject(err) : resolve(value);
    });
  }
}

/**
 * Fully reads a stream.
 *
 * @param stream
 *   The stream to read.
 * @returns
 *   A Promise that is resolved with the full content.
 */
export async function readAllStream(stream: Stream): Promise<string> {
  return new Promise<string>((resolve) => {
    let result = "";
    stream.on("data", (data) => {
      result += data;
    });
    stream.on("end", () => resolve(result));
  });
}

/**
 * Returns a Promise based on `setTimeout()`.
 *
 * ```
 *     await sleepAsync(5000);
 * ```
 *
 * @param milliseconds
 *   The length of the delay.
 * @returns
 *   A Promise that is resolved after the delay. It is never rejected.
 */
export function sleepAsync(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Interface for any object that has a `close()` method. Used by [[withCloseable]].
 */
export interface Closeable {
  /**
   * Releases any resources held by the object when it will no longer be used.
   */
  close: () => void;
}

/**
 * Ensures that an object"s close() method is called after executing a callback, even if an error occurs.
 *
 * ```
 *     await withCloseable(myExistingObject, async o => doSomething(o));
 *     await withCloseable(() => makeNewObject(), async o => doSomething(o));
 *     await withCloseable(async () => await makeObjectAsync(), async o => doSomething(o));
 * ```
 *
 * @param entityOrCreateFn
 *   Either the object itself, or a function (sync or async) that will create it. If this is null or
 *   undefined, you will receive a rejected Promise.
 * @param asyncCallback
 *   An async function to execute with the object as a parameter.
 * @returns
 *   A Promise that resolves with the return value of the callback.
 */
export async function withCloseable<T extends Closeable, U>(
  entityOrCreateFn: T | (() => T) | (() => Promise<T>),
  asyncCallback: (entity: T) => Promise<U>): Promise<U> {
  // Using Promise.resolve allows promises and simple values to be treated as promises
  let entity: T;
  if (typeof entityOrCreateFn === "function") {
    entity = await Promise.resolve((entityOrCreateFn as (() => T))());
  } else {
    entity = entityOrCreateFn as T;
  }
  if (entity === null || entity === undefined) {
    throw new Error("withCloseable's first parameter was null/undefined or did not return a value");
  }
  try {
    return await asyncCallback(entity);
  } finally {
    entity.close();
  }
}

// used internally
class Awaiter<T> {
  public resolve: (value: T) => void;
  public reject: (err: any) => void;
}

/**
 * A Promise-based blocking queue.
 */
export class AsyncQueue<T> {
  private static closedError(): Error {
    return new Error("queue was closed");
  }

  private items: T[];
  private awaiters: Array<Awaiter<T>>;
  private closed: boolean;

  public constructor() {
    this.items = [];
    this.awaiters = [];
    this.closed = false;
  }

  /**
   * Adds an item at the end of a queue. If the queue was empty and there are any pending requests from
   * `take()`, the first one receives the item. If the queue has been closed, nothing happens.
   *
   * @param item
   *   The item to add.
   */
  public add(item: T) {
    if (!this.closed) {
      if (this.awaiters.length) {
        this.awaiters.shift().resolve(item);
      } else {
        this.items.push(item);
      }
    }
  }

  /**
   * Attempts to consume an item from the queue in FIFO order, waiting until there is one, unless the
   * queue is closed.
   *
   * @returns
   *   A Promise that is resolved with the first item in the queue once it is available, removing the
   *   item. If the queue is empty and has been closed with `close()`, the Promise is rejected instad.
   */
  public async take(): Promise<T> {
    if (this.items.length) {
      return Promise.resolve(this.items.shift());
    }
    if (this.closed) {
      return Promise.reject(AsyncQueue.closedError());
    }
    return new Promise<T>((resolve, reject) => {
      this.awaiters.push({ resolve, reject });
    });
  }

  /**
   * Tests whether the queue is empty.
   *
   * @returns
   *   True if the queue is empty.
   */
  public isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Returns the current number of items in the queue.
   *
   * @returns
   *   The length of the queue.
   */
  public length(): number {
    return this.items.length;
  }

  /**
   * Signals that the queue ends permanently after its current position. After calling `close()`,
   * `take()` will still consume any items that already exist in the queue, but once it is empty,
   * `take()` returns an error. No more items can be added.
   */
  public close() {
    while (this.awaiters.length > 0) {
      this.awaiters.shift().reject(AsyncQueue.closedError());
    }
    this.closed = true;
  }
}

/**
 * A simple asynchronous lock that can be held by one task at a time.
 *
 * This is a naive implementation that is meant for simple cases where two pieces of async test
 * logic must not be run in parallel because they use the same resource.
 */
export class AsyncMutex {
  private held: number;
  private awaiters: Array<PromiseAndValueCallback<null>>;

  public constructor() {
    this.held = 0;
    this.awaiters = [];
  }

  /**
   * Acquires the lock as soon as possible. 
   * 
   * @returns a Promise that resolves once the lock has been acquired
   */
  public acquire(): Promise<void> {
    if (this.held === 0) {
      this.held = 1;
      return;
    }
    const pvc = new PromiseAndValueCallback<null>();
    this.awaiters.push(pvc);
    this.held++;
    return pvc.promise;
  }

  /**
   * Releases the lock. If someone else was waiting on an [[acquire]], they will now acquire it
   * (first come first served). This simple implementation does not verify that you were the
   * one who had actually acquired the lock.
   */
  public release(): void {
    if (this.held !== 0) {
      if (this.awaiters.length) {
        const pvc = this.awaiters.shift(); // awaiters are in FIFO order
        this.held--;
        pvc.callback(null);
      } else {
        this.held = 0;
      }
    }
  }

  /**
   * Acquires the lock, awaits an asynchronous action, and ensures that the lock is released.
   * @param action an asynchronous function
   * @returns the function's return value.
   */
  public async do<T>(action: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await action();
    } finally {
      this.release();
    }
  }
}
