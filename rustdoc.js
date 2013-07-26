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

// params
// TODO support building more than one crate at once
var inputFile = "input.json";

var BUILD_TARGET = "build";

if (!fs.existsSync(BUILD_TARGET)) {
    fs.mkdirSync(BUILD_TARGET);
}

function render(template, vars, references, cb) {
    vars.settings = {
        views: "templates/",
        'twig options': { strict_variables: true }
    };

    // helpers
    vars.short_description = function (docblock) {
        docblock = docblock || '';
        return docblock.substring(0, docblock.indexOf('\n')).replace(/\s+$/, '');
    };
    vars.long_description = function (docblock) {
        docblock = docblock || '';
        return docblock.substring(docblock.indexOf('\n')).replace(/^\s+/, '');
    };
    vars.short_type = function short_type(type) {
        if (type.type === 'primitive') {
            return type.value;
        }
        if (type.type === 'resolved') {
            if (!references[type.value]) {
                return '<ID:'+type.value+'>'; // TODO fix this
                throw new Error('Invalid resolved ref id: ' + type.value);
            }

            return references[type.value].def.name;
        }
        if (type.type === 'tuple') {
            return '(' + type.value.map(short_type).join(', ') + ')';
        }
        if (type.type === 'managed') {
            return '@' + short_type(type.value);
        }
        if (type.type === 'unique') {
            return '~' + short_type(type.value);
        }
        if (type.type === 'vector') {
            return '[' + short_type(type.value) + ']';
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
                typeTree.modsData[name] = createTypeTreeNode(typeTree);
                indexModule(path + '::' + name, def, typeTree.modsData[name], references);
            }
            // TODO remove the name fallback, everything should probably have one
            typeTree[type][def.id === undefined ? name : def.id] = name;
            if (def.id !== undefined) {
                references[def.id] = {type: type, def: def};
            }
        });
    });
}

function dumpModule(path, module, typeTree, references) {
    var rootPath, matches,
        buildPath = BUILD_TARGET + "/" + path.replace(/::/g, '/') + '/',
        types = ['structs', 'enums', 'traits', 'typedefs', 'fns', 'reexports'];

    matches = path.match(/::/g);
    rootPath = '../' + (matches ? new Array(matches.length + 1).join('../') : '');

    types.forEach(function (type) {
        if (!module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            var data, cb;
            data = {
                path: path,
                type_tree: typeTree,
                type: type.substring(0, type.length - 1),
                root_path: rootPath,
                element: def,
            };
            cb = function (out) {
                if (!fs.existsSync(buildPath)) {
                    fs.mkdirSync(buildPath);
                }
                fs.writeFile(buildPath + type.substring(0, type.length - 1) + '.' + def.name  + ".html", out);
            };
            render(type + '.twig', data, references, cb);
        });
    });

    if (module.mods) {
        module.mods.forEach(function (mod) {
            dumpModule(path + '::' + mod.name, mod, typeTree.modsData[mod.name], references);
        });
    }
}

function createTypeTreeNode(parent) {
    parent = parent || null;

    return {
        mods: {},
        modsData: {},
        structs: {},
        enums: {},
        traits: {},
        typedefs: {},
        fns: {},
        reexports: {},
        parent: parent,
    };
}

var data = JSON.parse(fs.readFileSync(inputFile));
if (data.schema !== '0.2.0') {
    throw new Error('Unsupported schema ' + data.schema);
}

var crateName = data.name;
var typeTree = createTypeTreeNode();
var references = createTypeTreeNode();

indexModule(crateName, data.mods[0], typeTree, references);
dumpModule(crateName, data.mods[0], typeTree, references);
