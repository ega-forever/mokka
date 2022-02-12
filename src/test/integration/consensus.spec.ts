import {testSuite} from './consensus/testSuite';

describe('consensus tests (3 nodes, TCP, CFT)', () => testSuite({}, 3));

describe('consensus tests (4 nodes, TCP, CFT)', () => testSuite({}, 4));

describe('consensus tests (5 nodes, TCP, CFT)', () => testSuite({}, 5));

describe('consensus tests (5 nodes, TCP, BFT)', () => testSuite({}, 5, 'TCP', 'BFT'));

describe('consensus tests (7 nodes, TCP, BFT)', () => testSuite({}, 7, 'TCP', 'BFT'));
