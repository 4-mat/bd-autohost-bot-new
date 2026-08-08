import { describe, it, expect, beforeEach } from "bun:test";
import {
  send,
  sendPm,
  setWs,
  resumeSending,
  resetSendQueueForTests,
} from "../utils.js";

// The module-level send queue is shared across test files (Bun runs files in
// the same process), so other files' leftover drain chains can leak into
// these tests. Reset to a clean state before each test.
beforeEach(() => {
  resetSendQueueForTests();
});

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("send queue resilience", () => {
  it("preserves queued messages when the socket send throws", async () => {
    const sent: string[] = [];
    let down = true;
    setWs({
      send: (msg: string) => {
        if (down) throw new Error("socket not open");
        sent.push(msg);
      },
    });

    send("room1", "one");
    send("room1", "two");

    // Nothing flushed while the socket is down.
    await settle(50);
    expect(sent).toEqual([]);

    // Socket reopens: resumeSending() flushes the backlog.
    down = false;
    resumeSending();
    await settle(900); // 400ms spacing between queued sends
    expect(sent).toEqual(["|one", "|two"]);
  });

  it("keeps a failed message at the front of the queue for retry", async () => {
    const sent: string[] = [];
    let failNext = true;
    setWs({
      send: (msg: string) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient failure");
        }
        sent.push(msg);
      },
    });

    send("room1", "first");
    send("room1", "second");

    // First send attempt fails; the message must not be dropped.
    resumeSending();
    await settle(900);
    expect(sent).toEqual(["|first", "|second"]);
  });

  it("flush leaves the queue drained for the next message", async () => {
    const sent: string[] = [];
    setWs({ send: (msg: string) => sent.push(msg) });

    send("room1", "alpha");
    await settle(900);
    expect(sent).toEqual(["|alpha"]);

    send("room1", "beta");
    await settle(900);
    expect(sent).toEqual(["|alpha", "|beta"]);
  });

  it("sendPm prefixes messages with the PM path but no room pipe", async () => {
    const sent: string[] = [];
    setWs({ send: (msg: string) => sent.push(msg) });

    sendPm("Alice", "hello");
    await settle(900);
    // The room key is lowercased (toId) but the PM payload keeps the
    // original-cased display name.
    expect(sent).toEqual(["|/pm Alice, hello"]);
  });
});
