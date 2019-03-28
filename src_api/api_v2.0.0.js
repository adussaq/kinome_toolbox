(function () {
    "use strict";

    const permission = require("../src_auth/acceptedUsers.js").permission;
    const MongoClient = require('mongodb').MongoClient;
    const ObjectID = require('mongodb').ObjectID;
    const database_core = 'mongodb://localhost:27017/';
    const ID = "_id";
    const SET = "$set";
    const PUSH = "$push";

    let lib = {}, findToArray, caller, list, get, patch, post, checkPerm, connect,
            clean_request;

    clean_request = function (obj) {
        let lists = [obj], oneObj, props, i, good = true;
        while (lists.length && good) {
            oneObj = lists.shift();
            props = Object.keys(oneObj);
            for (i = 0; i < props.length && good; i += 1) {
                if (typeof oneObj[props[i]] === "object") {
                    lists.push(oneObj[props[i]]);
                }
                //check to see if there is a mongo keyword
                if (props[i].match(/^\$/)) {
                    good = false;
                }
            }
        }
        return good;
    };

    connect = (function () {
        let oneConnection, connections = {};
        oneConnection = function (database_name) {
            return new Promise(function (resolve, reject) {
                MongoClient.connect(database_core + database_name, function (err, db) {
                    if (err) {
                        reject(new Error('500: could not connect to database: ' + err));
                    } else {
                        resolve(db);
                    }
                });
            });
        };
        return function (database) {
            connections[database] = connections[database] || oneConnection(database);

            //if it failed, try a second time, just in case there was a server
                // error
            connections[database] = (function (database_name) {
                return connections[database_name].catch(function () {
                    return oneConnection(database_name);
                });
            }(database));

            return connections[database];
        };
    }());

    checkPerm = function (request, type) {
        //returns a promise which results in a permission object
        //request.params.collection
        //request.params.database

        // permission should be passed an api key if there is one, or will grab
                // the one that is in cookies if not.

        return permission(request).then(function (perm_obj) {
            if (perm_obj[type] && perm_obj[ID]) {
                return perm_obj[ID];
            }
            if (perm_obj[type] && type === "read") {
                return true;
            }
            return false;
        }).catch(function () {
            throw new Error('500: Check for authentication failed.');
        }).then(function (allowed) {
            if (allowed) {
                // return a function for updating active keys object
                return (function (id_obj) {
                        // scopes the user id/key and returns a function to be
                            // called and passed an object representing changes
                            // made by last put/post command
                    return function (update_obj) { // object to add
                        return connect('users').then(function (db) {
                            let findObj = {}, obj_update_mongo = {}, key;
                            findObj[ID] = id_obj;

                            // update_obj should be in the following form:
                                // {database: <>, collection: <>, entry_id: <>, command: <>, original_document: <>}

                            //set a time for the update
                            update_obj.time = new Date();

                            //change the changes object to sting so it does not
                                // break anything
                            if (typeof update_obj.command === "object") {
                                update_obj.command = JSON.stringify(update_obj.command);
                            }

                            //create the key for an update
                            key = "changes";//." + update_obj.database.toLowerCase() + '.' + update_obj.collection.toLowerCase() + '.' + update_obj.entry_id;

                            obj_update_mongo[PUSH] = {};
                            obj_update_mongo[PUSH][key] = update_obj;

                            return new Promise(function (resolve, reject) {
                                db.collection('active_keys').updateOne(findObj, obj_update_mongo, {}, function (err, res) {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(res);
                                    }
                                });
                            });
                        });
                    };
                }(allowed));
            }
            if (allowed) {
                return allowed;
            }
            throw new Error('401: User is not authenticated for that action.');
        });
    };

    findToArray = function (db, collection, search, limit) {
        search = search || {};
        limit = limit || {};
        return new Promise(function (resolve, reject) {
            db.collection(collection).find(search, limit).toArray(function (err, qRes) {
                if (err) {
                    reject(new Error('500: Server failed to connect to collection: ' + err));
                } else {
                    resolve(qRes);
                }
            });
        });
    };

    list = (function () {
        //scoped to declare default lists for each database
        let collection_default_find = {};
        collection_default_find[ID] = 1;

        return function (request) {
            return checkPerm(request, 'read').then(function () {
                // If I am here, I am authenticated, otherwise
                   // an error will have been thrown.
                // connect to the database
                return connect(request.params.database);
            }).then(function (db) {
                // Actually do the search
                if (request.query.all && request.query.all.toLowerCase() === "true") {
                    return findToArray(db, request.params.collection, {});
                }
                return findToArray(db, request.params.collection, {}, collection_default_find);
            }).then(function (arr) {
                return {
                    data: arr,
                    message: "Successfully connected and queried database",
                    links: {self: 'http://' + request.headers.host + request.url}
                };
            });
        };
    }());

    get = function (request) {
        return checkPerm(request, 'read').then(function () {
            // If I am here, I am authenticated, otherwise
               // an error will have been thrown.
            // connect to the database
            return connect(request.params.database);
        }).then(function (db) {
            // Actually do the search
            let search = {};
            if (request.params.database.toLowerCase() === 'kinome') {
                search[ID] = request.params.doc_id;
            } else {
                search[ID] = new ObjectID(request.params.doc_id);
            }

            return findToArray(db, request.params.collection, search);
        }).then(function (arr) {
            return {
                data: arr,
                message: "Successfully connected and queried database",
                links: {self: 'http://' + request.headers.host + request.url}
            };
        });
    };

    patch = function (request) {
        // this is to edit an old object
        return checkPerm(request, 'write').then(function (store_changes) {
            // If I am here, I am authenticated, otherwise
               // an error will have been thrown.
            // connect to the database
            return connect(request.params.database).then(function (db) {
                // insert the object
                return new Promise(function (resolve, reject) {
                    let searchObj = {}, obj_id, edit_body = {};

                    if (request.query.push === "true") {
                        edit_body[PUSH] = request.body;
                    } else {
                        edit_body[SET] = request.body;
                    }

                    //verify body is free of mongo special properties
                    if (!clean_request(request.body)) {
                        reject(new Error("403: Improperly formed body, '$' operator not allowed."));
                    }

                    //verify doc id
                    if (request.params.database.toLowerCase() === "kinome") {
                        if (request.params.doc_id.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)) {
                            obj_id = request.params.doc_id;
                        } else {
                            reject(new Error("403: Improperly formed id for database entry."));
                        }
                    } else {
                        obj_id = new ObjectID(request.params.doc_id);
                    }

                    //verify header type
                    if (request.headers["content-type"].toLowerCase() !== "application/json") {
                        reject(new Error("403: Only JSON type is accepted."));
                    } else {

                        //verified issues, actually update
                        searchObj[ID] = obj_id;

                        //find original object
                        findToArray(db, request.params.collection, searchObj).then(function (found) {

                            //update actual object
                            db.collection(request.params.collection).updateOne(searchObj, edit_body, {upsert: false}, function (err, data) {
                                if (err) {
                                    reject(new Error('500: Failed to add a new key.\n' + err.message));
                                } else {
                                    resolve({
                                        success: true,
                                        data: [data],
                                        message: "Successfully posted object",
                                        inner: {
                                            request: edit_body[SET],
                                            original_object: found[0],
                                            db: request.params.database,
                                            collection: request.params.collection,
                                            id: obj_id
                                        },
                                        links: {
                                            self: 'http://' + request.headers.host + request.url
                                        }
                                    });
                                }
                            });
                        }).catch(function (err) {
                            reject(err);
                        });
                    }
                });
            }).then(function (successful_put) {
                // data: [{ok: 1, nModified: 1, n: 1}]
                if (successful_put.data[0].modifiedCount > 0) {
                    // {database: <>, collection: <>, entry_id: <>, command: <>, original_document: <>}
                    return store_changes({
                        database: successful_put.inner.db,
                        collection: successful_put.inner.collection,
                        entry_id: successful_put.inner.id,
                        command: successful_put.inner.request,
                        original_document: successful_put.inner.original_object
                    }).then(function () {
                        delete successful_put.inner;
                        return successful_put;
                    });
                } else {
                    delete successful_put.inner;
                    return successful_put;
                }
            });
        });
    };

    post = function (request) {
        // this is to add a new object
        let req_body = JSON.parse(JSON.stringify(request.body));
        return checkPerm(request, 'write').then(function (store_changes) {
            // If I am here, I am authenticated, otherwise
               // an error will have been thrown.
            // connect to the database
            return connect(request.params.database).then(function (db) {
                // insert the object
                return new Promise(function (resolve, reject) {
                    //verify body is free of mongo special properties
                    if (!clean_request(request.body)) {
                        reject(new Error("403: Improperly formed body, '$' operator not allowed."));
                    }
                    if (request.headers["content-type"].toLowerCase() !== "application/json") {
                        reject(new Error("403: Only JSON type is accepted."));
                    } else {
                        db.collection(request.params.collection).insertOne(req_body, function (err, data) {
                            if (err) {
                                reject(new Error('500: Failed to add a new key.\n' + err.message));
                            } else {
                                //data: upsertedId
                                resolve({
                                    success: true,
                                    data: [data],
                                    message: "Successfully posted object",
                                    inner: {
                                        database: request.params.database,
                                        collection: request.params.collection,
                                        command: req_body,
                                        original_document: null
                                    },
                                    links: {
                                        self: 'http://' + request.headers.host + request.url
                                    }
                                });
                            }
                        });
                    }
                });
            }).then(function (successful_post) {
                let ret = successful_post.data[0].toJSON();
                ret.id = successful_post.data[0].insertedId;

                // successful_put.data[0].id = successful_put.data[0].upsertedId;
                // data: [{ok: 1, nModified: 1, n: 1}]
                if (successful_post.data[0].insertedCount > 0) {
                    // {database: <>, collection: <>, entry_id: <>, command: <>, original_document: <>}
                    return store_changes({
                        database: successful_post.inner.database,
                        collection: successful_post.inner.collection,
                        entry_id: successful_post.data[0].insertedId,
                        command: successful_post.inner.command,
                        original_document: successful_post.inner.original_object
                    }).then(function () {
                        delete successful_post.inner;
                        successful_post.data[0] = ret;
                        return successful_post;
                    });
                } else {
                    delete successful_post.inner;
                    successful_post.data[0] = ret;
                    return successful_post;
                }
            });
        });
    };

    caller = function (func) {
        return function (request, response, next) {
            return func(request).then(function (res) {
                response.send(res);
                return next();
            }).catch(function (err) {
                //default error message
                let code = "500";
                console.error(err);
                if (err.message.match(/^(\d{3}):/)) {
                    code = err.message.replace(/^(\d{3}):[\s\S]+/, "$1");
                }

                //send it back with the code and the object
                response.send(code * 1, {
                    error: {
                        code: code,
                        message: err.message
                    }
                });
                return next();
            });
        };
    };

    lib = {
        list: caller(list),
        get: caller(get),
        patch: caller(patch),
        post: caller(post)
    };

    module.exports = lib;

    return false;
}());