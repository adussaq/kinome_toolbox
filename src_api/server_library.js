(function () {
    'use strict';

    /**************************************************************************/
    //
    // This is for API vs 1.0.0
    //
    /**************************************************************************/

    var ID = "_id", lib = {}, MongoClient = require('mongodb').MongoClient, assert = require('assert');

    var checkCollection, acceptedRegex = "", sanatize, j, grabDbName, grabDocument, respond, list,
            accepted$ = [
        "all", "and", "bitsAllClear", "bitsAllSet", "bitsAnyClear",
        "bitsAnySet", "collStats", "comment", "elemMatch",
        "eq", "exists", "explain", "geoIntersects", "geoWithin", "gt",
        "gte", "hint", "in", "limit", "lte", "match", "max", "maxScan",
        "maxTimeMS", "meta", "min", "mod", "natural", "ne", "near",
        "nearShpere", "nin", "nor", "not", "or", "orderby", "query",
        "regex", "returnKey", "showDiskLoc", "size", "skip", "slice",
        "snapshot", "text", "type", "where"
    ];


    for (j = 0; j < accepted$.length; j += 1) {
        acceptedRegex += "^\\$" + accepted$[j] + "$|";
    }
    acceptedRegex = acceptedRegex.replace(/\|$/, "");
    acceptedRegex = new RegExp(acceptedRegex, 'i');

    //define the query sanatize function
    //sanatize the query
    sanatize = function (query, ver) {
        var keys, i;
        if (typeof query === "object") {
            keys = Object.keys(query);
            for (i = 0; i < keys.length; i += 1) {
                if (keys[i].match(/^\s*\$/)) {
                    //straight up kill it if it is not an accepted type
                    if (!keys[i].match(acceptedRegex)) {
                        delete query[keys[i]];
                    }
                } else if (typeof query[keys[i]] === "object") {
                    query[keys[i]] = sanatize(query[keys[i]]);
                }
            }
        } else {
            //If it is not an object then just query it all
            // should probably generate an error message
            query = {};
        }
        return query;
    };

    checkCollection = function (collection) {
        if (
            collection.toLowerCase() === 'name' ||
            collection.toLowerCase() === 'lvl_1.0.0' ||
            collection.toLowerCase() === 'lvl_1.0.1' ||
            collection.toLowerCase() === 'lvl_1.1.2' ||
            collection.toLowerCase() === 'lvl_2.0.1' ||
            collection.toLowerCase() === 'lvl_2.1.2'
        ) {
            return true;
        }
        throw new Error("That collection is not allowed or does not exist");
    };

    grabDbName = function (request, response, ver) {
        var myDbName = request.params.db_name, query, fields, sort,
                collectionName = request.params.collection_name, url;

        checkCollection(collectionName);

        //Deal with the objects
        myDbName = 'kinome';
        url = 'mongodb://localhost:27017/' + myDbName;
        console.log('db name:', myDbName);
        request.query.find = request.query.find || "{}";
        request.query.fields = request.query.fields || "-1";
        request.query.sort = request.query.sort || "[]";

        request.query.find = decodeURIComponent(request.query.find);
        request.query.fields = decodeURIComponent(request.query.fields);
        request.query.sort = decodeURIComponent(request.query.sort);

        //Objectify them
        query = JSON.parse(request.query.find);
        query = sanatize(query);
        fields = JSON.parse(request.query.fields);
        sort = JSON.parse(request.query.sort);

        //if there is a sort option, sanatize it
        if (sort.length > 0) {
            sanatize(sort);
        }

        //Start up connection and run the query
        MongoClient.connect(url, function (err, db) {
            assert.equal(null, err);
            var spec;
            var collection = db.collection(collectionName);
            console.log("Connected successfully to server");

            //options
            var limit = request.query.limit * 1 || 9000000; //9 mil more than enough
            var skip = request.query.skip * 1 || 0;
            var maxTimeMS = request.query.maxTimeMS * 1 || 1000 * 60 * 60; //1 hr

            //special stuff
            console.log(query, fields, sort);
            if (fields === -1) {
                spec = collection.find(query, {
                    limit: limit,
                    skip: skip,
                    maxTimeMS: maxTimeMS
                });
            } else {
                spec = collection.find(query, sanatize(fields), {
                    limit: limit,
                    skip: skip,
                    maxTimeMS: maxTimeMS
                });
            }

            //run the sort operation and then return the final result
            spec.sort(sort).toArray(function (err, docs) {
                respond[ver](response, docs, err);
            });
        });
    };

    grabDocument = function (request, response, ver) {
        var myDbName = request.params.db_name, fields,
                collectionName = request.params.collection_name,
                query = {id: decodeURIComponent(request.params.doc_id)}, url;

        //Deal with the objects
        myDbName = 'kinome';
        url = 'mongodb://localhost:27017/' + myDbName;
        checkCollection(collectionName);
        request.query.fields = request.query.fields || "-1";
        request.query.fields = decodeURIComponent(request.query.fields);

        //Objectify them
        query = sanatize(query);
        fields = JSON.parse(request.query.fields);

        console.log(fields);
        //Start up connection and run the query
        MongoClient.connect(url, function (err, db) {
            assert.equal(null, err);
            var spec;
            var collection = db.collection(collectionName);
            console.log("Connected successfully to server");

            //options
            var maxTimeMS = request.query.maxTimeMS * 1 || 1000 * 60 * 60; //1 hr

            //special stuff
            console.log(query, myDbName, collectionName);
            if (fields === -1) {
                spec = collection.find({"_id": query.id}, {
                    maxTimeMS: maxTimeMS
                });
            } else {
                spec = collection.find({"_id": query.id}, sanatize(fields), {
                    maxTimeMS: maxTimeMS
                });
            }

            //run the sort operation and then return the final result
            spec.toArray(function (err, docs) {
                respond[ver](response, docs[0], err);
            });
        });
    };

    list = function (request, response, ver) {
        var myDbName, url, query, fields,
                collectionName = request.params.collection_name;
        //Deal with the objects
        myDbName = 'kinome';
        url = 'mongodb://localhost:27017/' + myDbName;

        //Objectify them
        query = {};
        fields = {"_id": 1};
        checkCollection(collectionName);

        //Start up connection and run the query
        MongoClient.connect(url, function (err, db) {
            assert.equal(null, err);
            var spec;
            var collection = db.collection(collectionName);

            //options
            var limit = 9000000; //9 mil more than enough
            var skip = 0;
            var maxTimeMS = 1000 * 60 * 60; //1 hr

            spec = collection.find(query, fields, {
                limit: limit,
                skip: skip,
                maxTimeMS: maxTimeMS
            });

            //run the sort operation and then return the final result
            spec.toArray(function (err, docs) {
                if (Array.isArray(docs)) {
                    docs = docs.map(function (doc) {
                        return "http://db.kinomecore.com/2.0.0/" + collectionName + "/" + doc[ID];
                    });
                }
                respond[ver](response, docs, err);
            });
        });
    };

    //Respond functions (internal only)
    respond = {};
    respond["1.0.0"] = function (response, data, error) {
        if (error) {
            assert.equal(error, null);
        } else {
            response.send(data);
        }
    };
    respond["2.0.0"] = function (response, data, error) {
        if (error) {
            response.send({error: true, message: error});
        } else {
            if (!Array.isArray(data)) {
                data = [data];
            }
            response.send({error: false, message: null, data: data});
        }
    };

    lib = {
        grabDbName: function (request, response) {
            return grabDbName(request, response, "1.0.0");
        },
        grabDocument: function (request, response) {
            return grabDocument(request, response, "1.0.0");
        }
    };

    module.exports = lib;

}());