import { describe, expect, it } from "vitest";
import { cosineSimilarity, rankByCosine } from "./semantic-search";

describe("cosineSimilarity", () => {
  it("calculates cosine similarity for vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });

  it("rejects empty, mismatched, zero-magnitude, and non-finite vectors", () => {
    expect(cosineSimilarity([], [])).toBeUndefined();
    expect(cosineSimilarity([1], [1, 0])).toBeUndefined();
    expect(cosineSimilarity([0, 0], [1, 2])).toBeUndefined();
    expect(cosineSimilarity([Number.NaN], [1])).toBeUndefined();
  });
});

describe("rankByCosine", () => {
  const documents = [
    { id: "orthogonal", embedding: [0, 1] },
    { id: "best", embedding: [1, 0] },
    { id: "diagonal", embedding: [1, 1] },
    { id: "invalid", embedding: [0, 0] },
    { id: "missing" }
  ];

  it("ranks relevant documents, returns scores, and paginates after ranking", () => {
    const firstPage = rankByCosine(documents, [1, 0], 1, 2);
    expect(firstPage.documents.map((document) => document.id)).toEqual(["best", "diagonal"]);
    expect(firstPage.documents[0]?.score).toBe(1);
    expect(firstPage.documents[1]?.score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(firstPage.total).toBe(3);
    expect(firstPage.pages).toBe(2);

    const secondPage = rankByCosine(documents, [1, 0], 2, 2);
    expect(secondPage.documents.map((document) => document.id)).toEqual(["orthogonal"]);
  });

  it("returns an empty result page when no vectors are valid", () => {
    expect(rankByCosine([{ embedding: [0, 0] }], [1, 0], 1, 10)).toMatchObject({
      documents: [],
      total: 0,
      pages: 0
    });
  });
});
