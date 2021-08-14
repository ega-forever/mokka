import {testSuite} from './consensus/testSuite';

describe('consensus tests (3 nodes, TCP)', () => testSuite({}, 3));

describe('consensus tests (4 nodes, TCP)', () => testSuite({}, 4));

describe('consensus tests (5 nodes, TCP)', () => testSuite({}, 5));
