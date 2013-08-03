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
    fs = require("fs"),
    globsync = require('glob-whatev');

// params (inputDir, outputDir, faviconUrl, logoUrl, menu, title, baseSourceUrls)
var config = JSON.parse(fs.readFileSync('config.json'));
config.inputDir = config.inputDir || "input";
config.outputDir = config.outputDir.replace(/\/*$/, '/') || "build/";
config.logoUrl = config.logoUrl || "http://www.rust-lang.org/logos/rust-logo-128x128-blk.png";
config.baseSourceUrls = config.baseSourceUrls || {};
config.menu = config.menu || [];
config.title = config.title || '';

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

function shortenType(type) {
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

    match = docblock.match(/^([\s\S]+?)\r?\n[ \t\*]*\r?\n([\s\S]+)/);
    return match ? match[1].replace(/\n/g, '<br/>') : docblock;
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

        match = docblock.match(/^([\s\S]+?)\r?\n[ \t\*]*\r?\n([\s\S]+)/);
        return match ? match[2].replace(/\n/g, '<br/>') : '';
    };
    vars.link_to_element = function (id, currentTree) {
        var modPrefix = '';
        if (references[id].tree !== currentTree) {
            modPrefix = modPath(references[id].tree);
        }

        return '<a class="' + shortenType(references[id].type) + '" href="' + vars.url_to_element(id, currentTree) + '">' + modPrefix + references[id].def.name + '</a>';
    };
    vars.url_to_element = function (id, currentTree) {
        if (references[id].type === 'mods') {
            return relativePath(currentTree, references[id].tree) + references[id].def.name + '/index.html';
        }
        return relativePath(currentTree, references[id].tree) + shortenType(references[id].type) + '.' + references[id].def.name + '.html';
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
    vars.short_type = function shortType(type, currentTree, realType) {
        var types;

        if (!currentTree) {
            throw new Error('Missing currentTree arg #2');
        }

        switch (realType || type.type) {
        case 'primitive':
            return type.value;

        case 'resolved':
            if (!references[type.value]) {
                return '&lt;ID:' + type.value + '&gt;'; // TODO fix this
                // throw new Error('Invalid resolved ref id: ' + type.value);
            }
            return vars.link_to_element(type.value, currentTree);

        case 'tuple':
            types = type.members === undefined ? type.value : type.members;
            types = types.map(function (t) {
                return shortType(t, currentTree, realType);
            }).join(', ');
            return '(' + types + ')';

        case 'managed':
            return '@' + shortType(type.value, currentTree, realType);
        case 'unique':
            return '~' + shortType(type.value, currentTree, realType);
        case 'vector':
            return '[' + shortType(type.value, currentTree, realType) + ']';
        case 'string':
            return 'str';
        case 'bottom':
            return '!';
        case 'closure':
            return '&lt;CLOSURE&gt;'; // TODO fix this once the json is correct
        case 'generic':
            return references[type.value].def.name;
        case 'unit': // "nil" return value
            return '';
        case 'barefn':
            return (type.value.abi ? 'extern ' + type.value.abi + ' ' : '') + vars.render_fn(type.value, currentTree);
        }

        throw new Error('Can not render short type: ' + type.type + ' with value ' + JSON.stringify(type.value) + ' of type ' + (realType || type.type));
    };
    vars.render_fn = function (fn, currentTree) {
        var output = 'fn' + (fn.name ? ' ' + fn.name : '') + vars.render_generics(fn) + '(';
        output += fn.decl.arguments.map(function (arg) {
            return (arg.name ? arg.name + ': ' : '') + vars.short_type(arg.type, currentTree);
        }).join(', ');
        output += ')';

        if (fn.decl.output.type !== 'unit') {
            output += ' -&gt; ' + vars.short_type(fn.decl.output, currentTree);
        }

        return output;
    };
    vars.render_generics = function (element) {
        var typ, lt, output = '';

        if (!element.generics) {
            if (element.abi) {
                return '';
            }
            throw new Error('Element has no generics defined ' + JSON.stringify(element));
        }

        typ = element.generics.typarams;
        lt = element.generics.lifetimes;

        if (typ.length || lt.length) {
            output += '&lt;';
            if (lt.length) {
                output += "'" + lt.join(", '");
            }
            if (typ.length && lt.length) {
                output += ', ';
            }
            output += typ.map(function (t) { return t.name; }).join(', ');
            output += '&gt;';
        }

        return output;
    };
    vars.source_url = function (element, crate) {
        var matches;
        if (!element.source) {
            throw new Error('Element has no source: ' + JSON.stringify(element));
        }
        matches = element.source.match(/^([a-z0-9_.\/\-]+):(\d+):\d+:? (\d+):\d+$/i);
        if (!matches) {
            throw new Error('Could not parse element.source for ' + JSON.stringify(element));
        }

        return config.baseSourceUrls[crate.name].replace('%version%', crate.version) + matches[1] + '#L' + matches[2] + '-' + matches[3];
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
            searchIndex.push({type: shortenType(type), name: name, path: getPath(typeTree).join('::'), desc: shortDescription(def)});
            references[def.id] = {type: type, def: def, tree: typeTree};
        });
    });
}

function dumpModule(path, module, typeTree, references, crate, crates) {
    var rootPath, matches,
        buildPath = config.outputDir + crate.version + "/" + path.replace(/::/g, '/') + '/',
        types = ['structs', 'enums', 'traits', 'typedefs', 'fns', 'reexports'];

    matches = path.match(/::/g);
    rootPath = '../../' + (matches ? new Array(matches.length + 1).join('../') : '');

    function renderTemplate(type, def, filename) {
        var data, cb;
        data = {
            path: path,
            type_tree: typeTree,
            type: shortenType(type),
            root_path: rootPath,
            element: def,
            crates: crates,
            crate: crate,
            config: config,
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
            renderTemplate(type, def, shortenType(type) + '.' + def.name  + ".html");
        });
    });

    renderTemplate('mods', module, "index.html");

    if (module.mods) {
        module.mods.forEach(function (mod) {
            dumpModule(path + '::' + mod.name, mod, typeTree.submods[mod.name], references, crate, crates);
        });
    }
}

function renderMainVersionIndex(version) {
    var data, cb;
    data = {
        root_path: '../',
        crates: version.crates,
        config: config,
    };
    cb = function (out) {
        fs.writeFile(config.outputDir + version.version + '/index.html', out);
    };
    if (version.crates.length === 1) {
        cb('<DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' + version.crates[0].name + '/index.html"></head><body></body></html>');
    } else {
        render('crates.twig', data, {}, cb);
    }
}

function renderMainIndex(versions) {
    var data, cb;
    data = {
        root_path: '',
        versions: versions,
        config: config,
    };
    cb = function (out) {
        fs.writeFile(config.outputDir + '/index.html', out);
    };
    if (versions.length === 1) {
        cb('<DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' + versions[0].version + '/index.html"></head><body></body></html>');
    } else {
        render('crates.twig', data, {}, cb);
    }
}

function initCrate(crate, searchIndex) {
    var data = JSON.parse(fs.readFileSync(crate.path));
    if (data.schema !== '0.2.0') {
        throw new Error('Unsupported schema ' + data.schema);
    }
    crate.name = data.name;
    crate.data = data.mods[0];
    crate.typeTree = createTypeTreeNode(crate.name);
    crate.references = createTypeTreeNode(crate.name);
    crate.data.name = crate.name;

    indexModule(crate.name, crate.data, crate.typeTree, crate.references, searchIndex);
}

function dumpCrate(crate, crates) {
    dumpModule(crate.name, crate.data, crate.typeTree, crate.references, crate, crates);
}

(function main() {
    var versions = [];

    if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir);
    }

    globsync.glob(config.inputDir.replace(/\/*$/, '/') + '*').forEach(function (path) {
        var crates = [],
            version = path.replace(/.*?\/([^\/]+)\/$/, '$1');

        globsync.glob(path + '*.json').forEach(function (path) {
            var crate = path.replace(/.*?\/([^\/]+)\.json$/, '$1');
            crates.push({path: path, version: version});
        });
        crates.sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });

        versions.push({
            version: version,
            crates: crates,
            prerelease: !!require('semver').valid(version),
        });

        if (!fs.existsSync(config.outputDir + version)) {
            fs.mkdirSync(config.outputDir + version);
        }
    });

    versions.sort(function (a, b) {
        if (!a.prerelease && !b.prerelease) {
            return require('semver').rcompare(a.version, b.version);
        }

        if (a.prerelease && !b.prerelease) {
            return 1;
        }

        if (b.prerelease) {
            return -1;
        }

        return 0;
    });

    versions.forEach(function (version) {
        var searchIndex = [];

        version.crates.forEach(function (crate) {
            initCrate(crate, searchIndex);
        });

        fs.writeFile(config.outputDir + version.version + '/search-index.js', "searchIndex = " + JSON.stringify(searchIndex));
        searchIndex = [];

        version.crates.forEach(function (crate) {
            dumpCrate(crate, version.crates);
        });

        renderMainVersionIndex(version);
    });
    renderMainIndex(versions);

    // TODO generate mod/elem.html files that redir to mod/type.elem.html (or show a "did you mean?" list of elems if a few of diff types have the same name)
}());
