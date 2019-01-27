/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const
  fuzzTests = require('./fuzz'),
  /*  performanceTests = require('./performance'),
    blockTests = require('./blocks'),*/
  featuresTests = require('./features'),
  //fs = require('fs-extra'),
  ctx = {};

describe('mokka tests', function () {

  before(async () => {
  });

  after(async () => {
  });


  //describe('block', () => blockTests(ctx));

  describe('fuzz', () => fuzzTests(ctx));

  //describe('performance', () => performanceTests(ctx));

  describe('features', () => featuresTests(ctx));

});
