import config from "./config.js";
import { sendImmediate, isConnectionCurrent } from "./utils.js";

/**
 * Log in with the given challstr. `generation` is the connection generation
 * that received the challstr; the /trn assertion is only sent while that
 * connection is still the active one (a reconnect during the HTTP request
 * supersedes it, and the stale assertion must not reach the new socket).
 */
export async function login(challstr: string, generation?: number) {
  const data = new URLSearchParams({
    act: "login",
    name: config.username,
    pass: config.password,
    challstr,
  });

  try {
    const res = await fetch(
      "https://play.pokemonshowdown.com/~~showdown/action.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; encoding=UTF-8",
        },
        body: data.toString(),
      },
    );

    let body = await res.text();
    if (body.startsWith("]")) body = body.slice(1);

    const parsed = JSON.parse(body);
    if (!parsed.actionsuccess) {
      console.error("Login failed:", JSON.stringify(parsed));
      return;
    }
    if (generation !== undefined && !isConnectionCurrent(generation)) {
      // The socket was replaced while the assertion request was in flight;
      // the new connection has its own challstr/login cycle. Discard rather
      // than send a stale assertion over the new socket.
      console.log("[login] connection superseded; discarding stale assertion.");
      return;
    }
    const assertion = parsed.assertion;
    sendImmediate(`/trn ${config.username},0,${assertion}`);
  } catch (e) {
    console.error("[login] Error:", (e as Error).message);
  }
}
