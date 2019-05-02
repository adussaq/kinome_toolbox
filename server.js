(function () {
    'use strict';

    /**************************************************************************/
    // Set this to false for installations, specifically created to allow
        // access to UAB SAML authentication mechanism for privileged data
        // access and editing.
    var addUABAuth = false;
    /**************************************************************************/

    /*The following is for the external db*/

    var restify = require('restify'),
        serverObj = {
            '1.0.0': require("./src_api/server_library.js"),
            '2.0.0': require("./src_api/api_v2.0.0.js")
        },
        auth,
        users,
        cookieParser;

    if (addUABAuth) {
        auth = require("./src_auth/saml_auth2.js");
        users = require("./src_auth/acceptedUsers.js");
        cookieParser = require('restify-cookies');
    } else {
        // This will just return a basic use object for use with the v2 API
        users = {};
        users.permission = require("./src_auth/acceptedUsers.js").permission;
    }

    //, ObjectId = require('mongodb').ObjectID;

    //Needs to impliment aggregate stuff (https://docs.mongodb.com/manual/reference/operator/aggregation/)
    //Need to impliment mapreduce stuff
    //Need to impliment projection stuff

    //Good source for operators:
    // https://docs.mongodb.com/manual/reference/operator/
    //I am making sure to not allow any operators that can change the documents
    // this is to ensure that this remains a query only server

    //sets up the server stuff
    // var server1 = restify.createServer({
    //     accept: ['application/json', 'image/tif', 'image/png']
    // });
    // server1.use(restify.queryParser());
    // server1.use(restify.CORS({}));

    // server1.get(/\/img\/kinome\/?.*/, restify.serveStatic({
    //     directory: "/var/www"
    // }));

    // //http://138.26.31.155:8000/img/kinome/631308613_W1_F1_T200_P154_I1313_A30.tif

    // /*the following is for the internal db (accesible as a registered UAB user only)*/
    // server1.get("/db/:db_name/:collection_name", grabDbName);
    // server1.get("/db/:db_name/:collection_name/:doc_id", grabDocument);
    // server1.listen(8000, function () {
    //     console.log('%s listening at %s', server1.name, server1.url);
    // });


    /*

        This file is for the general external server. Use this to make your own
        server.

    */

    var server = restify.createServer({
        accept: ['application/json']
    });
    server.use(restify.queryParser());
    server.use(restify.bodyParser());
    server.use(restify.CORS({credentials: true}));

    if (addUABAuth) {
        server.use(cookieParser.parse);
    }

    //static serving of flat files
    server.get(/\/img\/kinome\/?.*/, restify.serveStatic({
        directory: "/var/www"
    }));
    server.get(/\/file\/?.*/, restify.serveStatic({
        directory: "/var/www/global_files"
    }));



    /*The following is for the internal db*/
    server.get("/1.0.0/:collection_name", serverObj["1.0.0"].grabDbName);
    server.get("/1.0.0/:collection_name/:doc_id", serverObj["1.0.0"].grabDocument);

    /////////////////
    // API v 2.0.0 //
    /////////////////

    // databse/collection methods
    server.get("/2.0.0/:database/:collection", serverObj["2.0.0"].list);
    server.post("/2.0.0/:database/:collection", serverObj["2.0.0"].post);

    // database/collection/document methods
    server.get("/2.0.0/:database/:collection/:doc_id", serverObj["2.0.0"].get);
    server.patch("/2.0.0/:database/:collection/:doc_id", serverObj["2.0.0"].patch);

    // check permissions (if no auth mechanism is in place, this will return
    //  default settings in src_auth/acceptedUsers)
    server.get('/auth/:database/:collection', function (req, res, next) {
        users.permission(req).then(function (perms) {
            res.send(perms);
        }).catch(function (err) {
            var code = "500";
            console.log(err);
            if (err.message.match(/^(\d{3}):/)) {
                code = err.message.replace(/^(\d{3}):[\s\S]+/, "$1");
            }

            //send it back with the code and the object
            res.send(code * 1, {
                error: {
                    code: code,
                    message: err.message
                }
            });
        });
        return next();
    });

    //lists the permissions (temporary)
    server.get("/test", function (req, res, next) {
        users.permission(req).then(function (perms) {
            if (perms.email) {
                res.send({logged_in: true, data: [perms], message: "Based on Cookies this user is logged in."});
            } else {
                res.send({logged_in: false, resp: perms, message: "Based on Cookies this user is not logged in."});
            }
            return next();
        });
    });

    /////////////////
    // v 2.0.0 END //
    /////////////////

    // Login parameters
    if (addUABAuth) {
        server.get("/login", auth.login);
        server.post("/login/callback", auth.post_token(users.new_login));
        server.get("/metadata", auth.metadata);
    }

    // Listen
    server.listen(8000, function () {
        console.log('%s listening at %s', server.name, server.url);
    });

}());
