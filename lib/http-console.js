
var http = require('http'),
    events = require('events'),
    sys = require('sys');

var inspect = require('eyes').inspector();
var consoles = [];

this.Console = function (host, port, options) {
    this.host = host;
    this.port = port;
    this.options = options;
    this.path = [];
    this.socket = null;
    consoles.push(this);
};

this.Console.prototype = new(function () {
    this.initialize = function () {
        var that = this;

        this.socket  = http.createClient(this.port, this.host);
        this.headers = { 'Accept':'*/*' };

        this.stdin = process.openStdin();
        this.stdin.setEncoding('ascii');
        this.stdin.addListener('data', function (str) {
            that.exec(str.trim());
        });
        this.prompt();

        return this;
    };
    this.request = function (method, path, callback) {
        var request;

        this.headers['Host'] = this.host;

        request = this.socket.request(method.toUpperCase(),
                                      path.replace('//', '/'),
                                      this.headers);

        request.addListener('response', function (res) {
            var body = "";
            res.addListener('data', function (chunk) { body += chunk });
            res.addListener('end',  function ()      { callback(res, body) });
        });

        return request;
    };
    this.exec = function (command) {
        var method, headers = {}, path = this.path, body,
            that = this;

        if (this.waitingForData) {
            this.waitingForData.write(command);
            this.waitingForData.end();
            this.waitingForData = false;
            return;
        } else if (command[0] === '/') {
            Array.prototype.push.apply(
                this.path, command.split('/').filter(function (e) { return e })
            );
        } else if (command === '..') {
            this.path.pop();
        } else if (command[0] === '\\') {
            switch (command.slice(1)) {
                case 'headers':
                    this.printHeaders(this.headers);
                    break;
            }
        } else if (match = command.match(/([a-zA-Z-]+):\s*(.*)/)) {
            if (match[2]) {
                this.headers[match[1]] = match[2];
            } else {
                delete(this.headers[match[1]]);
            }
        } else if (/^(GET|POST|PUT|HEAD|DELETE)/.test(command)) {
            command = command.split(/\s+/);
            method  = command.shift();
            path    = '/' + this.path.concat(command.shift()).join('/');

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
        else                            { status = status.green }

        sys.puts(status);

        this.printHeaders(res.headers);

        sys.print('\n');

        try       { inspect(JSON.parse(body)) }
        catch (_) { sys.print(body.trim().cyan + '\n') }
    };
    this.prompt = function () {
        sys.print(('http://' + this.host + ':' + this.port + '/' + this.path.join('/') + '> ').grey);
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
});

process.addListener('uncaughtException', function (e) {
    sys.puts(('Error: ' + e.message).red);
    process.exit(-1);
});

process.addListener('exit', function () {
    consoles.forEach(function (c) {
        c.socket.destroy();
    });
    sys.print('\n');
});

['bold', 'grey', 'yellow', 'green', 'cyan'].forEach(function (style) {
    Object.defineProperty(String.prototype, style, {
        get: function () {
            return stylize(this, style);
        }
    });
});


function stylize(str, style) {
    var styles = {
        'bold'      : [1,  22],
        'italic'    : [3,  23],
        'underline' : [4,  24],
        'yellow'    : [33, 39],
        'cyan'      : [37, 39],
        'green'     : [32, 39],
        'red'       : [31, 39],
        'grey'      : [90, 39],
    };
    return '\033[' + styles[style][0] + 'm' + str +
           '\033[' + styles[style][1] + 'm';
};
