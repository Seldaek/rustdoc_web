/*jslint node: true, stupid: true, es5: true, regexp: true */
"use strict";

/*
 * This file is part of the rustdoc_web package.
 *
 * (c) Jordi Boggiano <j.boggiano@seld.be>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var Twig = require("twig"),
    fs = require("fs");

var transTexts = {
    'mods': 'Modules',
    'structs': 'Structs',
    'enums': 'Enums',
    'traits': 'Traits',
    'typedefs': 'Type Definitions',
    'fns': 'Functions',
    'reexports': 'Re-exports',
    'crates': 'Crates',
    'mod': 'Module',
    'struct': 'Struct',
    'enum': 'Enum',
    'trait': 'Trait',
    'typedef': 'Type Definition',
    'fn': 'Function',
    'reexport': 'Re-export',
};

Twig.extendFilter('trans', function (str) {
    if (transTexts[str] !== undefined) {
        return transTexts[str];
    }

    return str;
});

Twig.extendFilter('substring', function (str, args) {
    var from = args[0], to = args[1];
    if (to < 0) {
        to = str.length + to;
    }

    return str.substring(from, to);
});

// params
// TODO support building more than one crate at once and more than one version of a crate
var inputFile = "input.json";
// TODO add favicon url to config
// TODO add logo url to config
// TODO add main menu urls to config
// TODO add projectTitle to config
var projectTitle = 'libstd docs';
var baseSourceUrl = 'https://github.com/mozilla/rust/blob/master/src/libstd/';

var BUILD_TARGET = "build";

if (!fs.existsSync(BUILD_TARGET)) {
    fs.mkdirSync(BUILD_TARGET);
}

function shortType(type) {
    return type.substring(0, type.length - 1);
}

function extractDocs(elem) {
    var docs = '';
    elem.attrs.forEach(function (attr) {
        if (attr.doc) {
            docs = attr.doc.toString();
        }
    });

    return docs;
}

function shortDescription(elem) {
    var match, docblock = extractDocs(elem);

    match = docblock.match(/^([\s\S]+?)\r?\n[ \t\*]+\r?\n([\s\S]+)/);
    return match ? match[1] : docblock;
}

function getPath(tree) {
    var bits = [];
    bits.push(tree.name || '');
    while (tree.parent) {
        tree = tree.parent;
        bits.push(tree.name);
    }

    bits.reverse();

    return bits;
}

function render(template, vars, references, cb) {
    vars.settings = {
        views: "templates/",
        'twig options': { strict_variables: true }
    };

    function relativePath(fromTree, toTree) {
        var fromPath, toPath;

        if (fromTree === toTree) {
            return '';
        }

        fromPath = getPath(fromTree);
        toPath = getPath(toTree);

        while (toPath.length && fromPath.length && toPath[0] === fromPath[0]) {
            toPath.shift();
            fromPath.shift();
        }

        return (new Array(fromPath.length + 1).join('../') + toPath.join('/') + '/').replace(/\/+$/, '/');
    }

    function modPath(typeTree) {
        var path = getPath(typeTree).join('::');

        return path + (path ? '::' : '');
    }

    // helpers
    vars.short_description = shortDescription;
    vars.long_description = function (elem) {
        var match, docblock = extractDocs(elem);

        match = docblock.match(/^([\s\S]+?)\r?\n[ \t\*]+\r?\n([\s\S]+)/);
        return match ? match[2] : '';
    };
    vars.link_to_element = function (id, currentTree) {
        var modPrefix = '';
        if (references[id].tree !== currentTree) {
            modPrefix = modPath(references[id].tree);
        }

        return '<a class="' + shortType(references[id].type) + '" href="' + vars.url_to_element(id, currentTree) + '">' + modPrefix + references[id].def.name + '</a>';
    };
    vars.url_to_element = function (id, currentTree) {
        if (references[id].type === 'mods') {
            return relativePath(currentTree, references[id].tree) + references[id].def.name + '/index.html';
        }
        return relativePath(currentTree, references[id].tree) + shortType(references[id].type) + '.' + references[id].def.name + '.html';
    };
    vars.breadcrumb = function (typeTree, currentTree) {
        var path = [], out = '', tmpTree;

        currentTree = currentTree || typeTree;
        path.push(typeTree);

        tmpTree = typeTree;
        while (tmpTree.parent) {
            tmpTree = tmpTree.parent;
            path.push(tmpTree);
        }
        path.reverse();

        path.forEach(function (targetTree) {
            out += '&#8203;' + (out ? '::' : '') + '<a href="' + relativePath(currentTree, targetTree) + 'index.html">' + targetTree.name + '</a>';
        });

        return out + '::';
    };
    vars.extract_docs = extractDocs;
    vars.short_enum_type = function (type, currentTree) {
        if (type.type === 'c-like') {
            if (type.value) {
                return ' = ' + type.value;
            }
            return '';
        }

        return vars.short_type(type, currentTree);
    };
    vars.sort = function (obj) {
        var key, elems = [];
        for (key in obj) {
            elems.push({id: key, name: obj[key]});
        }

        return elems.sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });
    };
    vars.short_type = function shortType(type, currentTree) {
        var types;

        if (!currentTree) {
            throw new Error('Missing currentTree arg #2');
        }

        if (type.type === 'primitive') {
            return type.value;
        }
        if (type.type === 'resolved') {
            if (!references[type.value]) {
                return '&lt;ID:'+type.value+'&gt;'; // TODO fix this
                throw new Error('Invalid resolved ref id: ' + type.value);
            }

            return vars.link_to_element(type.value, currentTree);
        }
        if (type.type === 'tuple') {
            types = type.members === undefined ? type.value : type.members;
            types = types.map(function (t) {
                return shortType(t, currentTree);
            }).join(', ');

            return '(' + types + ')';
        }
        if (type.type === 'managed') {
            return '@' + shortType(type.value, currentTree);
        }
        if (type.type === 'unique') {
            return '~' + shortType(type.value, currentTree);
        }
        if (type.type === 'vector') {
            return '[' + shortType(type.value, currentTree) + ']';
        }
        if (type.type === 'string') {
            return 'str';
        }
        if (type.type === 'bottom') {
            return '!';
        }
        if (type.type === 'closure') {
            return '&lt;CLOSURE&gt;'; // TODO fix this once the json is correct
        }
        if (type.type === 'generic') {
            return references[type.value].def.name;
        }
        if (type.type === 'unit') { // "nil" return value
            return '';
        }

        throw new Error('Unknown type: ' + type.type + ' with value ' + JSON.stringify(type.value) + ', could not parse');
    };
    vars.source_url = function (element) {
        var matches;
        if (!element.source) {
            throw new Error('Element has no source: ' + JSON.stringify(element));
        }
        matches = element.source.match(/^([a-z0-9_.\/-]+):(\d+):\d+:? (\d+):\d+$/i);
        if (!matches) {
            throw new Error('Could not parse element.source for ' + JSON.stringify(element));
        }

        return baseSourceUrl + matches[1] + '#L' + matches[2] + '-' + matches[3];
    };

    Twig.renderFile("templates/" + template, vars, function (dummy, out) { cb(out); });
}

function indexModule(path, module, typeTree, references, searchIndex) {
    var types = ['mods', 'structs', 'enums', 'traits', 'typedefs', 'fns', 'reexports'];

    types.forEach(function (type) {
        if (!module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            var name = def.name;
            if (type === 'mods') {
                def.id = path + name;
                typeTree.submods[name] = createTypeTreeNode(name, typeTree);
                indexModule(path + '::' + name, def, typeTree.submods[name], references, searchIndex);
            } else {
                if (def.id === undefined) {
                    throw new Error('Missing id on ' + JSON.stringify(def));
                }
            }
            if (def.generics && def.generics.typarams) {
                def.generics.typarams.forEach(function (typaram) {
                    references[typaram.id] = {type: 'typaram', def: typaram, tree: typeTree};
                });
            }
            typeTree[type][def.id] = name;
            searchIndex.push({type: shortType(type), name: name, path: getPath(typeTree).join('::'), desc: shortDescription(def)});
            references[def.id] = {type: type, def: def, tree: typeTree};
        });
    });
}

function dumpModule(path, module, typeTree, references, crates) {
    var rootPath, matches,
        buildPath = BUILD_TARGET + "/" + path.replace(/::/g, '/') + '/',
        types = ['structs', 'enums', 'traits', 'typedefs', 'fns', 'reexports'];

    matches = path.match(/::/g);
    rootPath = '../' + (matches ? new Array(matches.length + 1).join('../') : '');

    function renderTemplate(type, def, filename) {
        var data, cb;
        data = {
            path: path,
            type_tree: typeTree,
            type: shortType(type),
            root_path: rootPath,
            element: def,
            project_title: projectTitle,
            crates: crates,
        };
        if (!fs.existsSync(buildPath)) {
            fs.mkdirSync(buildPath);
        }
        cb = function (out) {
            fs.writeFile(buildPath + filename, out);
        };
        render(type + '.twig', data, references, cb);
    }

    types.forEach(function (type) {
        if (!module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            renderTemplate(type, def, shortType(type) + '.' + def.name  + ".html");
        });
    });

    renderTemplate('mods', module, "index.html");

    if (module.mods) {
        module.mods.forEach(function (mod) {
            dumpModule(path + '::' + mod.name, mod, typeTree.submods[mod.name], references);
        });
    }
}

function createTypeTreeNode(name, parent) {
    parent = parent || null;

    return {
        // special metadata
        name: name,
        parent: parent,
        submods: {},

        // list of elements
        mods: {},
        structs: {},
        enums: {},
        traits: {},
        typedefs: {},
        fns: {},
        reexports: {},
    };
}

function renderMainIndex(crates) {
    var data, cb;
    data = {
        root_path: '',
        project_title: projectTitle,
        crates: crates,
    };
    cb = function (out) {
        fs.writeFile(BUILD_TARGET + '/index.html', out);
    };
    if (crates.length === 1) {
        cb('<DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' + crates[0] + '/index.html"></head><body></body></html>');
    } else {
        render('crates.twig', data, {}, cb);
    }
}

var data = JSON.parse(fs.readFileSync(inputFile));
if (data.schema !== '0.2.0') {
    throw new Error('Unsupported schema ' + data.schema);
}

var crateName = data.name;
var typeTree = createTypeTreeNode(crateName);
var references = createTypeTreeNode(crateName);
var crates = [crateName];
var searchIndex = [];

data.mods[0].name = crateName;

indexModule(crateName, data.mods[0], typeTree, references, searchIndex);
fs.writeFile(BUILD_TARGET + '/search-index.js', "searchIndex = " + JSON.stringify(searchIndex));
searchIndex = null;
dumpModule(crateName, data.mods[0], typeTree, references, crates);

renderMainIndex(crates);
