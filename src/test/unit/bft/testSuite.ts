import Promise from 'bluebird';
import bunyan from 'bunyan';
import { expect } from 'chai';
import crypto from 'crypto';
import MessageTypes from '../../../consensus/constants/MessageTypes';
import messageTypes from '../../../consensus/constants/MessageTypes';
import NodeStates from '../../../consensus/constants/NodeStates';
import states from '../../../consensus/constants/NodeStates';
import { VoteModel } from '../../../consensus/models/VoteModel';
import * as utils from '../../../consensus/utils/cryptoUtils';
import TCPMokka from '../../../implementation/TCP';

export function testSuite(ctx: any = {}, nodesCount: number) {

  beforeEach(async () => {

    ctx.keys = [];

    ctx.nodes = [];

    for (let i = 0; i < nodesCount; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();
      ctx.keys.push({
        privateKey: node.getPrivateKey().toString('hex'),
        publicKey: node.getPublicKey('hex', 'compressed')
      });
    }

    for (let index = 0; index < nodesCount; index++) {
      const instance = new TCPMokka({
        address: `tcp://127.0.0.1:2000/${ ctx.keys[index].publicKey }`,
        electionTimeout: 300,
        heartbeat: 50,
        logger: bunyan.createLogger({ name: 'mokka.logger', level: 60 }),
        privateKey: ctx.keys[index].privateKey,
        proofExpiration: 5000
      });

      for (let i = 0; i < nodesCount; i++)
        if (i !== index)
          instance.nodeApi.join(`tcp://127.0.0.1:${ 2000 + i }/${ ctx.keys[i].publicKey }`);

      ctx.nodes.push(instance);
    }

  });

  it(`should choose new leader between 51% of nodes each time (to prevent network freeze attack)`, async () => {

    const quorumCount = Math.ceil(nodesCount / 2) + 1;
    const arbitraryLeaders = ctx.nodes.slice(quorumCount);
    const healthyNodes = ctx.nodes.slice(0, quorumCount);
    let currentTerm = 1;

    for (const arbitraryNode of arbitraryLeaders) {
      currentTerm += 1;
      await Promise.delay(arbitraryNode.heartbeat);
      arbitraryNode.setState(NodeStates.CANDIDATE, currentTerm, '');

      for (const healthyNode of healthyNodes) {
        const packetVote = await arbitraryNode.messageApi.packet(MessageTypes.VOTE, {
          nonce: Date.now()
        });

        const result = await healthyNode.requestProcessorService.voteApi.vote(packetVote);
        // tslint:disable-next-line:no-unused-expression
        expect(result.data.signature).to.not.be.undefined;
        healthyNode.setState(NodeStates.FOLLOWER, currentTerm, arbitraryNode.publicKey);
      }
    }

    for (const arbitraryNode of arbitraryLeaders) {
      currentTerm += 1;
      await Promise.delay(arbitraryNode.heartbeat);
      arbitraryNode.setState(NodeStates.CANDIDATE, currentTerm, '');

      for (const healthyNode of healthyNodes) {
        const packetVote = await arbitraryNode.messageApi.packet(MessageTypes.VOTE, {
          nonce: Date.now()
        });

        const result = await healthyNode.requestProcessorService.voteApi.vote(packetVote);
        // tslint:disable-next-line:no-unused-expression
        expect(result.data).to.be.null;
      }
    }

    for (const healthyNode of healthyNodes) {
      const restNodes = ctx.nodes.filter((n) => n.publicKey !== healthyNode.publicKey);
      currentTerm += 1;
      await Promise.delay(healthyNode.heartbeat);
      healthyNode.setState(NodeStates.CANDIDATE, currentTerm, '');

      for (const node of restNodes) {
        const packetVote = await healthyNode.messageApi.packet(MessageTypes.VOTE, {
          nonce: Date.now()
        });

        const result = await node.requestProcessorService.voteApi.vote(packetVote);
        // tslint:disable-next-line:no-unused-expression
        expect(result.data.signature).to.not.be.undefined;
        healthyNode.setState(NodeStates.FOLLOWER, currentTerm, healthyNode.publicKey);
      }
    }
  });

  it(`should prevent leader drop through voting (to prevent network freeze attack)`, async () => {

    const leaderNode = ctx.nodes[0];
    const arbitraryNode = ctx.nodes[1];
    const followerNodes = ctx.nodes.slice(2);
    const currentTerm = 1;

    const nonce = Date.now();
    leaderNode.setState(states.CANDIDATE, currentTerm, '');

    const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
      leaderNode.publicKeysRoot,
      leaderNode.term,
      nonce,
      leaderNode.publicKey);
    const vote = new VoteModel(nonce, leaderNode.term, publicKeysRootForTerm);

    for (const combination of leaderNode.publicKeysCombinationsInQuorum) {

      if (!combination.includes(leaderNode.publicKey)) {
        continue;
      }

      const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(
        combination,
        leaderNode.term,
        nonce,
        publicKeysRootForTerm
      );
      vote.publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
    }

    leaderNode.setVote(vote);

    const selfVoteSignature = utils.buildPartialSignature(
      leaderNode.privateKey,
      leaderNode.term,
      nonce,
      publicKeysRootForTerm
    );

    vote.repliesPublicKeyToSignatureMap.set(leaderNode.publicKey, selfVoteSignature);

    const packetVote = await leaderNode.messageApi.packet(MessageTypes.VOTE, {
      nonce
    });

    for (const followerNode of followerNodes) {
      const result = await followerNode.requestProcessorService.voteApi.vote(packetVote);
      await leaderNode.requestProcessorService.voteApi.voted(result);
      // tslint:disable-next-line:no-unused-expression
      expect(result.data.signature).to.not.be.undefined;
    }

    expect(leaderNode.state).eq(NodeStates.LEADER);

    const ackPacket = leaderNode.messageApi.packet(messageTypes.ACK);

    for (const followerNode of followerNodes) {
      await followerNode.requestProcessorService.voteApi.validateAndApplyLeader(ackPacket);
      // tslint:disable-next-line:no-unused-expression
      expect(followerNode.leaderPublicKey).eq(leaderNode.publicKey);
    }

    arbitraryNode.setState(NodeStates.CANDIDATE, currentTerm + 1, '');

    const arbitraryNonce = Date.now();

    const packetArbitraryVote = await arbitraryNode.messageApi.packet(MessageTypes.VOTE, {
      nonce: arbitraryNonce
    });

    for (const followerNode of followerNodes) {
      const ackPacket = leaderNode.messageApi.packet(messageTypes.ACK);

      const [result] = await Promise.all([
        followerNode.requestProcessorService.voteApi.vote(packetArbitraryVote),
        await Promise.delay(10).then(() => followerNode.nodeApi.pingFromLeader(ackPacket))
      ]);
      // tslint:disable-next-line:no-unused-expression
      expect(result.data).to.be.null;
      // tslint:disable-next-line:no-unused-expression
      expect(followerNode.term).eq(leaderNode.term);
      expect(followerNode.leaderPublicKey).eq(leaderNode.publicKey);
    }

  });

  it(`should ignore votes for too high term (to prevent number overflow)`, async () => {

    const leaderNode = ctx.nodes[0];
    const arbitraryNode = ctx.nodes[1];
    const followerNodes = ctx.nodes.slice(2);
    const currentTerm = 1;

    const nonce = Date.now();
    leaderNode.setState(states.CANDIDATE, currentTerm, '');

    const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
      leaderNode.publicKeysRoot,
      leaderNode.term,
      nonce,
      leaderNode.publicKey);
    const vote = new VoteModel(nonce, leaderNode.term, publicKeysRootForTerm);

    for (const combination of leaderNode.publicKeysCombinationsInQuorum) {

      if (!combination.includes(leaderNode.publicKey)) {
        continue;
      }

      const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(
        combination,
        leaderNode.term,
        nonce,
        publicKeysRootForTerm
      );
      vote.publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
    }

    leaderNode.setVote(vote);

    const selfVoteSignature = utils.buildPartialSignature(
      leaderNode.privateKey,
      leaderNode.term,
      nonce,
      publicKeysRootForTerm
    );

    vote.repliesPublicKeyToSignatureMap.set(leaderNode.publicKey, selfVoteSignature);

    const packetVote = await leaderNode.messageApi.packet(MessageTypes.VOTE, {
      nonce
    });

    for (const followerNode of followerNodes) {
      const result = await followerNode.requestProcessorService.voteApi.vote(packetVote);
      await leaderNode.requestProcessorService.voteApi.voted(result);
      // tslint:disable-next-line:no-unused-expression
      expect(result.data.signature).to.not.be.undefined;
    }

    expect(leaderNode.state).eq(NodeStates.LEADER);

    const ackPacket = leaderNode.messageApi.packet(messageTypes.ACK);

    for (const followerNode of followerNodes) {
      await followerNode.requestProcessorService.voteApi.validateAndApplyLeader(ackPacket);
      // tslint:disable-next-line:no-unused-expression
      expect(followerNode.leaderPublicKey).eq(leaderNode.publicKey);
    }

    arbitraryNode.setState(NodeStates.CANDIDATE, currentTerm + Date.now(), '');

    const arbitraryNonce = Date.now();

    const packetArbitraryVote = await arbitraryNode.messageApi.packet(MessageTypes.VOTE, {
      nonce: arbitraryNonce
    });

    for (const followerNode of followerNodes) {
      const result = await followerNode.requestProcessorService.voteApi.vote(packetArbitraryVote);
      // tslint:disable-next-line:no-unused-expression
      expect(result.data).to.be.null;
    }

  });

  it(`should ignore fake leader`, async () => {

    const arbitraryNode = ctx.nodes[0];
    const followerNodes = ctx.nodes.slice(1);
    const currentTerm = 1;

    const nonce = Date.now();
    arbitraryNode.setState(states.CANDIDATE, currentTerm, '');

    const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
      arbitraryNode.publicKeysRoot,
      arbitraryNode.term,
      nonce,
      arbitraryNode.publicKey);
    const vote = new VoteModel(nonce, arbitraryNode.term, publicKeysRootForTerm);

    for (const combination of arbitraryNode.publicKeysCombinationsInQuorum) {

      if (!combination.includes(arbitraryNode.publicKey)) {
        continue;
      }

      const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(
        combination,
        arbitraryNode.term,
        nonce,
        publicKeysRootForTerm
      );
      vote.publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
    }

    arbitraryNode.setVote(vote);

    const selfVoteSignature = utils.buildPartialSignature(
      arbitraryNode.privateKey,
      arbitraryNode.term,
      nonce,
      publicKeysRootForTerm
    );

    const fakeSignature = `${ nonce }:${ vote.publicKeyToCombinationMap.keys()[0] }:${ selfVoteSignature }`;
    arbitraryNode.setState(states.LEADER, currentTerm, arbitraryNode.publicKey, fakeSignature, nonce);

    const ackPacket = arbitraryNode.messageApi.packet(messageTypes.ACK);

    for (const followerNode of followerNodes) {
      const packet = await followerNode.requestProcessorService.voteApi.validateAndApplyLeader(ackPacket);
      // tslint:disable-next-line:no-unused-expression
      expect(packet).to.be.null;
    }
  });

  it(`should ignore fake votes`, async () => {

    const leaderNode = ctx.nodes[0];
    const arbitraryNode = ctx.nodes[1];
    const followerNodes = ctx.nodes.slice(2);
    const currentTerm = 1;

    const nonce = Date.now();
    leaderNode.setState(states.CANDIDATE, currentTerm, '');

    const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
      leaderNode.publicKeysRoot,
      leaderNode.term,
      nonce,
      leaderNode.publicKey);
    const vote = new VoteModel(nonce, leaderNode.term, publicKeysRootForTerm);

    for (const combination of leaderNode.publicKeysCombinationsInQuorum) {

      if (!combination.includes(leaderNode.publicKey)) {
        continue;
      }

      const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(
        combination,
        leaderNode.term,
        nonce,
        publicKeysRootForTerm
      );
      vote.publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
    }

    leaderNode.setVote(vote);

    const selfVoteSignature = utils.buildPartialSignature(
      leaderNode.privateKey,
      leaderNode.term,
      nonce,
      publicKeysRootForTerm
    );

    vote.repliesPublicKeyToSignatureMap.set(leaderNode.publicKey, selfVoteSignature);

    const fakeSignature = utils.buildPartialSignature(
      arbitraryNode.privateKey,
      arbitraryNode.term,
      Date.now(),
      publicKeysRootForTerm
    );

    const packetVoted = await arbitraryNode.messageApi.packet(MessageTypes.VOTED, {
      signature: fakeSignature
    });

    await leaderNode.requestProcessorService.voteApi.voted(packetVoted);

    const hasVoteBeingCounted = leaderNode.vote.repliesPublicKeyToSignatureMap.has(arbitraryNode.publicKey);
    expect(hasVoteBeingCounted).eq(false);
  });

  afterEach(async () => {
    await Promise.delay(1000);
  });

}
