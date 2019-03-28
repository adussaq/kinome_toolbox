/*global*/
(function () {
    'use strict';

    let add_new_user, new_login, findToArray, sendError, valid_token, check_for_permissions, mcl, addNewKey, approved;

    const MongoClient = require('mongodb').MongoClient;
    const database = 'mongodb://localhost:27017/users';
    const ID = "_id";
    const ObjectID = require('mongodb').ObjectID;
    const PUSH = "$push";
    const DEFAULT_PERMS = [{
        database: 'kinome',
        collections: [
            {name: 'lvl_1.0.0', read: true, write: false},
            {name: 'lvl_1.0.1', read: true, write: false},
            {name: 'lvl_1.1.2', read: true, write: false},
            {name: 'lvl_2.0.1', read: true, write: false},
            {name: 'lvl_2.1.2', read: true, write: false},
            {name: 'name', read: true, write: false}
        ]
    }];

    sendError = function (res, next) {
        return function (err) {
            //default error message
            let code = "500";
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

    add_new_user = function (db, email) {
        return new Promise(function (resolve, reject) {
            db.collection("accepted").insertOne({
                email: email,
                permissions: DEFAULT_PERMS
            }, function (err) {
                if (err) {
                    reject(new Error("500: Failed to create user permissions. " + err.message));
                } else {
                    resolve(email);
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
                        // store the active part and delete the rest
                        let updateObj = {}, mongoObj = {}, traverseObj = qRes[0], i;
                        updateObj.time = new Date();
                        updateObj.changes = [];

                        // store the original original for all changes made in the given timeframe
                        if (traverseObj.hasOwnProperty("changes")) {

                            // sort them to find first change to a given object
                            traverseObj.changes = traverseObj.changes.sort(function (a, b) {
                                // first by database
                                let dbComp = a.database.localeCompare(b.database),
                                    colComp = a.collection.localeCompare(b.collection),
                                    idComp = a.entry_id.toHexString().localeCompare(b.entry_id.toHexString()),
                                    timeComp = a.time - b.time;
                                if (dbComp) {
                                    return dbComp;
                                }
                                if (colComp) {
                                    return colComp;
                                }
                                if (idComp) {
                                    return idComp;
                                }
                                return timeComp;
                            });

                            for (i = 0; i < traverseObj.changes.length; i += 1) {
                                // original entry checker: // i=0 OR dbs different OR collections different OR ids different
                                if (
                                    i === 0 ||
                                    traverseObj.changes[i - 1].database !== traverseObj.changes[i].database ||
                                    traverseObj.changes[i - 1].collection !== traverseObj.changes[i].collection ||
                                    traverseObj.changes[i - 1].entry_id.toHexString() !== traverseObj.changes[i].entry_id.toHexString()
                                ) {
                                    delete traverseObj.changes[i].command;
                                    delete traverseObj.changes[i].time;
                                    updateObj.changes.push(traverseObj.changes[i]);
                                }
                            }

                        }

                        // set object for actual database
                        mongoObj[PUSH] = {
                            updates: updateObj
                        };

                        db.collection('changes').update({email: qRes[0].email}, mongoObj, {upsert: true}, function (err) {
                            if (err) {
                                reject(new Error('500: Failed to store changes from expired key.'));
                            } else {
                                col_active_keys.deleteOne(tempObj, {}, function (err) {
                                    if (err) {
                                        reject(new Error('500: Failed to delete expired key.'));
                                    }
                                    resolve();
                                });
                            }
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
                    return add_new_user(db, username).then(function (uname) {
                        return approved(db, uname, DEFAULT_PERMS, redirect, tag, req, res, next);
                    });
                }
            });
        }).catch(sendError(res, next));
        return [req, res, next];
    };

    check_for_permissions = function (req, key) {
        let searchTerm, ret, basePerms = {
            permissions: DEFAULT_PERMS,
            email: false
        };

        // standard return
        ret = Promise.resolve(basePerms);

        // If no key is passed in
        if (!key) {
            if (req.query && req.query.api_key) {
                key = req.query.api_key;
            } else if (req.hasOwnProperty("cookies") && req.cookies.hasOwnProperty("api_key")) {
                key = req.cookies.api_key;
            }
        }

        //get perms based on key
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

        // if there are options for a database/collection check those
        if (req.params && req.params.database && req.params.collection) {
            ret = ret.then(function (perms) {
                let i, j, inner = {write: false, read: false};
                // look for database
                for (i = 0; i < perms.permissions.length && !inner.read; i += 1) {
                    //Correct database?
                    if (perms.permissions[i].database.toLowerCase() === req.params.database.toLowerCase()) {
                        //Look at collections
                        for (j = 0; j < perms.permissions[i].collections.length && !inner.read; j += 1) {
                            //Correct collection?
                            if (perms.permissions[i].collections[j].name.toLowerCase() === req.params.collection.toLowerCase()) {
                                // permission to read/write?
                                inner = perms.permissions[i].collections[j];
                            }
                        }
                    }
                }
                inner.email = perms.email;
                inner.collection = req.params.collection;
                inner.database = req.params.database;
                inner[ID] = perms[ID];
                return inner;
            });
        }

        return ret;
    };

    module.exports = {
        new_login: new_login,
        permission: check_for_permissions
    };

}());