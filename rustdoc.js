/*jslint node: true, stupid: true, es5: true */
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
var projectTitle = 'rustdoc_ng docs';

var BUILD_TARGET = "build";

if (!fs.existsSync(BUILD_TARGET)) {
    fs.mkdirSync(BUILD_TARGET);
}

function shortType(type) {
    return type.substring(0, type.length - 1);
}

function render(template, vars, references, cb) {
    vars.settings = {
        views: "templates/",
        'twig options': { strict_variables: true }
    };

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
    vars.short_description = function (elem) {
        var docblock = '';
        elem.attrs.forEach(function (attr) {
            if (attr.doc) {
                docblock = attr.doc;
            }
        });

        return docblock.indexOf('\n') > -1 ? docblock.substring(0, docblock.indexOf('\n')).replace(/\s+$/, '') : docblock;
    };
    vars.long_description = function (elem) {
        var docblock = '';
        elem.attrs.forEach(function (attr) {
            if (attr.doc) {
                docblock = attr.doc;
            }
        });

        return docblock.indexOf('\n') > -1 ? docblock.substring(docblock.indexOf('\n')).replace(/^\s+/, '') : '';
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
    vars.extract_docs = function (elem) {
        var docs = '';
        elem.attrs.forEach(function (attr) {
            if (attr.doc) {
                docs = attr.doc;
            }
        });

        return docs;
    };
    vars.short_enum_type = function (type, currentTree) {
        if (type.type === 'c-like') {
            if (type.value) {
                return ' = ' + type.value;
            }
            return '';
        }

        return vars.short_type(type, currentTree);
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
            if (type.members) {
                types = type.members.map(function (t) {
                    return shortType(t, currentTree);
                }).join(', ');
            } else {
                // TODO is this path still relevant?
                types = type.value.map(function (t) {
                    return shortType(t, currentTree);
                }).join(', ');
            }

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

        throw new Error('Unknown type: ' + type.type + ' with value ' + JSON.stringify(type.value) + ', could not parse');
    };

    Twig.renderFile("templates/" + template, vars, function (dummy, out) { cb(out); });
}

function indexModule(path, module, typeTree, references) {
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
                indexModule(path + '::' + name, def, typeTree.submods[name], references);
            } else {
                if (def.id === undefined) {
                    throw new Error('Missing id on ' + JSON.stringify(def));
                }
            }
            typeTree[type][def.id] = name;
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
        cb = function (out) {
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath);
            }
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

data.mods[0].name = crateName;

indexModule(crateName, data.mods[0], typeTree, references);
dumpModule(crateName, data.mods[0], typeTree, references, crates);

renderMainIndex(crates);
