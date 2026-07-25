import config from "./config.js";
import { send } from "./utils.js";

export async function login(challstr: string) {
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
    if (parsed.actionsuccess) {
      const assertion = parsed.assertion;
      send("", `/trn ${config.username},0,${assertion}`);
    } else {
      console.error("Login failed:", JSON.stringify(parsed));
    }
  } catch (e) {
    console.error("[login] Error:", (e as Error).message);
  }
}
