/*jslint node: true, stupid: true, es5: true, regexp: true, nomen: true */
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

// params (inputDir, outputDir, faviconUrl, logoUrl, menu, title, baseSourceUrls, knownCrates)
var config = JSON.parse(fs.readFileSync('config.json'));
config.inputDir = config.inputDir || "input";
config.outputDir = config.outputDir.replace(/\/*$/, '/') || "build/";
config.logoUrl = config.logoUrl || "http://www.rust-lang.org/logos/rust-logo-128x128-blk.png";
config.baseSourceUrls = config.baseSourceUrls || {};
config.menu = config.menu || [];
config.title = config.title || '';
config.rustVersion = config.rustVersion || '0.8'; // TODO should be current once the latest version is built as current
config.knownCrates = config.knownCrates || {};

// merge in default known crates
[
    {name: 'std', url: "http://seld.be/rustdoc/%rustVersion%/", type: "rustdoc_web"},
    {name: 'extra', url: "http://seld.be/rustdoc/%rustVersion%/", type: "rustdoc_web"},
].forEach(function (crate) {
    if (config.knownCrates[crate.name] === undefined) {
        config.knownCrates[crate.name] = {url: crate.url, type: crate.type};
    }
});

var transTexts = {
    'mods': 'Modules',
    'structs': 'Structs',
    'enums': 'Enums',
    'traits': 'Traits',
    'typedefs': 'Type Definitions',
    'statics': 'Statics',
    'fns': 'Functions',
    'reexports': 'Re-exports',
    'crates': 'Crates',
    'mod': 'Module',
    'struct': 'Struct',
    'enum': 'Enum',
    'trait': 'Trait',
    'typedef': 'Type Definition',
    'static': 'Static',
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
        statics: {},
    };
}

function shortenType(type) {
    return type.substring(0, type.length - 1);
}

function extract(data, key) {
    var res = '';
    data.forEach(function (attr) {
        if ((attr.variant === "NameValue" || attr.variant === "List") && attr.fields[0] === key) {
            res = attr.fields[1];
        }
    });

    return res;
}

function extractDocs(elem) {
    return extract(elem.attrs, 'doc').toString();
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

function getDecl(element) {
    if (element.decl !== undefined) {
        return element.decl;
    }

    return element.inner.fields[0].decl;
}

function getGenerics(element) {
    if (element.inner === undefined || element.inner.fields === undefined) {
        throw new Error('Invalid element: ' + JSON.stringify(element));
    }
    return element.inner.fields[0].generics;
}

function primitiveType(type) {
    var foundType = type.fields[0].substring(3),
        typeAliases = {
            u: 'uint',
            f: 'float',
            i: 'int',
        },
        knownTypes = [
            "char",
            "u", "u8", "u16", "u32", "u64",
            "i", "i8", "i16", "i32", "i64",
            "f", "f8", "f16", "f32", "f64"
        ];

    if (knownTypes.indexOf(foundType) === -1) {
        throw new Error('Unknown type: ' + JSON.stringify(type));
    }

    if (typeAliases[foundType] !== undefined) {
        return typeAliases[foundType];
    }

    return foundType;
}

function render(template, vars, references, version, cb) {
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
    vars.link_to_external = function (name, type, knownCrates, version) {
        var crate, path, match, url, localCrate;
        match = name.match(/^([^:]+)(::.*)?$/);
        crate = match[1];
        path = name.replace(/::/g, '/') + '.html';
        path = path.replace(/([^\/]+)$/, type + '.$1');

        version.crates.forEach(function (cr) {
            if (cr.name === crate) {
                localCrate = true;
            }
        });

        if (localCrate) { // crate is part of this build
            url = vars.root_path + version.version + '/' + path;
        } else { // crate is known at another URL
            if (knownCrates[crate] === undefined) {
                return name;
            }
            if (knownCrates[crate].type !== 'rustdoc_web') {
                console.log('WARNING: Unknown crate type ' + knownCrates[crate].type);
                return name;
            }

            url = knownCrates[crate].url
                .replace(/%rustVersion%/g, config.rustVersion)
                .replace(/%version%/g, version.version)
                .replace(/\/*$/, '/');
            url += path;
        }

        return '<a class="' + shortenType(type) + '" href="' + url + '">' + name + '</a>';
    };
    vars.element_by_id = function (id) {
        return references[id];
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
        if (type === 'CLikeVariant') {
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
    vars.extract_required_methods = function (trait) {
        var res = [];
        trait.inner.fields[0].methods.forEach(function (method) {
            if (method.variant === "Required") {
                res.push(method.fields[0]);
            }
        });
        return res;
    };
    vars.extract_provided_methods = function (trait) {
        var res = [];
        trait.inner.fields[0].methods.forEach(function (method) {
            if (method.variant === "Provided") {
                res.push(method.fields[0]);
            }
        });
        return res;
    };
    vars.count = function (data) {
        var key, count = 0;
        if (data instanceof Array) {
            return data.length;
        }

        for (key in data) {
            count += 1;
        }

        return count;
    };
    vars.short_type = function shortType(type, currentTree, realType) {
        var types;

        if (!currentTree) {
            throw new Error('Missing currentTree arg #2');
        }

        if (typeof type === 'string') {
            type = {variant: type, fields: []};
        }

        switch (realType || type.variant) {
        case 'Primitive':
            return primitiveType(type.fields[0]);

        case 'Resolved':
            if (!references[type.fields[0]]) {
                console.log('INVALID RESOLVED REFERENCE ID ' + type.fields[0]);
                return '&lt;ID:' + type.fields[0] + '&gt;'; // TODO fix this
                // throw new Error('Invalid resolved ref id: ' + type.fields[0]);
            }
            return vars.link_to_element(type.fields[0], currentTree);

        case 'External':
            //                           external path   external type
            return vars.link_to_external(type.fields[0], type.fields[1], config.knownCrates, version);

        case 'Tuple':
        case 'TupleVariant':
            types = type.fields[0].map(function (t) {
                return shortType(t, currentTree, realType);
            }).join(', ');
            return '(' + types + ')';

        case 'String':
            return 'str';
        case 'Bool':
            return 'bool';
        case 'Managed':
            return '@' + shortType(type.fields[0], currentTree, realType);
        case 'Unique':
            return '~' + shortType(type.fields[0], currentTree, realType);
        case 'BorrowedRef':
            return '&' + shortType(type.fields[0], currentTree, realType);
        case 'RawPointer':
            return '*' + shortType(type.fields[0], currentTree, realType);
        case 'Vector':
            return '[' + shortType(type.fields[0], currentTree, realType) + ']';
        case 'Bottom':
            return '!';
        case 'Self':
            return 'Self';
        case 'Closure':
            return vars.render_fn(type.fields[0], currentTree, 'Closure');
        case 'Generic':
            if (references[type.fields[0]] === undefined) {
                throw new Error('Invalid generic reference id in ' + JSON.stringify(type));
            }
            return references[type.fields[0]].def.name;
        case 'Unit':
            return '';
        case 'BareFunction':
            return (type.fields[0].abi ? 'extern ' + type.fields[0].abi + ' ' : '') + vars.render_fn(type.fields[0], currentTree, 'BareFunction');
        }

        throw new Error('Can not render short type: ' + (realType || type.variant) + ' ' + JSON.stringify(type));
    };
    vars.render_fn = function (fn, currentTree, fnType) {
        var output = '', decl = getDecl(fn);

        if (fnType === 'Closure' && fn.onceness === 'once') {
            output += 'once ';
        }

        output += 'fn' + (fn.name ? ' ' + fn.name : '') + vars.render_generics(fn, fnType) + '(\n    ';
        output += decl.inputs.map(function (arg) {
            return (arg.name ? arg.name + ': ' : '') + vars.short_type(arg.type_, currentTree);
        }).join(', \n    ');
        output += '\n)';

        if (decl.output !== 'Unit') { // TODO fix this condition
            output += ' -&gt; ' + vars.short_type(decl.output, currentTree);
        }

        Twig.extend(function (Twig) {
            if (Twig.lib.strip_tags(output).replace(/&(gt|lt)/g, '').length < 100 || fnType !== 'fn') {
                output = output.replace(/\n {4}|\n/g, '');
            }
        });

        return output;
    };
    vars.render_generics = function (element, fnType) {
        var type_params, lifetimes, output = '', generics;

        if (fnType === 'Closure') {
            generics = {typarams: [], lifetimes: element.lifetimes};
        } else if (fnType === 'BareFunction') {
            generics = element.generics;
        } else {
            generics = getGenerics(element);
        }
        if (!generics) {
            throw new Error('Element has invalid generics defined ' + JSON.stringify(element));
        }

        type_params = generics.type_params || [];
        lifetimes = generics.lifetimes || [];

        if (type_params.length || lifetimes.length) {
            output += '&lt;';
            if (lifetimes.length) {
                output += "'" + lifetimes.map(function (l) { return l._field0; }).join(", '");
            }
            if (type_params.length && lifetimes.length) {
                output += ', ';
            }
            output += type_params.map(function (t) { return t.name; }).join(', ');
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
    var types = {
        ModuleItem: 'mods',
        StructItem: 'structs',
        EnumItem: 'enums',
        TraitItem: 'traits',
        TypedefItem: 'typedefs',
        FunctionItem: 'fns',
        StaticItem: 'statics',
        ImplItem: 'impls',
        ViewItemItem: 'viewitems',
    };

    function indexTyparams(typarams) {
        typarams.forEach(function (typaram) {
            references[typaram.id] = {type: 'typaram', def: typaram, tree: typeTree};
        });
    }

    function indexMethods(methods, parentName, parentType) {
        methods.forEach(function (method) {
            var generics;

            method = method.fields[0];
            generics = getGenerics(method);
            if (generics && generics.type_params) {
                indexTyparams(generics.type_params);
            }
            searchIndex.push({type: 'method', name: method.name, parent: parentName, parentType: parentType, desc: shortDescription(method), path: getPath(typeTree).join('::')});
        });
    }

    // TODO index impls methods?

    function indexVariants(variants, parentName, parentType) {
        variants.forEach(function (variant) {
            searchIndex.push({type: 'variant', name: variant.name, parent: parentName, parentType: parentType, desc: '', path: getPath(typeTree).join('::')});
        });
    }

    function indexItem(type, def) {
        var name = def.name, generics;
        if (type === 'mods') {
            def.id = path + name;
            typeTree.submods[name] = createTypeTreeNode(name, typeTree);
            indexModule(path + '::' + name, def, typeTree.submods[name], references, searchIndex);
        } else if (type === 'statics') {
            def.id = path + '::' + name;
        } else if (type === 'viewitems') {
            // TODO scan re-exports?
            return;
        } else if (type === 'impls') {
            // TODO build cross-link of implemented stuff and traits implemented
            return;
        } else if (def.id === undefined) {
            throw new Error('Missing id on type ' + type + ' content: ' + JSON.stringify(def));
        }

        // FIXME all the ifs
        generics = getGenerics(def);
        if (generics && generics.type_params) {
            indexTyparams(generics.type_params);
        }
        if (type === 'traits') {
            indexMethods(def.inner.fields[0].methods, name, shortenType(type));
        }
        if (type === 'enums') {
            indexVariants(def.inner.fields[0].variants, name, shortenType(type));
        }

        typeTree[type][def.id] = name;
        searchIndex.push({type: shortenType(type), name: name, path: getPath(typeTree).join('::'), desc: shortDescription(def)});
        references[def.id] = {type: type, def: def, tree: typeTree};
    }

    if (module.inner.variant !== 'ModuleItem') {
        throw new Error('Invalid module, should contain an inner module item');
    }

    module.inner.fields.forEach(function (field) {
        field.items.forEach(function (item) {
            if (types[item.inner.variant] === undefined) {
                throw new Error('Unknown variant ' + item.inner.variant);
            }
            indexItem(types[item.inner.variant], item);
        });
    });
}

function dumpModule(path, module, typeTree, references, crate, crates, version, versions) {
    var rootPath, matches, types,
        buildPath = config.outputDir + crate.version + "/" + path.replace(/::/g, '/') + '/';

    types = {
        ModuleItem: 'mods',
        StructItem: 'structs',
        EnumItem: 'enums',
        TraitItem: 'traits',
        TypedefItem: 'typedefs',
        FunctionItem: 'fns',
        StaticItem: false,
        ImplItem: false,
        ViewItemItem: false,
    };

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
            versions: versions,
            cur_version: crate.version,
            config: config,
        };
        if (!fs.existsSync(buildPath)) {
            fs.mkdirSync(buildPath);
        }
        cb = function (out) {
            fs.writeFile(buildPath + filename, out);
        };
        render(type + '.twig', data, references, version, cb);
    }

    renderTemplate('mods', module, "index.html");

    module.inner.fields.forEach(function (field) {
        field.items.forEach(function (item) {
            var type = types[item.inner.variant];
            if (type === undefined) {
                throw new Error('Unknown variant ' + item.inner.variant);
            }
            if (type === false) {
                return;
            }

            if (type === 'mods') {
                dumpModule(path + '::' + item.name, item, typeTree.submods[item.name], references, crate, crates, version, versions);
            } else {
                renderTemplate(type, item, shortenType(type) + '.' + item.name + '.html');
            }
        });
    });
}

function renderCratesIndex(version, versions) {
    var data, cb;
    data = {
        root_path: '../',
        crates: version.crates,
        config: config,
        versions: versions,
        cur_version: version.version,
        // dummy object because we are not in a crate but the layout needs one
        crate: {version: version.version}
    };
    cb = function (out) {
        fs.writeFile(config.outputDir + version.version + '/index.html', out);
    };

    if (version.crates.length === 1) {
        cb('<DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' + version.crates[0].name + '/index.html"></head><body></body></html>');
    } else {
        render('crates.twig', data, {}, version, cb);
    }
}

function renderVersionsIndex(versions) {
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
        render('versions.twig', data, {}, {}, cb);
    }
}

function initCrate(crate, searchIndex) {
    var sourceUrl, data = JSON.parse(fs.readFileSync(crate.path));
    if (data.schema !== '0.7.0') {
        throw new Error('Unsupported schema ' + data.schema);
    }

    crate.name = data.crate.name;
    crate.data = data.crate.module;
    crate.typeTree = createTypeTreeNode(crate.name);
    crate.references = {};
    crate.data.name = crate.name;
    crate.license = extract(data.crate.module.attrs, 'license').toString();

    // read the link.url of the crate and take that as default if the config has no url configured
    sourceUrl = extract(data.crate.module.attrs, 'link');
    if (sourceUrl !== '' && config.baseSourceUrls[crate.name] === undefined) {
        sourceUrl = extract(sourceUrl, 'url').toString();
        if (sourceUrl !== '') {
            config.baseSourceUrls[crate.name] = sourceUrl.replace(/\/*$/, '/');
        }
    }

    indexModule(crate.name, crate.data, crate.typeTree, crate.references, searchIndex);
}

function dumpCrate(crate, crates, version, versions) {
    dumpModule(crate.name, crate.data, crate.typeTree, crate.references, crate, crates, version, versions);
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

        version.crates.sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });

        fs.writeFile(config.outputDir + version.version + '/search-index.js', "searchIndex = " + JSON.stringify(searchIndex));
        searchIndex = [];

        version.crates.forEach(function (crate) {
            dumpCrate(crate, version.crates, version, versions);
        });

        renderCratesIndex(version, versions);
    });
    renderVersionsIndex(versions);

    // TODO generate mod/elem.html files that redir to mod/type.elem.html (or show a "did you mean?" list of elems if a few of diff types have the same name)
}());
