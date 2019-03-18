/*global*/
(function () {
    'use strict';

    var saml = require('samlify');
    var fs = require('fs');

    // Set up auth
    var idp_xml_file = "./keys/uab-shib-metadata.xml";
    //var service_provider_xml_file = "./keys/service_provider.xml";
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
        return res.redirect(loginObj.context, next);
    };

    var post_token = function (req, res, next) {
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
                res.send({id: results.extract.nameID, response: results.extract.response});
            })
            .catch(function (err) {
                console.log(bodyObj, "\n\n\n*****\n\n\n", err);
                res.send(["error", err.message]);
            });

        return [next, res];
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