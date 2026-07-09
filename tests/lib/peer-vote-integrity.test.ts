/**
 * v8.3 E5 — Tests de anti-gaming para peer_votes.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectReciprocalHighRatings,
  countDistinctVoters,
  hasSufficientVoterSample,
  type PeerVote,
} from "../../src/lib/peer-vote-integrity";

const vote = (voter: string, target: string, rating: number): PeerVote => ({
  voterEmployeeId: voter,
  targetEmployeeId: target,
  rating,
});

describe("detectReciprocalHighRatings", () => {
  it("detecta un par que se calificó mutuamente alto", () => {
    const votes = [vote("a", "b", 5), vote("b", "a", 5)];
    const pairs = detectReciprocalHighRatings(votes);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].ratingAtoB, 5);
    assert.equal(pairs[0].ratingBtoA, 5);
  });

  it("no marca un par donde solo uno calificó alto", () => {
    const votes = [vote("a", "b", 5), vote("b", "a", 2)];
    assert.deepEqual(detectReciprocalHighRatings(votes), []);
  });

  it("no marca votos unidireccionales (sin reciprocidad)", () => {
    const votes = [vote("a", "b", 5), vote("c", "d", 5)];
    assert.deepEqual(detectReciprocalHighRatings(votes), []);
  });

  it("no duplica el mismo par si aparece en ambos sentidos en la iteracion", () => {
    const votes = [vote("a", "b", 5), vote("b", "a", 4)];
    const pairs = detectReciprocalHighRatings(votes);
    assert.equal(pairs.length, 1);
  });
});

describe("countDistinctVoters / hasSufficientVoterSample", () => {
  it("cuenta votantes distintos para un empleado", () => {
    const votes = [vote("a", "x", 5), vote("b", "x", 3), vote("a", "y", 4)];
    assert.equal(countDistinctVoters(votes, "x"), 2);
    assert.equal(countDistinctVoters(votes, "y"), 1);
  });

  it("1 solo votante = muestra insuficiente (default min=2)", () => {
    const votes = [vote("a", "x", 5)];
    assert.equal(hasSufficientVoterSample(votes, "x"), false);
  });

  it("2+ votantes distintos = muestra suficiente", () => {
    const votes = [vote("a", "x", 5), vote("b", "x", 4)];
    assert.equal(hasSufficientVoterSample(votes, "x"), true);
  });
});
