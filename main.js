const { program } = require('commander');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const fsBase = require('fs');

program
    .requiredOption('-h, --host <host>', 'server host')
    .requiredOption('-p, --port <port>', 'server port', parseInt)
    .requiredOption('-c, --cache <path>', 'cache directory path');

program.parse(process.argv);

const options = program.opts();

function getHttpCodeFromUrl(url) {
    const match = url.match(/^\/(\d{3})$/);
    return match ? match[1] : null;
}

function getCacheFilePath(code) {
    return path.join(options.cache, `${code}.jpeg`);
}

async function setupCache() {
    try {
        await fs.mkdir(options.cache, { recursive: true });
        console.log(`cache directory '${options.cache}' created`);
    } catch (err) {
        console.error(`error creating cache directory: ${err.message}`);
        process.exit(1);
    }
}

async function handleGet(code, res) {
    const filePath = getCacheFilePath(code);

    try {
        const readStream = fsBase.createReadStream(filePath);

        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Cache': 'HIT' });
        console.log(`[GET ${code}] Image served from cache (200 OK).`);
        readStream.pipe(res);

        readStream.on('error', (streamErr) => {
            console.error(`[GET ${code}] Stream error: ${streamErr.message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error during file streaming.');
            } else {
                res.end();
            }
        });

    } catch (err) {
        if (err.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain' }); 
            res.end(`Not Found: Image for code ${code} not in cache.`);
            console.log(`[GET ${code}] Image not found (404 Not Found).`);
        } else {
            console.error(`[GET ${code}] Error reading from cache: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error while reading from cache.');
        }
    }
}

async function handlePut(code, req, res) {
    const filePath = getCacheFilePath(code);
    const chunks = [];

    try {
        for await (const chunk of req) {
            chunks.push(chunk);
        }
    } catch (err) {
        console.error(`[PUT ${code}] Error reading request body: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error.');
        return;
    }

    const imageBuffer = Buffer.concat(chunks);

    if (imageBuffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: Image body is empty.');
        return;
    }

    try {
        await fs.writeFile(filePath, imageBuffer); 
        res.writeHead(201, { 'Content-Type': 'text/plain' }); 
        res.end(`Created: Image for code ${code} saved/replaced in cache.`);
        console.log(`[PUT ${code}] Image saved/replaced (201 Created).`);
    } catch (err) {
        console.error(`[PUT ${code}] Error saving file: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error while saving file.');
    }
}

async function handleDelete(code, res) {
    const filePath = getCacheFilePath(code);

    try {
        await fs.unlink(filePath); 
        
        res.writeHead(200, { 'Content-Type': 'text/plain' }); 
        res.end(`OK: Image for code ${code} deleted from cache.`);
        console.log(`[DELETE ${code}] Image deleted (200 OK).`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain' }); 
            res.end('Not Found: Image not in cache.');
            console.log(`[DELETE ${code}] Image not found (404 Not Found).`);
        } else {
            console.error(`[DELETE ${code}] Error deleting file: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error while deleting file.');
        }
    }
}

async function startServer() {
    await setupCache();
    
    const server = http.createServer((req, res) => {
        const httpCode = getHttpCodeFromUrl(req.url);
        
        if (!httpCode) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Invalid URL format. Use /XXX where XXX is a 3-digit HTTP code.');
            return;
        }

        console.log(`Request: ${req.method} ${req.url}`);

        switch (req.method) {
            case 'GET':
                handleGet(httpCode, res);
                break;
            case 'PUT':
                handlePut(httpCode, req, res);
                break;
            case 'DELETE':
                handleDelete(httpCode, res);
                break;
            default:
                res.writeHead(405, { 'Content-Type': 'text/plain' }); 
                res.end('Method Not Allowed');
            }
    });

    server.listen(options.port, options.host, () => {
        console.log(`

  Server running at http://${options.host}:${options.port}
  Cache: ${options.cache}

        `);
    });
}

startServer();