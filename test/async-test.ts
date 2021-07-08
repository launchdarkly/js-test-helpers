import { EventEmitter } from "events";

import { AsyncMutex, AsyncQueue, eventSink, promisify, promisifySingle, sleepAsync, withCloseable } from "../src/async";

describe("AsyncMutex", () => {
  it("non-overlapping acquires", async () => {
    const values = [];
    const lock = new AsyncMutex();

    await lock.acquire();
    values.push(1);
    lock.release();

    await lock.acquire();
    values.push(2);
    lock.release();

    await lock.acquire();
    values.push(3);
    lock.release();

    expect(values).toEqual([1, 2, 3]);
  });

  it("overlapping acquires", async () => {
    const values = new AsyncQueue();
    const lock = new AsyncMutex();

    const task1 = async () => {
      await lock.acquire();
      await sleepAsync(10);
      values.add(1);
      lock.release();
    };

    const task2 = async () => {
      await lock.acquire();
      values.add(2);
      lock.release();
    };

    const task3 = async () => {
      await lock.acquire();
      values.add(3);
      lock.release();
    };

    task1();
    task2();
    task3();
    expect(await values.take()).toEqual(1);
    expect(await values.take()).toEqual(2);
    expect(await values.take()).toEqual(3);
  });

  it("do", async () => {
    const values = new AsyncQueue();
    const lock = new AsyncMutex();

    const task1 = async () => {
      await lock.do(async () => {
        await sleepAsync(10);
        values.add(1);
      });
    };

    const task2 = async () => {
      await lock.do(async () => {
        values.add(2);
      });
    };

    const task3 = async () => {
      await lock.do(async () => {
        values.add(3);
      });
    };

    task1();
    task2();
    task3();
    expect(await values.take()).toEqual(1);
    expect(await values.take()).toEqual(2);
    expect(await values.take()).toEqual(3);
  });
});

// describe("AsyncQueue", () => {
//   describe("isEmpty", () => {
//     it("returns true initially", () => {
//       const q = new AsyncQueue<string>();
//       expect(q.isEmpty()).toBe(true);
//     });

//     it("returns false after item is added", () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       expect(q.isEmpty()).toBe(false);
//     });

//     it("returns true after all items are consumed", async () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       q.add("b");
//       await q.take();
//       expect(q.isEmpty()).toBe(false);
//       await q.take();
//       expect(q.isEmpty()).toBe(true);
//     });
//   });

//   describe("length", () => {
//     it("returns zero initially", () => {
//       const q = new AsyncQueue<string>();
//       expect(q.length()).toBe(0);
//     });

//     it("increments when items are added", () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       expect(q.length()).toBe(1);
//       q.add("b");
//       expect(q.length()).toBe(2);
//     });

//     it("decrements when items are consumed", async () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       q.add("b");
//       await q.take();
//       expect(q.length()).toBe(1);
//       await q.take();
//       expect(q.length()).toBe(0);
//     });
//   });

//   describe("take", () => {
//     it("consumes previously added items", async () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       q.add("b");
//       const first = await q.take();
//       expect(first).toEqual("a");
//       const second = await q.take();
//       expect(second).toEqual("b");
//     });

//     it("waits if queue is empty", async () => {
//       const q = new AsyncQueue<string>();
//       setTimeout(() => q.add("a"), 100);
//       setTimeout(() => q.add("b"), 100);
//       const first = await q.take();
//       expect(first).toEqual("a");
//       const second = await q.take();
//       expect(second).toEqual("b");
//     });

//     it("rejects after last item if queue is closed", async () => {
//       const q = new AsyncQueue<string>();
//       q.add("a");
//       q.close();
//       const first = await q.take();
//       expect(first).toEqual("a");
//       await expect(q.take()).rejects.toThrow();
//     });

//     it("rejects if already waiting when queue is closed", async () => {
//       const q = new AsyncQueue<string>();
//       setTimeout(() => q.close(), 100);
//       await expect(q.take()).rejects.toThrow();
//     });
//   });
// });

// describe("promisify", () => {
//   it("callback with no error resolves promise", async () => {
//     const fn = (a: number, b: number, callback: (err: any, result?: number) => void) => {
//       callback(null, a + b);
//     };
//     const result = await promisify(fn)(2, 3);
//     expect(result).toBe(5);
//   });

//   it("callback with error resolves promise", async () => {
//     const fn = (a: number, b: number, callback: (err: any, result?: number) => void) => {
//       callback(new Error("sorry"));
//     };
//     await expect(promisify(fn)(2, 3)).rejects.toThrow("sorry");
//   });
// });

// describe("promisifySingle", () => {
//   it("single-value callback resolves promise", async () => {
//     const fn = (a: number, b: number, callback: (result: number) => void) => {
//       callback(a + b);
//     };
//     const result = await promisifySingle(fn)(2, 3);
//     expect(result).toBe(5);
//   });
// });

// describe("eventSink", () => {
//   it("receives event with no value", async () => {
//     const emitter = new EventEmitter();
//     const es = eventSink(emitter, "bingo");
//     emitter.emit("bingo");
//     expect(await es.take()).toBeUndefined();
//   });

//   it("receives event with single value", async () => {
//     const emitter = new EventEmitter();
//     const es = eventSink(emitter, "bingo");
//     emitter.emit("bingo", 23);
//     expect(await es.take()).toEqual(23);
//   });

//   it("resolves event with multiple values", async () => {
//     const emitter = new EventEmitter();
//     const es = eventSink(emitter, "bingo");
//     emitter.emit("bingo", "G", 23);
//     expect(await es.take()).toEqual(["G", 23]);
//   });

//   it("can receive multiple events", async () => {
//     const emitter = new EventEmitter();
//     const es = eventSink(emitter, "bingo");
//     emitter.emit("bingo", 1);
//     emitter.emit("bingo", 2);
//     expect(await es.take()).toEqual(1);
//     expect(await es.take()).toEqual(2);
//   });
// });

// describe("sleepAsync", () => {
//   it("sleeps", async () => {
//     const t0 = new Date().getTime();
//     await sleepAsync(110);
//     const t1 = new Date().getTime();
//     expect(t1 - t0).toBeGreaterThanOrEqual(100);
//   });
// });

// class TestCloseable {
//   public closed: boolean = false;

//   public close() {
//     this.closed = true;
//   }
// }

// describe("withCloseable", () => {
//   it("passes existing entity to callback", async () => {
//     const e = new TestCloseable();
//     await withCloseable(e, async (e1) => {
//       expect(e1).toBe(e);
//     });
//     expect(e.closed).toBe(true);
//   });

//   it("can use sync creator function", async () => {
//     const e = new TestCloseable();
//     await withCloseable(() => e, async (e1) => {
//       expect(e1).toBe(e);
//     });
//     expect(e.closed).toBe(true);
//   });

//   it("can use async creator function", async () => {
//     const e = new TestCloseable();
//     await withCloseable(async () => Promise.resolve(e), async (e1) => {
//       expect(e1).toBe(e);
//     });
//     expect(e.closed).toBe(true);
//   });

//   it("closes entity if exception is thrown", async () => {
//     const e = new TestCloseable();
//     await expect(withCloseable(e, async () => {
//       throw new Error("sorry");
//     })).rejects.toThrow();
//     expect(e.closed).toBe(true);
//   });

//   it("rejects if entity is null", async () => {
//     await expect(withCloseable(null, async () => true)).rejects.toThrow();
//   });

//   it("rejects if entity is undefined", async () => {
//     await expect(withCloseable(undefined, async () => true)).rejects.toThrow();
//   });

//   it("rejects if creator returns null", async () => {
//     await expect(withCloseable(() => null, async () => true)).rejects.toThrow();
//   });

//   it("rejects if creator returns undefined", async () => {
//     await expect(withCloseable(() => undefined, async () => true)).rejects.toThrow();
//   });
// });
