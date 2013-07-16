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

// params
var crateName = 'std';

var BUILD_TARGET = 'build';

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
        if (type.type === 'bool') {
            return 'bool'; // TODO deprecated
        }
        if (type.type === 'resolved') {
            if (!references[type.value]) {
                throw new Error('Invalid ref id: ' + type.value);
            }

            return references[type.value].def.name;
        }
        if (type.type === 'tuple') {
            return '(' + type.value.map(short_type).join(', ') + ')';
        }

        throw new Error('Unknown type: ' + type.type + ', could not parse');
    };

    Twig.renderFile("templates/" + template, vars, function (dummy, out) { cb(out); });
}

function indexModule(path, module, typeTree, references) {
    var types = ['modules', 'structs', 'enums', 'traits', 'typedefs', 'functions', 'reexports'];

    types.forEach(function (type) {
        if (!module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            var name = def.name;
            if (type === 'modules') {
                typeTree.modulesData[name] = createTypeTreeNode(typeTree);
                indexModule(path + '::' + name, module.modules[name], typeTree.modulesData[name], references);
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
        types = ['structs', 'enums', 'traits', 'typedefs', 'functions', 'reexports'];

    matches = path.match(/::/g);
    rootPath = '../' + (matches ? new Array(matches.length + 1).join('../') : '');

    types.forEach(function (type) {
        if (type === 'modules' || !module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            var data, cb;
            data = {
                path: path,
                type_tree: typeTree,
                root_path: rootPath,
                element: def,
            };
            cb = function (out) {
                if (!fs.existsSync(buildPath)) {
                    fs.mkdirSync(buildPath);
                }
                fs.writeFile(buildPath + def.name + ".html", out);
            };
            render(type + '.twig', data, references, cb);
        });
    });

    if (module.modules) {
        module.modules.forEach(function (mod) {
            dumpModule(path + '::' + mod.name, module.modules[mod.name], typeTree.modulesData[mod.name], references);
        });
    }
}

function createTypeTreeNode(parent) {
    parent = parent || null;

    return {
        modules: {},
        modulesData: {},
        structs: {},
        enums: {},
        traits: {},
        typedefs: {},
        functions: {},
        reexports: {},
        parent: parent,
    };
}

var data = JSON.parse(fs.readFileSync("input.json"));
var typeTree = createTypeTreeNode();
var references = createTypeTreeNode();

indexModule(crateName, data, typeTree, references);
dumpModule(crateName, data, typeTree, references);
