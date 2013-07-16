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

function render(template, vars, cb) {
    vars.settings = {views: "templates/"};

    Twig.renderFile("templates/" + template, vars, function (dummy, out) { cb(out); });
}

function indexModule(module, typeTree, path) {
    var types = ['modules', 'structs', 'enums', 'traits', 'typedefs', 'functions', 'reexports'];

    types.forEach(function (type) {
        if (!module[type]) {
            return;
        }
        module[type].forEach(function (def) {
            var name = def.name;
            if (type === 'modules') {
                typeTree.modulesData[name] = createTypeTreeNode(typeTree);
                indexModule(module.modules[name], typeTree.modulesData[name], path + '::' + name);
            }
            // TODO remove the name fallback, everything should probably have one
            typeTree[type][def.id === undefined ? name : def.id] = name;
        });
    });
}

function dumpModule(module, typeTree, path) {
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
            render(type + '.twig', data, cb);
        });
    });

    if (module.modules) {
        module.modules.forEach(function (mod) {
            dumpModule(module.modules[mod.name], typeTree.modulesData[mod.name], path + '::' + mod.name);
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

indexModule(data, typeTree, crateName);
dumpModule(data, typeTree, crateName);
