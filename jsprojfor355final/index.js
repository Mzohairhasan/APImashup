const https = require("https");
const fs = require("fs");
const http = require("http");
const url = require("url");

let access_token;
let championName = null;
let filePath = "code.txt";
const [
    {
        dropBoxClientId,
        dropBoxSecret,
        dropBoxAuthorizeEndpoint,
        redirect_uri,
    },
] = require("./auth/credentials.json");

// Create a server to listen to GET requests
const server = http.createServer((req, res) => {
    if (req.method === "GET") {
        const queryObject = url.parse(req.url, true).query;
        console.log({ queryObject });
        if (queryObject.championName) {
            championName = queryObject.championName;
            fetchChampionData(championName, res);
        } else if (queryObject.code) {
            send_access_token_request(queryObject.code, championName, res);
        } else {
            console.error("Invalid request:", queryObject);
        }
    }
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});

// Fetch champion data from the League of Legends API
function fetchChampionData(championName, clientRes) {
    const lolApiUrl = `https://ddragon.leagueoflegends.com/cdn/12.5.1/data/en_US/champion/${championName}.json`;

    https.get(lolApiUrl, (apiRes) => {
        let data = '';

        apiRes.on('data', (chunk) => { data += chunk; });
        apiRes.on('end', () => {
            if (apiRes.statusCode === 200) {
                redirectToDropbox(clientRes);
            } else {
                clientRes.end("Champion not found or API request failed.");
            }
        });
    }).on('error', (err) => {
        console.error("Request error:", err.message);
        clientRes.end("Error fetching champion data.");
    });
}

// Redirect to Dropbox for authorization
function redirectToDropbox(clientRes) {
    const endpointUrl = `${dropBoxAuthorizeEndpoint}?client_id=${dropBoxClientId}&response_type=code&redirect_uri=${redirect_uri}&token_access_type=offline`;
    clientRes.writeHead(302, { Location: endpointUrl }).end();
}

// Send access token request to Dropbox
function send_access_token_request(authorization_code, championName, clientRes) {
    const token_endpoint = "https://api.dropboxapi.com/oauth2/token";
    let post_data = new URLSearchParams({
        client_id: dropBoxClientId,
        client_secret: dropBoxSecret,
        code: authorization_code,
        grant_type: "authorization_code",
        redirect_uri: redirect_uri,
    }).toString();
    
    let options = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    };

    https.request(token_endpoint, options, (token_stream) =>
        process_stream(token_stream, receive_access_token, championName, clientRes)
    ).end(post_data);
}

// Helper function to process the token stream
function process_stream(stream, callback, ...args) {
    let body = "";
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => callback(body, ...args));
}

// Receive and process the access token
function receive_access_token(body, championName, clientRes) {
    let accessToken = JSON.parse(body).access_token;
    processChampion(championName, accessToken, clientRes); // called ONLY after receiving the access token
}

// Process champion information and upload to Dropbox
function processChampion(championName, accessToken, clientRes) {
    console.log({ championName });
    console.log({ accessToken });
    const url = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_0.jpg`;

    https.get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
            data += chunk;
        });

        res.on("end", () => {
            if (res.statusCode !== 200) {
                console.error(`API Request Failed. Status Code: ${res.statusCode}`);
                clientRes.end("Champion not found or API request failed.");
                return;
            }

            downloadImage(url, `${championName}.jpg`, () => {
                uploadToDropbox(`${championName}.jpg`, accessToken, clientRes);
            });
        });
    }).on("error", (err) => {
        console.error("Request error:", err.message);
    });
}

// Function to download the champion image
function downloadImage(url, filename, callback) {
    https.get(url, (res) => {
        const filePath = fs.createWriteStream(filename);
        res.pipe(filePath);
        filePath.on('finish', () => {
            filePath.close();
            console.log('Downloaded image:', filename);
            callback(filename); // callback function AFTER the image is downloaded
        });
    }).on('error', (e) => {
        console.error(e);
    });
}

// Function to upload the image to Dropbox
function uploadToDropbox(filename, accessToken, clientRes) {
    console.log({ accessToken: accessToken });
    const fileContent = fs.readFileSync(filename);
    const options = {
        hostname: "content.dropboxapi.com",
        path: "/2/files/upload",
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": JSON.stringify({
                path: `/${filename}`,
                mode: "add",
                autorename: true,
                mute: false,
            }),
        },
    };

    const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
            console.log("Image uploaded to Dropbox:", responseBody);
            let imgUrl = `https://www.dropbox.com/home?preview=${filename}`;
            clientRes.writeHead(302, { Location: imgUrl }).end();
        });
    });

    req.on("error", (error) => {
        console.error("Error uploading to Dropbox:", error);
    });

    req.write(fileContent);
    req.end();
}