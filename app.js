const express = require('express');
const app = express();

app.get("/database.csv", (req, res) => {
    res.end(req.url);
});

app.listen("8080", () => {
    console.log("Server listening on 8080");
});