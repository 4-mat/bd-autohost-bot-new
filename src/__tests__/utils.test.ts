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

// A fake ws whose `send` throws until `open` flips true, mimicking a
// socket that (re)connects mid-queue.
function makeFakeSocket() {
  const sent: string[] = [];
  let open = false;
  setWs({
    send: (msg: string) => {
      if (!open) throw new Error("WebSocket is not open");
      sent.push(msg);
    },
  });
  return { sent, open: () => (open = true) };
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
});
