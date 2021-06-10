
const http = require('http'),
      https = require('https'),
      fs = require('fs'),
      queryString = require('querystring'),
      readline = require('readline'),
      process = require('process'),
      sys = require('util');

require('./ext');

let inspect = null;

try {
    inspect = require('eyes').inspector({ maxLength: -1 });
} catch (e) {
    inspect = function (obj) { console.log(sys.inspect(obj).white) }
}

var consoles = [];

this.Console = function (host, port, options) {
    this.host = host;
    this.port = parseInt(port);
    this.options = options;
    this.timeout = this.options.timeout ? 5000 : 0;
    this.path = [];
    this.socket = null;
    this.cookies = {};
    consoles.push(this);
};

this.Console.prototype = new(function () {
    this.initialize = function () {
        var that = this;

        this.welcome();

        this.headers = { 'Accept': '*/*' };

        if (this.options.json) {
            this.headers['Accept'] = 'application/json';
            this.headers['Content-Type'] = 'application/json';
        }

        if (this.options.auth) {
            this.headers['Authorization'] = "Basic " +
                Buffer.from(this.options.auth.username + ':' + this.options.auth.password).toString('base64');
        }

        this.readline = readline.createInterface(process.stdin, process.stdout);

        this.readline.on('line', function (cmd) {
            that.exec(cmd.trim());
        }).on('close', function () {
            process.stdout.write('\n');
            process.exit(0);
        });

        this.loadConfig();

        this.prompt();

        return this;
    };

    /**
     * Finds and runs http-console commands on start up
     *
     * The three locations checked are, in order:
     *
     *   1. /etc/.http-console
     *   2. $HOME/.http-console
     *   3. $PWD/.http-console
     *
     * Commands found in later files overwrite previous ones. Examples of
     * commands run:
     *
     *   Content-Type: application/json
     *   Authorization: AWS AKIAIOSFODNN7EXAMPLE:frJIUN8DYpKDtOLCwo//yllqDzg=
     *
     */
    this.loadConfig = function() {
        var that  = this;
        var file  = '/.http-console';
        var paths = [
            '/etc' + file,
            process.env['HOME'] + file,
            process.cwd() + file
        ];

        paths.forEach(function(path) {
            if (fs.existsSync(path)) {
                var data  = fs.readFileSync(path, 'utf-8');
                var lines = data.split("\n");
                lines.forEach(function(line) {
                    if (line.trim() != '') {
                        that.exec(line);
                    }
                })
            }
        });
    };

    this.welcome = function () {
        process.stdout.write("> " + ("http-console " + exports.version).bold + '\n' +
                             "> Welcome, enter .help if you're lost." + '\n' +
                             "> Connecting to " + this.host + " on port " + this.port + '.\n\n');
    };
    this.request = function (method, path, headers, callback) {
        var request, that = this;

        this.headers['Host'] = this.host;

        for (var k in this.headers) { headers[k] = this.headers[k] }

        method = method.toUpperCase();
        path   = encodeURI(path);

        if (this.options.verbose) {
            console.log('> ' + (method + ' ' + path).grey);
        }

        this.setCookies(headers);

        request = (this.options.useSSL ? https : http).request({
            host:    that.host,
            port:    that.port,
            method:  method,
            path:    path,
            headers: headers
        }, function (res) {
            var body = "";

            res.setEncoding('utf8');

            if (that.options.rememberCookies) { that.rememberCookies(res.headers) }
            res.on('data', function (chunk) { body += chunk });
            res.on('end',  function ()      { callback(res, body) });
        }).on('error', function (e) {
            console.error(e.toString().red);
            that.prompt();
        });

        return request;
    };
    this.setCookies = function (headers) {
        const that = this;
        const keys = Object.keys(this.cookies);

        if (keys.length) {
            const header = keys.filter(function (k) {
                var options = that.cookies[k].options;
                return (!options.expires || options.expires >= Date.now()) &&
                       (!options.path    || ('/' + that.path.join('/')).match(new(RegExp)('^' + options.path)));
            }).map(function (k) {
                return [k, queryString.escape(that.cookies[k].value) || ''].join('=');
            }).join(', ');
            header && (headers['Cookie'] = header);
        }
    };
    this.exec = function (command) {
        var method, headers = {}, path = this.path,
            that = this,
            match, req;

        if (this.pending) {
            req = this.request(this.pending.method, this.pending.path, {
                'Content-Length' : command.length
            }, function (res, body) {
                that.printResponse(res, body, function () {
                    that.prompt();
                });
            });
            req.write(command);
            req.end();

            return this.pending = null;
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
        } else if (command[0] === '.') {
            switch (command.slice(1)) {
                case 'h':
                case 'headers':
                    exports.merge(headers, this.headers);
                    this.setCookies(headers);
                    this.printHeaders(headers);
                    break;
                case 'default-headers':
                    this.printHeaders(this.headers);
                    break;
                case 'o':
                case 'options':
                    inspect(this.options);
                    break;
                case 'c':
                case 'cookies':
                    inspect(this.cookies);
                    break;
                case 'help':
                    console.log(exports.help);
                    break;
                case 'j':
                case 'json':
                    this.headers['Content-Type'] = 'application/json';
                    break;
                case 'exit':
                case 'quit':
                case 'q':
                    process.exit(0);
            }
        } else if (command[0] === '\\') {
            this.exec(command.replace(/^\\/, '.'));
        } else if (match = command.match(/^([a-zA-Z-]+):\s*(.*)/)) {
            if (match[2]) {
                this.headers[match[1]] = match[2];
            } else {
                delete(this.headers[match[1]]);
            }
        } else if (/^(GET|POST|PUT|PATCH|HEAD|DELETE|OPTIONS)/i.test(command)) {
            command = command.split(/\s+/);
            method  = command.shift().toUpperCase();
            path    = this.path.slice(0);

            if (command.length > 0) { path.push(command[0]) }

            path = ('/' + path.join('/')).replace(/\/+/g, '/');

            if (method === 'PUT' || method === 'POST') {
                this.pending = { method: method, path: path };
                this.dataPrompt();
            } else {
                this.request(method, path, {}, function (res, body) {
                    that.printResponse.call(that, res, body, function () {
                        that.prompt();
                    });
                }).end();
            }
            return;
        } else if (command) {
            console.log(("unknown command '" + command + "'").yellow.bold);
        }
        this.prompt();
    };
    this.printResponse = function (res, body, callback) {
        var status = ('HTTP/' + res.httpVersion +
                      ' '     + res.statusCode  +
                      ' '     + http.STATUS_CODES[res.statusCode]).bold, output;

        if      (res.statusCode >= 500) { status = status.red }
        else if (res.statusCode >= 400) { status = status.yellow }
        else if (res.statusCode >= 300) { status = status.cyan }
        else                            { status = status.green }

        console.log(status);

        this.printHeaders(res.headers);

        console.log();

        try       { output = JSON.parse(body) }
        catch (_) { output = body.trim() }

        if (typeof(output) === 'string') {
            output.length > 0 && console.log(output.white);
        } else {
            inspect(output);
        }

        // Make sure the buffer is flushed before
        // we display the prompt.
        if (process.stdout.write('')) {
            callback();
        } else {
            process.stdout.on('drain', function () {
                callback();
            });
        }
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
        var prompt = '... ';
        this.readline.setPrompt(prompt.grey, prompt.length);
        this.readline.prompt();
    };
    this.printHeaders = function (headers) {
        Object.keys(headers).forEach(function (k) {
            var key = k.replace(/\b([a-z])/g, function (_, m) {
                return m.toUpperCase();
            }).bold;
            console.log(key + ': ' + headers[k]);
        });
    };
    this.rememberCookies = function (headers) {
        var that = this;
        var parts, cookie, name, value;

        if ('set-cookie' in headers) {
            headers['set-cookie'].forEach(function (c) {
                parts  = c.split(/; */);
                cookie = parts.shift().match(/^(.+?)=(.*)$/).slice(1);
                name   = cookie[0];
                value  = queryString.unescape(cookie[1]);

                cookie = that.cookies[name] = {
                    value: value,
                    options: {}
                };

                parts.forEach(function (part) {
                    part = part.split('=');
                    cookie.options[part[0]] = part.length > 1 ? part[1] : true;
                });

                if (cookie.options.expires) {
                    cookie.options.expires = new(Date)(cookie.options.expires);
                }
            });
        }
    };
});

this.version = fs.readFileSync(require('path').join(__dirname, '..', 'package.json'))
                 .toString().match(/"version"\s*:\s*"([\d.]+)"/)[1];

this.help = [
    '.h[eaders]  ' +  'show active request headers.'.grey,
    '.o[ptions]  ' +  'show options.'.grey,
    '.c[ookies]  ' +  'show client cookies.'.grey,
    '.j[son]     ' +  'set \'Content-Type\' header to \'application/json\'.'.grey,
    '.help       ' +  'display this message.'.grey,
    '.q[uit]     ' +  'exit console.'.grey
].join('\n');

this.merge = function (target /*, objects... */) {
    var args = Array.prototype.slice.call(arguments, 1);

    args.forEach(function (a) {
        var keys = Object.keys(a);
        for (var i = 0; i < keys.length; i++) {
            target[keys[i]] = a[keys[i]];
        }
    });
    return target;
};

process.on('uncaughtException', function (e) {
    console.log(e.stack.red);
    consoles[consoles.length - 1].prompt();
});

process.on('exit', function () {
    consoles.forEach(function (c) {
        // TODO: Cleanup
    });
    console.log();
});

