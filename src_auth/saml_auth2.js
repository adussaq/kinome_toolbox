/*global*/
(function () {
    'use strict';

    var saml = require('samlify');
    var fs = require('fs');
    var sentKeys = {};

    // Set up auth
    var idp_xml_file = "./keys/uab-shib-metadata.xml";
    // var idp_xml_file = "./keys/sample_idp.xml";
    var service_provider_xml_file = "./keys/sample_sp.xml";
    var service_provider_xml_file_read = fs.readFileSync(service_provider_xml_file, 'utf8');


    var idp = saml.IdentityProvider({
        metadata: fs.readFileSync(idp_xml_file, 'utf8')
    });

    var sp = saml.ServiceProvider({
        metadata: service_provider_xml_file_read
    });

    var login = function (req, res, next) {
        var loginObj = sp.createLoginRequest(idp, 'redirect');
        //store the callback url
        sentKeys[loginObj.id] = req.params;

        //delete the key and the callback after 10 minutes
        (function (id) {
            setTimeout(function () {
                delete sentKeys[id];
            }, 1000 * 60 * 10);
        }(loginObj.id));

        // console.log('sent', loginObj);
        return res.redirect(loginObj.context, next);
    };

    var post_token = function (callback) {
        return function (req, res, next) {
            var body, bodyObj = {}, i, entry, key;
            body = req.body.split(/[\&\?]/);
            for (i = 0; i < body.length; i += 1) {
                entry = body[i].split(/\=/);
                key = decodeURIComponent(entry.shift());
                bodyObj[key] = decodeURIComponent(entry.join('='));
            }

            req.body = bodyObj;


            sp.parseLoginResponse(idp, 'post', req)
                .then(function (results) {
                    //res.send({id: results.extract.nameID, response: results.extract.response});
                    // console.log('came back', results.extract.response.inResponseTo, sentKeys[results.extract.response.inResponseTo]);
                    //make sure this does not return an undefined
                    var id = results.extract.response.inResponseTo;
                    sentKeys[id] = sentKeys[id] || {};

                    //double check to delete key in case one is created above
                    //delete the key and the callback after 10 minutes
                    (function (tid) {
                        setTimeout(function () {
                            delete sentKeys[tid];
                        }, 1000 * 60 * 10);
                    }(id));

                    callback(results.extract.nameID, sentKeys[id].redirect, sentKeys[id].tag, req, res, next);
                })
                .catch(function (err) {
                    console.log(bodyObj);
                    console.log(err);
                    res.send(500, {
                        error: {
                            code: "500",
                            message: "Failed to parse message from the IDP server: " + err.message
                        }
                    });
                });

            return [next, res];
        };
    };

    var metadata = function (req, res, next) {
        res.setHeader('content-type', 'application/xml');
        res.end(sp.getMetadata());
        return [next, req];
    };

    module.exports = {
        login: login,
        post_token: post_token,
        metadata: metadata
    };

    return false;
}());