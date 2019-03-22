/*global*/
(function () {
    'use strict';

    let new_login, findToArray, sendError, valid_token, check_for_permissions, mcl, addNewKey, approved;

    const MongoClient = require('mongodb').MongoClient;
    const database = 'mongodb://localhost:27017/users';
    const ID = "_id";
    const ObjectID = require('mongodb').ObjectID;

    sendError = function (res, next) {
        return function (err) {
            //default error message
            let code = "500";
            console.log(err, "here with 401 catch");
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
            return next();
        };
    };

    findToArray = function (db, collection, search) {
        return new Promise(function (resolve, reject) {
            db.collection(collection).find(search).toArray(function (err, qRes) {
                if (err) {
                    reject(new Error('500: Server failed to connect to collection: ' + err));
                } else {
                    resolve(qRes);
                }
            });
        });
    };

    mcl = new Promise(function (resolve, reject) {
        MongoClient.connect(database, function (err, db) {
            if (err) {
                reject(err);
            } else {
                resolve(db);
            }
        });
    });

    addNewKey = function (db, username, perms) {
        return new Promise(function (resolve, reject) {
            let now = new Date(), tomorrow = new Date(now * 1 + 24 * 60 * 60 * 1000);
            db.collection('active_keys').insertOne({
                email: username,
                start: now,
                stop: tomorrow,
                permissions: perms
            }, function (err) {
                if (err) {
                    reject(new Error('500: Failed to add a new key.\n' + err.message));
                } else {
                    resolve('');
                }
            });
        });
    };

    valid_token = function (token_obj) {
        let now = new Date(), ret = false;
        if (typeof token_obj === "object" && token_obj.start && token_obj.stop && new Date(token_obj.start) < now && new Date(token_obj.stop) > now) {
            ret = true;
        }
        return ret;
    };

    approved = function (db, username, perms, redirect, tag, req, res, next) {
        let col_active_keys = db.collection('active_keys');
        findToArray(db, "active_keys", {email: username}).then(function (qRes) {
            let tempObj;

            // Approved, but no functional key
            if (qRes.length === 0) {
                // add to the database, then call this function again
                return addNewKey(db, username, perms).then(function () {
                    return approved(db, username, perms, redirect, tag, req, res, next);
                });
            }

            // Approved and has a functional key
            if (qRes.length === 1) {
                // make sure the token is still in range
                if (valid_token(qRes[0])) {
                    //Save as a cookie
                    res.setCookie('api_key', qRes[0][ID], {
                        path: '/',
                        domain: 'db.kinomecore.com',
                        httpOnly: true,
                        maxAge: 60 * 60 * 24 * 2
                    });
                    if (!redirect) {
                        res.send({
                            links: {
                                self: 'http://db.kinomecore.com/login'
                            },
                            data: [{
                                message: "Logged in, API key will expire on " + new Date(qRes[0].stop).toLocaleString(),
                                api_key: qRes[0][ID]
                            }]
                        });
                        return next();
                    }

                    // There is a redirect link, set up an additional url parameter
                    if (tag === "true") {
                        if (redirect.match(/\?/)) {
                            redirect = redirect + "&apiKey=" + qRes[0][ID];
                        } else {
                            redirect = redirect + "?apiKey=" + qRes[0][ID];
                        }
                    }

                    // Actually send the redirect
                    res.redirect(redirect, next);
                } else {
                    // delete key, recreate it then recall this function
                    tempObj = {};
                    tempObj[ID] = new ObjectID(qRes[0][ID]);
                    return new Promise(function (resolve, reject) {
                        col_active_keys.deleteOne(tempObj, {}, function (err) {
                            if (err) {
                                reject(new Error('500: Failed to delete expired key.'));
                            }
                            resolve();
                        });
                    }).then(function () {
                        return approved(db, username, perms, redirect, tag, req, res, next);
                    });
                }
            } else {
                throw new Error("500: Multiple API keys found");
            }
        });
    };

    new_login = function (username, redirect, tag, req, res, next) {
        // make sure the connection is open
        mcl.then(function (db) {
            // it is open, check if person is white listed
            return findToArray(db, "accepted", {email: username}).then(function (qRes) {
                if (qRes.length === 1) {
                    // person exists and there are no duplicates
                    return approved(db, username, qRes[0].permissions, redirect, tag, req, res, next);
                } else {
                    // person does not exist or there are duplicates
                    console.log('here with 401');
                    throw new Error("401: Username not found, please contact administrator to add your name to the list of accepted users.");
                }
            });
        }).catch(sendError(res, next));
        return [req, res, next];
    };

    check_for_permissions = function (req, key) {
        //check cookies for key
        let searchTerm, ret, basePerms = {
            permissions: [{
                database: 'kinome',
                collections: [
                    {name: 'lvl_1.0.0', read: true, write: false},
                    {name: 'lvl_1.0.1', read: true, write: false},
                    {name: 'lvl_1.1.2', read: true, write: false},
                    {name: 'lvl_2.0.1', read: true, write: false},
                    {name: 'lvl_2.1.2', read: true, write: false},
                    {name: 'name', read: true, write: false}
                ]
            }],
            email: false
        };

        ret = Promise.resolve(basePerms);

        if (!key) {
            if (req.hasOwnProperty("cookies") && req.cookies.hasOwnProperty("api_key")) {
                key = req.cookies.api_key;
            }
        }

        if (key) {
            searchTerm = {};
            searchTerm[ID] = new ObjectID(key);
            ret = mcl.then(function (db) {
                return new Promise(function (resolve) {
                    db.collection('active_keys').find(searchTerm).toArray(function (err, qRes) {
                        if (err || qRes.length !== 1 || !(valid_token(qRes[0]))) {
                            resolve(basePerms);
                        }
                        resolve(qRes[0]);
                    });
                });
            });
        }
        return ret;
    };

    module.exports = {
        new_login: new_login,
        permission: check_for_permissions
    };

}());