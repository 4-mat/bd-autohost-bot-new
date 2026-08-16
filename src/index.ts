import { connect } from "./connection.js";
import "./parser.js";
import { loadGameData } from "./data/index.js";
import { loadGameData43 } from "./data/version43.js";
import { loadRecords } from "./records.js";

loadGameData();
loadGameData43();
loadRecords();
connect();
console.log("Ice Kyubs v2 starting...");
