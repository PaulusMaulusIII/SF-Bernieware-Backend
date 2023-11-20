const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require('crypto');
const fs = require("fs");
const port = process.env.PORT || 3001;

//TODO: Switch handling from lines to IDs

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); //Gestattet Zugriff von der Hauptseite auf den POST Handler
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE"); //Erlaubt die genannten methoden, die sonst von CORS blockiert werden
    res.setHeader("Access-Control-Allow-Headers", "Content-Type"); //Erlaubt Content-Type Header

    if (req.method === "OPTIONS") { //Wenn client OPTIONS anfordert
        res.writeHead(204); //Antworte "Success, no content"
        res.end();
        return;
    } else if (req.method === "GET") {
        if (req.url === "/database.csv") {
            res.writeHead(200, { "Content-Type": "basic" }); //Sende "erfolgreich"
            res.end(fs.readFileSync("database.csv", "utf-8"));
        } else if (req.url === "/categories") {
            let categories = fs.readdirSync("Kategorien");
            console.log(categories);
            try {
                categories = categories.map(element => element.replace("-ae-", "ä").replace("-ue-", "ü").replace("-oe-", "ö").replace("-sz-", "ß"));
            } catch (error) {
                console.log(error);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: categories }));
        } else if (req.url.endsWith(".jpg")) {
            let url = req.url.split("/");
            url = url.filter((element, index) => index != 0);
            url = url.reduce((prev, curr) => prev + "/" + curr);
            if (fs.existsSync(url)) {
                let img = fs.readFileSync(url);
                res.writeHead(200, { "Content-Type": "image/jpeg" });
                res.end(img);
            } else {
                res.writeHead(404, "Not Found");
                res.end();
            }
        } else if (req.url === "/orderDate") {
            let orderTime = new Date;
            orderTime = fs.readFileSync("order.time");

            res.writeHead(200, { "Content-Type": "text" });
            res.end(orderTime.toString());
        } else {
            res.writeHead(404, "Not Found");
            res.end();
        }
    } else if (req.method === "POST" && req.url === "/submit") { //Wenn eine Bestellung gespeichert werden soll
        let body = "";
        req.on("data", (data) => { //Sobald daten ankommen
            body += data; //Werden sie an den body angehängt
        });
        req.on("end", () => { //Sobald die Übertragung vollständig ist
            const postData = JSON.parse(body); //Werden die übertragenen Daten von einem SJON String in ein Objekt geparsed
            const { file, surname, name, course, email, items } = postData; //Dieses Dekonstruiert
            const id = crypto.randomUUID();

            fs.appendFile(file, id + "\t" + surname + "\t" + name + "\t" + course + "\t" + email + "\t" + items + "\n", (err) => { // Und der Inhalt korrekt formatiert in eine tsv datei gespeichert
                if (err) {
                    console.error(err);
                    res.writeHead(500, { "Content-Type": "application/json" }); //Falls die Datei nicht gelesen werden kann, sende Fehlermeldung
                    res.end(JSON.stringify({ success: false, id: 0 })); //Sende keine daten
                } else {
                    console.log(`Order "${id}" saved to ${file}`);
                    res.writeHead(200, { "Content-Type": "application/json" }); //Sende "Erfolgreich"
                    res.end(JSON.stringify({ success: true, id: id })); //Sende die ID an den client 
                }
            });
        });
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" }); //Falls keine dieser Methoden genutzt wird, wird die Anfrage stilecht mit einem 404 beantwortet
        res.end("Not Found");
    }
});

const wss = new WebSocketServer({ server });
let clients = new Set(); //Liste aller Nutzer
let watchlist = new Set(); //Liste aller Dateien von denen Nutzer Updates erhalten sollen

wss.on("connection", (ws) => { //Wenn ein nutzer sich verbindet
    console.log("Client connected");

    ws.on("message", (message) => { //Wenn der WSS eine Nachricht erhält
        const messageObj = JSON.parse(message); //Parse die Nachricht zu eine JSON Objekt

        console.log(`Received: ${message}`);

        const { file, method, data } = messageObj; //Dekonstruiere dieses
        let orders = fs.readFileSync(file, "utf8").split("\n"); //Orders ist eine tabelle die as jeder row der tsv besteht
        console.log(orders);

        if (method === "SUB") { //Wenn der nutzer updates zu einer datei erhalten möchte
            clients.add(ws); //füge ihn zu clients hinzu
            const data = fs.readFileSync(file, "utf-8"); //lese die datei ein

            if (!watchlist.has(file)) { //Falls die datei nicht bereits auf der watchlist ist
                watchlist.add(file); //Tue sie auf die watchlist

                let fileContent = fs.readFileSync(file, "utf8"); // der inhalt der datei zum zeitpunkt der ergänzung auf die watchlist
                let fileSize = fileContent.split("\n").length; // die zahl der rows zum zeitpunkt der ergänzung zur watchlist
                fs.watchFile(file, (curr, prev) => { //löst callback bei jeder änderung der datei aus
                    if (curr.mtime > prev.mtime) { //Wenn es zu einer relevanten änderung kommt
                        const content = fs.readFileSync(file, 'utf8'); //lese den neuen inhalt der datei ein
                        let newFileSize = content.split("\n").length, //und die neue länge der datei
                            sizeDiff = newFileSize - fileSize;

                        if (sizeDiff > 0) { // falls die neue datei mehr zeilen hat als die alte //FIXME: When there are additions AND changes the handler notes the changes as additions
                            fileContent = fileContent.split("\n");
                            let addedContent = content.split("\n").filter(element => !fileContent.includes(element)); //Gibt uns nur die Zeilen die NICHT in der alten version vorhanden sind
                            addedContent = addedContent.map(element => [content[(content.split("\n").indexOf(element) - 1)].split("\t")[0], element]); //ERgänzt die zeile, in der die änderungen vorkommmen
                            clients.forEach((client) => { //Sende an jeden client
                                client.send(JSON.stringify({ successful: true, method: "ADD", data: addedContent })); //Erfolgreich, "neuer Inhalt", Inhalt
                                console.log(`Updated Client listening for changes to ${file}\n Added ${addedContent}`);
                            });
                        } else if (sizeDiff < 0) { //Falls die alte datei länger ist als die neue
                            let newFileContent = content.split("\n");
                            let deletedContent = fileContent.split("\n").filter(element => !newFileContent.includes(element)); //Gibt uns nur die zeilen die in der neuen version fehlen
                            console.log(deletedContent);
                            deletedContent = deletedContent.map(element => element.split("\t")[0]);
                            console.log(deletedContent);
                            clients.forEach((client) => {
                                client.send(JSON.stringify({ successful: true, method: "REM", data: deletedContent })); //ERfolgreich, "Entfernt", entfernte inhalte
                                console.log(`Updated Client listening for changes to ${file}\n Removed ${deletedContent}`);
                            });
                        } else if (sizeDiff == 0) {
                            fileContent = fileContent.split("\n");
                            let changedContent = content.split("\n").filter(element => !fileContent.includes(element)); //siehe ADD
                            changedContent = changedContent.map(element => [element.split("\t")[0], element]); //siehe ADD
                            clients.forEach((client) => {
                                client.send(JSON.stringify({ successful: true, method: "CHA", data: changedContent })); //siehe ADD
                                console.log(`Updated Client listening for changes to ${file}\n Changed ${changedContent}`);
                            });
                        }
                        fileSize = content.split("\n").length; //speichere jetzigen stand
                        fileContent = content;
                    }
                });
            }

            let sendData = data.split("\n");
            if (sendData[sendData.length] == "") {
                sendData.slice(0, -1)
            }

            ws.send(JSON.stringify({ successful: true, method: "NEW", data: sendData })); //sende einmalig die vollständige datei an den client
        } else if (method === "UNS") { //Falls der client keine updates mehr über eine datei erhalten möchte
            clients.delete(ws); //Entferne client von der liste
            ws.send(JSON.stringify({ successful: true, data: "" }));
            //TODO: remove file from watchlist
        } else if (method === "ADD") {
            const [content, line] = data;
            while (orders.length < line) {
                orders.push("");
            }

            orders.splice(line - 1, 0, content);
            fs.writeFileSync(file, "");
            let writer = fs.createWriteStream(file, { flags: "a" });
            orders.forEach((element, index) => {
                if (index === 0) {
                    writer.write(element);
                } else {
                    writer.write("\n" + element);
                }
            });
            writer.close();
            ws.send(JSON.stringify({ successful: true, data: "" }));
        } else if (method === "CHA") {
            const [content, line] = data;
            orders[line] = content;
            fs.writeFileSync(file, "");
            let writer = fs.createWriteStream(file, { flags: "a" });
            orders.forEach((element, index) => {
                if (index === 0) {
                    writer.write(element);
                } else {
                    writer.write("\n" + element);
                }
            });
            writer.close();
            ws.send(JSON.stringify({ successful: true, data: "" }));
        } else if (method === "REM") {
            orders = orders.filter(element => !data.includes(element));
            fs.writeFileSync(file, "");
            let writer = fs.createWriteStream(file, { flags: "a" });
            orders.forEach((element, index) => {
                if (index === 0) {
                    writer.write(element);
                } else {
                    writer.write("\n" + element);
                }
            });
            writer.close();
            ws.send(JSON.stringify({ successful: true, data: "" }));
        } else {
            ws.send(JSON.stringify({ successful: false, data: "" }));
        }
        console.log(orders);
    });

    ws.on("close", () => {
        clients.delete(ws);
        console.log("Client disconnected");
    });
});

server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});

console.log("Websocket running");