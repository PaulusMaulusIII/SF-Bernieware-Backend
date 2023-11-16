const express = require("express");
const app = express();
const port = 8080;
const fs = require('fs');

app.get("/database.csv", (req, res) => res.type('text').send(fs.readFileSync("database.csv")));

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;