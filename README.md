rustdoc web frontend
====================

Usage
-----

- clone the repo
- if you don't have npm/node set up, install that first
- if you don't have grunt run `npm install -g grunt-cli` to get it set up
- run `npm install`
- place rustdoc_ng output files in input/<version>/<crate>.json where version must match tags on your git repo
- run `grunt` to build the input files into a build/ dir

Offline Docs
------------

To quickly start a server to be able to browse the docs locally run
`grunt browse` then access the docs on [localhost:8000](http://localhost:8000).

Author
------

Jordi Boggiano - <j.boggiano@seld.be>

Docs design by [Meret Vollenweider](http://meret.com)

License
-------

rustdoc_web is licensed under the MIT License - see the `LICENSE` file for details
