import config from "./config.js";
import { bot } from "./connection.js";
import { send } from "./utils.js";
import https from "https";

export function login(challstr: string) {
  const data = `name=${encodeURIComponent(config.username)}&pass=${encodeURIComponent(config.password)}&challstr=${encodeURIComponent(challstr)}`;

  const req = https.request(
    {
      hostname: "play.pokemonshowdown.com",
      path: "/~~showdown/action.php",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    },
    (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (body.startsWith("]")) body = body.slice(1);
        const parsed = JSON.parse(body);
        if (parsed.actionsuccess) {
          const assertion = parsed.assertion;
          send("", `|/trn ${config.username},0,${assertion}`);
          console.log(`Logged in as ${config.username}`);
        } else {
          console.error("Login failed:", JSON.stringify(parsed));
        }
      });
    },
  );

  req.on("error", (err) => {
    console.error("Login request error:", err.message);
  });

  req.write(data);
  req.end();
}
