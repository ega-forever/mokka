import {testSuite} from './bft/testSuite';

describe('BFT tests (3 nodes)', () => testSuite({}, 3));

describe('BFT tests (4 nodes)', () => testSuite({}, 4));

describe('BFT tests (5 nodes)', () => testSuite({}, 5));
