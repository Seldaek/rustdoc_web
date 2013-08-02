/*jslint browser: true, es5: true */
/*globals $: true, searchIndex: true, fullproof: true, rootPath: true */

(function () {
    "use strict";
    var interval, searchEngine = new fullproof.ScoringEngine([new fullproof.StoreDescriptor("memorystore", fullproof.store.MemoryStore)]);

    $('.js-only').removeClass('js-only');

    $(document).on('keyup', function (e) {
        if (document.activeElement.tagName === 'INPUT') {
            return;
        }

        if (e.keyCode === 188 && $('#help').hasClass('hidden')) { // question mark
            e.preventDefault();
            $('#help').removeClass('hidden');
        } else if (e.keyCode === 27 && !$('#help').hasClass('hidden')) { // esc
            e.preventDefault();
            $('#help').addClass('hidden');
        } else if (e.keyCode === 83) { // S
            e.preventDefault();
            $('.search-input').focus();
        }
    }).on('click', function (e) {
        if (!$(e.target).closest('#help').length) {
            $('#help').addClass('hidden');
        }
    });

    function initSearch(data) {
        var currentResults;

        function getQuery() {
            var matches, type, query = $('.search-input').val();

            matches = query.match(/^(fn|mod|str(uct)?|enum|trait|t(ype)?d(ef)?)\s*:\s*/i);
            if (matches) {
                type = matches[1].replace('td', 'typedef').replace('str', 'struct').replace('tdef', 'typedef').replace('typed', 'typedef');
                query = query.substring(matches[0].length);
            }

            return {
                query: query,
                type: type,
                id: query + type,
            };
        }

        function initSearchNav() {
            var hoverTimeout, $results = $('.search-results .result');

            $results.on('click', function () {
                document.location.href = $(this).find('a').prop('href');
            }).on('mouseover', function () {
                var $el = $(this);
                clearTimeout(hoverTimeout);
                hoverTimeout = setTimeout(function () {
                    $results.removeClass('highlighted');
                    $el.addClass('highlighted');
                }, 20);
            });

            $(document).off('keyup.searchnav');
            $(document).on('keyup.searchnav', function (e) {
                var $active = $results.filter('.highlighted');

                if (e.keyCode === 38) { // up
                    e.preventDefault();
                    if (!$active.length || !$active.prev()) {
                        return;
                    }

                    $active.prev().addClass('highlighted');
                    $active.removeClass('highlighted');
                } else if (e.keyCode === 40) { // down
                    e.preventDefault();
                    if (!$active.length) {
                        $results.first().addClass('highlighted');
                    } else if ($active.next().length) {
                        $active.next().addClass('highlighted');
                        $active.removeClass('highlighted');
                    }
                } else if (e.keyCode === 13) { // return
                    e.preventDefault();
                    if ($active.length) {
                        document.location.href = $active.find('a').prop('href');
                    }
                }
            });
        }

        function showResults(resultSet) {
            var output, shown, query = getQuery();

            currentResults = query.id;
            output = '<h1>Results for ' + query.query + (query.type ? ' (type: ' + query.type + ')' : '') + '</h1>';
            output += '<table class="search-results">';

            if (resultSet) {
                resultSet.setComparatorObject({
                    lower_than: function (a, b) {
                        return a.score > b.score;
                    },
                    equals: function (a, b) {
                        return a.score === b.score;
                    }
                });
            }

            if (resultSet.getSize() > 0) {
                shown = [];

                resultSet.forEach(function (entry) {
                    var item, name, type;

                    if (entry instanceof fullproof.ScoredElement) {
                        entry = entry.value;
                    }
                    if (shown[entry]) {
                        return;
                    }

                    shown[entry] = true;
                    item = data[entry];
                    name = item.name;
                    type = item.type;

                    // filter type: ... queries
                    if (query.type && query.type !== type) {
                        return;
                    }

                    output += '<tr class="' + type + ' result"><td>';

                    if (type === 'mod') {
                        output += item.path + '::<a href="' + rootPath + item.path.replace(/::/g, '/') + '/' + name + '/index.html" class="type ' + type + '">' + name + '</a>';
                    } else {
                        output += item.path + '::<a href="' + rootPath + item.path.replace(/::/g, '/') + '/' + type + '.' + name + '.html" class="type ' + type + '">' + name + '</a>';
                    }

                    output += '</td><td><span class="desc">' + item.desc + '</span></td></tr>';
                });
            } else {
                output += 'No results :( <a href="https://duckduckgo.com/?q=' + encodeURIComponent('rust ' + query.query) + '">Try on DuckDuckGo?</a>';
            }

            output += "</p>";
            $('.content').html(output);
            $('.search-results .desc').width($('.content').width() - 40 - $('.content td:first-child').first().width());
            initSearchNav();
        }

        function search(e) {
            var query = getQuery();
            if (e) {
                e.preventDefault();
            }

            if (!query.query || query.id === currentResults) {
                return;
            }
            searchEngine.lookup(query.query, showResults);
        }

        function engineReady(state) {
            var keyUpTimeout;
            $('.do-search').on('click', search);
            $('.search-input').on('keyup', function () {
                clearTimeout(keyUpTimeout);
                keyUpTimeout = setTimeout(search, 100);
            });
        }

        (function () {
            function populateIndexNew(injector, callback) {
                var i, text,
                    len = data.length,
                    syncCb = fullproof.make_synchro_point(callback, len);

                for (i = 0; i < len; i += 1) {
                    text = data[i].path + (data[i].type === 'mods' ? '' : "::" + data[i].name) + " " + data[i].desc;
                    injector.inject(text, i, syncCb);
                }
            }

            var indices = [
                new fullproof.IndexUnit(
                    "basicindex",
                    new fullproof.Capabilities().setStoreObjects(false).setUseScores(true).setDbName('dummy').setComparatorObject(fullproof.ScoredEntry.comparatorObject),
                    new fullproof.ScoringAnalyzer(fullproof.normalizer.to_lowercase_nomark, fullproof.normalizer.remove_duplicate_letters),
                    populateIndexNew
                ),
                new fullproof.IndexUnit(
                    "stemmedindex",
                    new fullproof.Capabilities().setStoreObjects(false).setUseScores(true).setDbName('dummy').setComparatorObject(fullproof.ScoredEntry.comparatorObject),
                    new fullproof.ScoringAnalyzer(fullproof.normalizer.to_lowercase_nomark, fullproof.english.metaphone),
                    populateIndexNew
                )
            ];

            searchEngine.open(indices, fullproof.make_callback(engineReady, true), fullproof.make_callback(engineReady, false));
        }());
    }

    interval = setInterval(function () {
        if (searchIndex !== null) {
            clearInterval(interval);
            initSearch(searchIndex);
        }
    }, 100);
}());
