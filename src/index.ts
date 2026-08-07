import { connect } from "./connection.js";
import "./parser.js";
import { loadGameData } from "./data/index.js";

loadGameData();
connect();
console.log("Ice Kyubs v2 starting...");
