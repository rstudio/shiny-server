JSFILES := $(wildcard lib/*.js lib/decorators/*.js common/*.js)
TESTS = test/*.js
REPORTER = list

all: dist/shiny-server.min.js lint

build: dist/shiny-server.js

dist/shiny-server.js: $(JSFILES)
	mkdir -p dist
	./node_modules/.bin/browserify lib/main.js -o dist/shiny-server.js -t babelify

dist/shiny-server.min.js: dist/shiny-server.js
	./node_modules/.bin/uglifyjs < dist/shiny-server.js > dist/shiny-server.min.js

test:
	./node_modules/.bin/mocha \
		--compilers js:babel-register \
		--reporter $(REPORTER) \
		$(TESTS)

clean:
	rm -f dist/shiny-server.js dist/shiny-server.min.js

lint:
	./node_modules/.bin/eslint lib
	./node_modules/.bin/eslint -c .eslintrc.es5.js common
	./node_modules/.bin/eslint --env=mocha test

.PHONY: test clean all build lint
