/*global KINOME module google Blob jQuery save ID $ window*/

(function (exports) {
    "use strict";

    var $page;

    $page = KINOME.page;
    $page.empty();

    if (KINOME.params.data.length === 0) {
        $page.append('<div class="text-center alert alert-info"><h2>We noticed you do not have any data loaded, we are starting the page with our public database, please wait...</h2></div>');
        KINOME.loadData('http://dbi.kinomecore.com:8000/db/kinome/name').then(function () {
            return KINOME.loadData('local://name');
        }).then(function () {
            return require('set_up_table');
        });
    } else {
        //load UI scripts that correspond to types
        KINOME.list('levels').map(function (x) {
            return require(x, 'js').catch(function (err) {
                KINOME.error(err, 'No default options for level: ' + x);
            });
        });
    }

    return exports;
}(
    ("undefined" !== typeof module && module.exports)
        ? module.exports
        : KINOME
));