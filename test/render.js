/*
 * test/render.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

var rewire = require('rewire');
var sinon = require('sinon');
var _ = require('underscore');
var Q = require('q');
var should = require('should'); //need static function
var paths = require('../lib/core/paths');
var render = rewire('../lib/core/render');

var PATH = '/some/path/';

var TEMPLATE = require('fs').
  readFileSync('templates/error.html', 'utf-8');

var mockFS = {
  existsSync : function(path){
    
  },
  readFileSync : function(path){
    
  }
}

var readStub;
var existsStub;

render.__set__("fs", mockFS);

var res = {
  writeHead : sinon.spy(),
  end : sinon.spy()
};

describe('Render', function(){  
  beforeEach(function(){
    res.writeHead.reset();
    res.end.reset();
    
    render.flushCache();

    if (readStub){
      readStub.restore();
      existsStub.restore();
    }

    readStub = sinon.stub(mockFS, "readFileSync").returns(TEMPLATE);
    existsStub = sinon.stub(mockFS, "existsSync");
  }),

  describe('#sendPage', function(){
    it('Reads custom dir/templates if they exist', function(){
      existsStub.withArgs(PATH+'error-temp1.html').returns(true);

      render.sendPage(res, 200, 'title', {
        templateDir: PATH,
        template: 'error-temp1'
      });
      
      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(PATH + 'error-temp1.html');
      readStub.firstCall.args[1].should.eql('utf-8');
      
      res.writeHead.calledWith(200).should.be.true;
      res.end.calledOnce.should.be.true;
    }),
    it('Reads provided templates if they exist', function(){
      var templatePath =  paths.projectFile('templates/error-temp1.html');
      existsStub.withArgs(PATH+'error-temp1.html').returns(false);
      existsStub.withArgs(templatePath).returns(true);

      render.sendPage(res, 200, 'title', {
        templateDir: PATH,
        template: 'error-temp1'
      });

      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(templatePath);
      readStub.firstCall.args[1].should.eql('utf-8');
      
      res.writeHead.calledWith(200).should.be.true;
      res.end.calledOnce.should.be.true;
    }),
    it('Falls back to more general custom templates before using provided tmplts', function(){
      existsStub.withArgs(PATH+'error-temp1.html').returns(false);
      existsStub.withArgs(paths.projectFile('templates/error-temp1.html')).returns(false);
      existsStub.withArgs(PATH+'error.html').returns(true);
      existsStub.withArgs(paths.projectFile('templates/error.html')).returns(true);

      render.sendPage(res, 200, 'title', {
        templateDir: PATH,
        template: 'error-temp1'
      });

      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(PATH+'error.html');
      readStub.firstCall.args[1].should.eql('utf-8');
      
      res.writeHead.calledWith(200).should.be.true;
      res.end.calledOnce.should.be.true;
    }),
    it('Reads custom default error template if it exists', function(){
      existsStub.withArgs(PATH+'error-temp1.html').returns(false);
      existsStub.withArgs(paths.projectFile('templates/error-temp1.html')).returns(false);
      existsStub.withArgs(PATH+'error.html').returns(true);

      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'error-temp1'
      });

      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(PATH+'error.html');
      readStub.firstCall.args[1].should.eql('utf-8');
      
      res.writeHead.calledWith(200).should.be.true;
      res.end.calledOnce.should.be.true;
    }),
    it('Reads provided default error template if nothing else exists', function(){
      existsStub.withArgs(PATH+'error-temp1.html').returns(false);
      existsStub.withArgs(paths.projectFile('templates/error-temp1.html')).returns(false);
      existsStub.withArgs(PATH+'error.html').returns(false);
      existsStub.withArgs(paths.projectFile('templates/error.html')).returns(true);
      
      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'error-temp1'
      });
      
      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(paths.projectFile('templates/error.html'));
      readStub.firstCall.args[1].should.eql('utf-8');

      res.writeHead.calledWith(200).should.be.true;
      res.end.calledOnce.should.be.true;
    }),
    it('Caches templates', function(){
      existsStub.withArgs(PATH+'temp1.html').returns(true);
      
      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'temp1'
      });
      
      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(PATH+'temp1.html');
      readStub.firstCall.args[1].should.eql('utf-8');

      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'temp1'
      });

      readStub.calledOnce.should.be.true;
    }),
    it('Flushes templates from cache on demand', function(){
      existsStub.withArgs(PATH+'temp1.html').returns(true);
      
      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'temp1'
      });
      
      readStub.calledOnce.should.be.true;
      readStub.firstCall.args[0].should.eql(PATH+'temp1.html');
      readStub.firstCall.args[1].should.eql('utf-8');

      render.flushCache();

      render.sendPage(res, 200, 'title', {
        templateDir:PATH,
        template: 'temp1'
      });

      readStub.callCount.should.eql(2);
    })
  });

});
      