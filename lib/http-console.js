
var http = require('http'),
    fs = require('fs'),
    events = require('events'),
    queryString = require('querystring'),
    readline = require('readline'),
    sys = require('sys');

require('./ext');

try {
    var inspect = require('eyes').inspector();
} catch (e) {
    var inspect = function (obj) { sys.puts(sys.inspect(obj).white) }
}

var consoles = [];

this.Console = function (host, port, options) {
    this.host = host;
    this.port = port;
    this.options = options;
    this.path = [];
    this.socket = null;
    this.cookies = {};
    consoles.push(this);
};

this.Console.prototype = new(function () {
    this.initialize = function () {
        var that = this;

        this.welcome();

        this.socket  = http.createClient(this.port, this.host, this.options.useSSL);
        this.headers = { 'Accept':'*/*' };

        this.stdin    = process.openStdin();
        this.readline = readline.createInterface(this.stdin, this.stdin.fd < 3);

        this.readline.addListener('line', function (cmd) {
            that.exec(cmd.trim());
        }).addListener('close', function () {
            process.stdout.write('\n');
            process.exit(0);
        });

        //this.stdin.setEncoding('utf8');
        this.stdin.addListener('data', function (str) {
            that.readline.write(str);
        });

        this.prompt();

        return this;
    };
    this.welcome = function () {
        sys.puts("> " + ("http-console " + exports.version).bold,
                 "> Welcome, enter \\help if you're lost.",
                 "> Connecting to " + this.host + " on port " + this.port + '.');
        sys.print('\n');
    };
    this.isConnected = function () {
        return this.socket.writeable && this.socket.readable;
    };
    this.connect = function () {
        if (! this.isConnected()) {
            // Clear the request queue.
            // Because this isn't part of the API,
            // we make sure it exists first.
            if (this.socket._outgoing) {
                this.socket._outgoing = [];
            }
            this.socket.connect(this.port, this.host);
        }
    };
    this.request = function (method, path, callback) {
        var request, that = this;

        this.connect();
        this.headers['Host'] = this.host;

        request = this.socket.request(method.toUpperCase(),
                                      path,
                                      this.headers);

        request.addListener('response', function (res) {
            var body = "";

            if (that.options.rememberCookies) { that.rememberCookies(res.headers) }
            res.addListener('data', function (chunk) { body += chunk });
            res.addListener('end',  function ()      { callback(res, body) });
        }).addListener('error', function (e) {
            sys.puts(e.toString().red);
        });

        return request;
    };
    this.exec = function (command) {
        var method, headers = {}, path = this.path, body,
            that = this,
            match;

        if (this.waitingForData) {
            this.waitingForData.write(command);
            this.waitingForData.end();
            this.waitingForData = false;
            return;
        } else if (command[0] === '/') {
            if (command === '//') {
                this.path = [];
            } else {
                Array.prototype.push.apply(
                    this.path, command.slice(1).split('/')
                );
            }
        } else if (command === '..') {
            this.path.pop();
        } else if (command[0] === '\\') {
            switch (command.slice(1)) {
                case 'headers':
                    this.printHeaders(this.headers);
                    break;
                case 'options':
                    inspect(this.options);
                    break;
                case 'cookies':
                    inspect(this.cookies);
                    break;
                case 'exit':
                case 'q':
                    process.exit(0);
            }
        } else if (match = command.match(/([a-zA-Z-]+):\s*(.*)/)) {
            if (match[2]) {
                this.headers[match[1]] = match[2];
            } else {
                delete(this.headers[match[1]]);
            }
        } else if (/^(GET|POST|PUT|HEAD|DELETE)/i.test(command)) {
            command = command.split(/\s+/);
            method  = command.shift().toUpperCase();
            path    = this.path.slice(0);

            if (command.length > 0) { path.push(command[0]) }

            path = ('/' + path.join('/')).replace(/\/+/g, '/');

            if (method === 'PUT' || method === 'POST') {
                this.waitingForData = this.request(method, path, function (res, body) {
                    that.printResponse.call(that, res, body);
                    that.prompt();
                });
                this.dataPrompt();
            } else {
                this.request(method, path, function (res, body) {
                    that.printResponse.call(that, res, body);
                    that.prompt();
                }).end();
            }
            return;
        } else if (command) {
            sys.puts(("unknown command '" + command + "'").yellow.bold);
        }
        this.prompt();
    };
    this.printResponse = function (res, body) {
        var status = ('HTTP/' + res.httpVersion +
                      ' '     + res.statusCode  +
                      ' '     + http.STATUS_CODES[res.statusCode]).bold;

        if      (res.statusCode >= 500) { status = status.red }
        else if (res.statusCode >= 400) { status = status.yellow }
        else if (res.statusCode >= 300) { status = status.cyan }
        else                            { status = status.green }

        sys.puts(status);

        this.printHeaders(res.headers);

        sys.print('\n');

        try       { inspect(JSON.parse(body)) }
        catch (_) { sys.print(body.trim().white + '\n') }
    };
    this.prompt = function () {
        var protocol = this.options.useSSL ? 'https://' : 'http://',
            path     = '/' + this.path.join('/'),
            host     = this.host + ':' + this.port,
            arrow    = '> ';

        var length = (protocol + host + path + arrow).length;

        this.readline.setPrompt((protocol + host).grey + path + arrow.grey, length);
        this.readline.prompt();
    };
    this.dataPrompt = function () {
        sys.print('... '.grey);
    };
    this.printHeaders = function (headers) {
        Object.keys(headers).forEach(function (k) {
            var key = k.replace(/\b([a-z])/g, function (_, m) {
                return m.toUpperCase();
            }).bold;
            sys.puts(key + ': ' + headers[k]);
        });
    };
    this.rememberCookies = function (headers) {
        var that = this;
        var parts, cookie, name, value;

        if ('set-cookie' in headers) {
            parts  = headers['set-cookie'].split(/; */);
            cookie = parts.shift().match(/^(.+?)=(.*)$/).slice(1);
            name   = cookie[0];
            value  = queryString.unescape(cookie[1]);

            this.cookies[name] = {
                value: value,
                options: {}
            };

            parts.forEach(function (part) {
                part = part.split('=');
                that.cookies[name].options[part[0]] = part[1];
            });
        }
        this.headers['Cookie'] = Object.keys(this.cookies).map(function (k) {
            return [k, queryString.escape(that.cookies[k].value) || ''].join('=');
        }).join(', ');
    };
});

this.version = fs.readFileSync(require('path').join(__dirname, '..', 'package.json'))
                 .toString().match(/"version"\s*:\s*"([\d.]+)"/)[1];
process.addListener('uncaughtException', function (e) {
    sys.puts(e.stack.red);
    consoles[consoles.length - 1].prompt();
});

process.addListener('exit', function () {
    consoles.forEach(function (c) {
        c.socket.destroy();
        c.stdin.destroy();
    });
    sys.print('\n');
});

