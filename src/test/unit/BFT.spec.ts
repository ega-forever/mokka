import {testSuite} from './bft/testSuite';

describe('BFT tests (4 nodes)', () => testSuite({}, 4));

describe('BFT tests (7 nodes)', () => testSuite({}, 7));