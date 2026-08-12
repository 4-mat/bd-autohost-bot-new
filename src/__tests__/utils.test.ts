import { describe, it, expect, beforeEach } from "bun:test";
import {
  send,
  setWs,
  resumeSending,
  resetSendQueueForTests,
} from "../utils.js";

// ---------------------------------------------------------------------------
// send queue — message preservation across socket outages
// ---------------------------------------------------------------------------

// The module-level queue/sending state is shared process-wide and other test
// files (combat/choice/confirm) install their own setWs at import, so reset
// the queue before every test to start from a known state.
beforeEach(() => {
  resetSendQueueForTests();
});

// A fake ws whose `send` throws (and/or errors via callback) until `open`
// flips true, mimicking a socket that (re)connects mid-queue. The callback
// is invoked the same way the real `ws` package does: async send failure
// surfaces as `cb(err)`, synchronous refusal as a throw.
function makeFakeSocket() {
  const sent: string[] = [];
  let open = false;
  setWs({
    send: (msg: string, cb?: (err?: Error) => void) => {
      if (!open) {
        throw new Error("WebSocket is not open");
      }
      sent.push(msg);
      cb?.();
    },
  });
  return { sent, open: () => (open = true) };
}

// A fake ws that reports failure through the send callback instead of
// throwing (the async-error path the real library can take).
function makeFakeSocketCbError() {
  const sent: string[] = [];
  let open = false;
  setWs({
    send: (msg: string, cb?: (err?: Error) => void) => {
      if (!open) {
        cb?.(new Error("WebSocket is not open"));
        return;
      }
      sent.push(msg);
      cb?.();
    },
  });
  return { sent, open: () => (open = true) };
}

// A fake ws whose send callback stays pending until the test fires it,
// so a test can order a reconnect (resumeSending) before the in-flight
// send reports its failure -- the exact race that used to strand the
// retained queue head.
function makeFakeSocketDeferred() {
  const sent: string[] = [];
  let open = false;
  let pendingCb: ((err?: Error) => void) | null = null;
  setWs({
    send: (msg: string, cb?: (err?: Error) => void) => {
      if (!open) {
        pendingCb = cb ?? null;
        return;
      }
      sent.push(msg);
      cb?.();
    },
  });
  return {
    sent,
    open: () => {
      open = true;
    },
    failPending: (err?: Error) => {
      const cb = pendingCb;
      pendingCb = null;
      cb?.(err);
    },
  };
}

describe("send queue", () => {
  it("keeps a message queued when the socket is down, then flushes on resume", async () => {
    const sock = makeFakeSocket();

    send("battledome", "hello");
    // ws.send threw: the message must NOT be dropped.
    expect(sock.sent).toEqual([]);

    sock.open();
    resumeSending();
    // Wait out the chained 400ms drains so no timer bleeds into the next
    // test (the module-level queue is shared within this file).
    await new Promise((r) => setTimeout(r, 500));
    expect(sock.sent).toEqual(["|hello"]);
  });

  it("preserves the whole backlog in order across the outage", async () => {
    const sock = makeFakeSocket();

    send("battledome", "one");
    send("pm-bob", "two");
    send("battledome", "three");
    expect(sock.sent).toEqual([]);

    sock.open();
    resumeSending();
    // Wait for the chained 400ms drains to flush the backlog.
    await new Promise((r) => setTimeout(r, 1300));
    // PM messages are sent without the room prefix.
    expect(sock.sent).toEqual(["|one", "two", "|three"]);
  });

  it("retains the head when the send callback reports an error, then resumes", async () => {
    const sock = makeFakeSocketCbError();

    send("battledome", "hello");
    // The failure came through the callback: the message must NOT be dropped.
    expect(sock.sent).toEqual([]);

    sock.open();
    resumeSending();
    await new Promise((r) => setTimeout(r, 500));
    expect(sock.sent).toEqual(["|hello"]);
  });

  it("restarts draining when a late send-callback error raced a reconnect", async () => {
    const sock = makeFakeSocketDeferred();

    send("battledome", "hello");
    // The send is in flight: ws.send() was called but its callback is
    // still pending (sending === true).

    sock.open();
    resumeSending();
    // resumeSending() is a no-op here (a send is in flight), but the late
    // callback error below must still restart the drain so the retained
    // head is not stranded.

    sock.failPending(new Error("socket dropped mid-flight"));
    await new Promise((r) => setTimeout(r, 500));
    expect(sock.sent).toEqual(["|hello"]);
  });
});
